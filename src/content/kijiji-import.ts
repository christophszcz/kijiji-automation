import { sendMessage } from '../shared/messages'
import type { ImportedAd, ImportJob } from '../shared/types'
import { delay } from './dom'
import { createImportBanner } from './import-banner'

const AD_ID_PATTERN = /(\d{8,})/
const PRICE_PATTERN = /(?:CA\$|C\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/i
const USER_ID_PATTERNS = [
  /["']?userId["']?\s*[:=]\s*["']?(\d{5,})/i,
  /["']profileUserId["']\s*:\s*["']?(\d{5,})/i,
  /["']user["']\s*:\s*\{\s*["']id["']\s*:\s*["']?(\d{5,})/i,
  /user=(\d{5,})/,
]

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined)

const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

const parsePrice = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1000 && Number.isInteger(value) ? value / 100 : value
  if (typeof value === 'string') {
    const match = PRICE_PATTERN.exec(value) ?? /([\d,]+(?:\.\d{1,2})?)/.exec(value)
    if (!match) return /free/i.test(value) ? 0 : undefined
    return Number(match[1].replace(/,/g, ''))
  }
  const record = asRecord(value)
  if (!record) return undefined
  const amount = asNumber(record.amount)
  if (amount === undefined) return undefined
  return record.type === 'FIXED' || amount >= 100 ? amount / 100 : amount
}

const parsePostedAt = (value: unknown) => {
  if (typeof value === 'number' && value > 0) return value < 1e12 ? value * 1000 : value
  if (typeof value !== 'string' || !value) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

const parseCount = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value)
  if (typeof value !== 'string') return undefined
  const match = /(\d[\d,]*)/.exec(value.replace(/\s+/g, ' '))
  if (!match) return undefined
  return Number(match[1].replace(/,/g, ''))
}

const firstDefinedCount = (...values: unknown[]) => {
  for (const value of values) {
    const parsed = parseCount(value)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

const collectImageUrls = (ad: Record<string, unknown>) => {
  const urls = [
    ...(Array.isArray(ad.imageUrls) ? ad.imageUrls : []),
    ...(Array.isArray(ad.images) ? ad.images : []),
    ad.image,
    ad.thumbnailUrl,
    asRecord(Array.isArray(ad.images) ? ad.images[0] : null)?.url,
  ]
  return [...new Set(urls.map(asString).filter((url): url is string => Boolean(url && /^https?:/i.test(url))))]
}

const nestedStat = (ad: Record<string, unknown>, keys: string[]) => {
  const bags = [ad, asRecord(ad.stats), asRecord(ad.statistics), asRecord(ad.metrics), asRecord(ad.status), asRecord(ad.adStatus)].filter(
    Boolean,
  ) as Record<string, unknown>[]
  for (const bag of bags) {
    for (const key of keys) {
      if (bag[key] !== undefined && bag[key] !== null) return bag[key]
    }
  }
  return undefined
}

const extractViews = (ad: Record<string, unknown>) =>
  firstDefinedCount(
    nestedStat(ad, ['viewCounter', 'viewCount', 'views', 'visits', 'visitCount', 'visitCounter', 'viewAdCount', 'view_ad_count']),
  )

const extractSearchPage = (ad: Record<string, unknown>) =>
  firstDefinedCount(nestedStat(ad, ['pageNumber', 'page', 'searchPage', 'rankingPage', 'rank', 'ranking']))

const toImportedAd = (raw: unknown): ImportedAd | null => {
  const ad = asRecord(raw)
  if (!ad) return null
  const id = String(ad.id ?? ad.adId ?? '')
  const title = asString(ad.title)?.trim()
  if (!id || !title) return null
  const location = asRecord(ad.location)
  const url =
    asString(ad.viewAdPageUrl) ||
    asString(ad.url) ||
    asString(ad.seoUrl) ||
    asString(ad.shareUrl) ||
    `https://www.kijiji.ca/v-view-details.html?adId=${id}`
  return {
    platform: 'kijiji',
    externalId: id,
    title,
    description: asString(ad.description) || asString(ad.descriptionHtml)?.replace(/<[^>]+>/g, ' '),
    price: parsePrice(ad.price),
    location: asString(ad.location) || asString(location?.name) || asString(ad.city),
    category: asString(ad.categoryName) || asString(asRecord(ad.category)?.name),
    imageUrls: collectImageUrls(ad),
    url,
    postedAt: parsePostedAt(ad.activationDate ?? ad.postedDate ?? ad.startDate ?? ad.sortingDate ?? ad.creationDate ?? ad.createdDate),
    views: extractViews(ad),
    searchPage: extractSearchPage(ad),
  }
}

const extractAdsFromPayload = (payload: unknown): ImportedAd[] => {
  const root = asRecord(payload)
  if (!root) return []
  const adsValue = root.ads ?? root.myAdEntries ?? root.adEntries ?? root.results
  const entries = Array.isArray(adsValue) ? adsValue : adsValue ? Object.values(asRecord(adsValue) ?? {}) : []
  return entries.map(toImportedAd).filter((ad): ad is ImportedAd => Boolean(ad))
}

const mergeImportedAdsById = (...lists: ImportedAd[][]) => {
  const merged = new Map<string, ImportedAd>()
  lists.flat().forEach((ad) => {
    const existing = merged.get(ad.externalId)
    if (!existing) {
      merged.set(ad.externalId, ad)
      return
    }
    merged.set(ad.externalId, {
      ...existing,
      ...ad,
      title: ad.title || existing.title,
      description: ad.description || existing.description,
      price: ad.price ?? existing.price,
      location: ad.location || existing.location,
      category: ad.category || existing.category,
      imageUrls: (ad.imageUrls?.length ? ad.imageUrls : existing.imageUrls) ?? [],
      postedAt: existing.postedAt ?? ad.postedAt,
      views: ad.views ?? existing.views,
      searchPage: ad.searchPage ?? existing.searchPage,
    })
  })
  return [...merged.values()]
}

const extractUserIdFromText = (text: string) => {
  for (const pattern of USER_ID_PATTERNS) {
    const match = pattern.exec(text)
    if (match?.[1]) return match[1]
  }
  return undefined
}

const resolveKijijiUserId = async () => {
  const fromPage = extractUserIdFromText(document.documentElement.innerHTML)
  if (fromPage) return fromPage

  try {
    const win = window as unknown as Record<string, unknown>
    const data = asRecord(win.__data) ?? asRecord(win.__INITIAL_STATE__) ?? asRecord(win.__PRELOADED_STATE__)
    const fromWindow = extractUserIdFromText(JSON.stringify(data ?? {}))
    if (fromWindow) return fromWindow
  } catch {
    // ignore
  }

  for (const url of ['https://www.kijiji.ca/m-my-ads.html', 'https://www.kijiji.ca/m-my-ads/active', 'https://www.kijiji.ca/my/profile']) {
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
      if (!response.ok) continue
      const userId = extractUserIdFromText(await response.text())
      if (userId) return userId
    } catch {
      // try next
    }
  }
  return undefined
}

const fetchKijijiJsonFeed = async (url: string): Promise<{ ads: ImportedAd[]; needsLogin: boolean; ok: boolean; payload?: unknown }> => {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json, text/javascript, */*;q=0.1' },
  })
  if (response.status === 401 || response.status === 403) return { ads: [], needsLogin: true, ok: false }
  if (response.redirected && /login|sign-?in/i.test(response.url)) return { ads: [], needsLogin: true, ok: false }
  if (!response.ok) return { ads: [], needsLogin: false, ok: false }

  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()
  if (/sign\s*in|log\s*in/i.test(text) && !/"ads"|myAdEntries|viewCounter|pageNumber|"ranks"/i.test(text)) {
    return { ads: [], needsLogin: true, ok: false }
  }

  try {
    const payload = JSON.parse(text) as unknown
    if (!contentType.includes('json') && !asRecord(payload)) return { ads: [], needsLogin: false, ok: false }
    return { ads: extractAdsFromPayload(payload), needsLogin: false, ok: true, payload }
  } catch {
    return { ads: [], needsLogin: false, ok: false }
  }
}

const fetchKijijiRanks = async (adIds: string[]): Promise<Record<string, number>> => {
  if (adIds.length === 0) return {}
  const params = new URLSearchParams()
  adIds.forEach((id) => params.append('ids', id))
  try {
    const response = await fetch(`https://www.kijiji.ca/my/ranks?${params.toString()}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return {}
    const payload = asRecord(await response.json())
    const ranks = asRecord(payload?.ranks) ?? payload
    if (!ranks) return {}
    return Object.fromEntries(
      Object.entries(ranks)
        .map(([id, value]) => [String(id), parseCount(value)] as const)
        .filter((entry): entry is [string, number] => entry[1] !== undefined),
    )
  } catch {
    return {}
  }
}

const applyRanks = (ads: ImportedAd[], ranks: Record<string, number>): ImportedAd[] =>
  ads.map((ad) => ({
    ...ad,
    searchPage: ranks[ad.externalId] ?? ad.searchPage,
  }))

const fetchLegacyMyAdsWithStats = async (userId: string): Promise<ImportedAd[]> => {
  const collected: ImportedAd[] = []
  let offset = 0
  for (let page = 0; page < 10; page += 1) {
    const url = `https://www.kijiji.ca/j-get-my-ads.json?_=${Date.now()}&currentOffset=${offset}&show=ACTIVE&user=${encodeURIComponent(userId)}`
    const result = await fetchKijijiJsonFeed(url)
    if (!result.ok || result.ads.length === 0) break
    collected.push(...result.ads)
    const root = asRecord(result.payload)
    const nextOffset = parseCount(root?.currentOffset ?? root?.nextOffset)
    const numFound = parseCount(root?.numFound ?? root?.totalNumFound ?? root?.total)
    offset = nextOffset !== undefined && nextOffset > offset ? nextOffset : offset + result.ads.length
    if (numFound !== undefined && collected.length >= numFound) break
    if (result.ads.length < 5) break
  }
  return mergeImportedAdsById(collected)
}

const fetchKijijiAdsJson = async (): Promise<{ ads: ImportedAd[]; needsLogin: boolean }> => {
  const collected: ImportedAd[] = []
  let sawLogin = false
  let sawOk = false

  for (const url of ['https://www.kijiji.ca/my/ads.json', 'https://www.kijiji.ca/my/ads']) {
    try {
      const result = await fetchKijijiJsonFeed(url)
      if (result.needsLogin) sawLogin = true
      if (result.ok) {
        sawOk = true
        collected.push(...result.ads)
      }
    } catch {
      // try next feed
    }
  }

  const userId = await resolveKijijiUserId()
  if (userId) {
    try {
      const legacyAds = await fetchLegacyMyAdsWithStats(userId)
      if (legacyAds.length > 0) {
        sawOk = true
        collected.push(...legacyAds)
      }
    } catch {
      // ranks/DOM still available
    }
  }

  let ads = mergeImportedAdsById(collected)
  if (ads.length > 0) {
    const ranks = await fetchKijijiRanks(ads.map((ad) => ad.externalId))
    ads = applyRanks(ads, ranks)
  }

  if (!sawOk && sawLogin) return { ads: [], needsLogin: true }
  if (!sawOk && ads.length === 0) throw new Error('Kijiji did not return ad JSON. Are you signed in?')
  return { ads, needsLogin: false }
}

const scrapeLabeledStat = (card: Element, labels: string[]) => {
  const labelPattern = new RegExp(`^(?:${labels.join('|')})$`, 'i')
  const nodes = [...card.querySelectorAll('span, div, dd, dt, p, li, strong, em')]
  for (let index = 0; index < nodes.length; index += 1) {
    const text = (nodes[index].textContent || '').replace(/\s+/g, ' ').trim()
    if (!labelPattern.test(text)) continue
    const sibling = nodes[index + 1]
    const siblingText = (sibling?.textContent || '').replace(/\s+/g, ' ').trim()
    const fromSibling = parseCount(siblingText)
    if (fromSibling !== undefined) return fromSibling
    const parentText = (nodes[index].parentElement?.textContent || '').replace(/\s+/g, ' ').trim()
    const inline = scrapeStatFromText(parentText, [new RegExp(`(?:${labels.join('|')})[:\\s]*([\\d,]+)`, 'i')])
    if (inline !== undefined) return inline
  }
  return undefined
}

const scrapeStatFromText = (text: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (!match) continue
    const value = parseCount(match[1] ?? match[2])
    if (value !== undefined) return value
  }
  return undefined
}

const scrapeKijijiMyAdsDom = (): ImportedAd[] => {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="adId="], a[href*="/v-"]')]
  const ads = new Map<string, ImportedAd>()
  links.forEach((link) => {
    const href = link.href
    const id = new URL(href, location.origin).searchParams.get('adId') || AD_ID_PATTERN.exec(href)?.[1]
    if (!id || ads.has(id)) return
    const card = link.closest('li, article, tr, section, [class*="ad"], [data-testid], [class*="listing"]') ?? link.parentElement
    if (!card) return
    const text = (card.textContent || link.textContent || '').replace(/\s+/g, ' ').trim()
    const title = (link.getAttribute('aria-label') || link.textContent || text.split(PRICE_PATTERN)[0] || '').trim()
    if (!title || title.length < 3) return
    const image = card.querySelector('img')?.src
    const priceMatch = PRICE_PATTERN.exec(text)
    const views =
      scrapeLabeledStat(card, ['visits?', 'views?', 'vue[s]?']) ??
      scrapeStatFromText(text, [/\b(?:views?|visits?|vues?)\b[:\s]*([\d,]+)/i, /([\d,]+)\s*(?:views?|visits?|vues?)\b/i])
    const searchPage =
      scrapeLabeledStat(card, ['page', 'pages?', 'page\\s*#?']) ??
      scrapeStatFromText(text, [/\bpage\b[:\s#]*([\d,]+)/i, /([\d,]+)\s*(?:st|nd|rd|th)?\s*page\b/i])
    ads.set(id, {
      platform: 'kijiji',
      externalId: id,
      title: title.slice(0, 120),
      price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : /free/i.test(text) ? 0 : undefined,
      imageUrls: image && /^https?:/i.test(image) ? [image] : [],
      url: href.startsWith('http') ? href : `https://www.kijiji.ca/v-view-details.html?adId=${id}`,
      views,
      searchPage,
    })
  })
  return [...ads.values()]
}

const pageLooksLikeLogin = () =>
  Boolean(document.querySelector('a[href*="login"], button, a')) &&
  /sign\s*in|log\s*in/i.test(document.body.innerText.slice(0, 4000)) &&
  !/my ads|your ads|active ads/i.test(document.body.innerText.slice(0, 4000))

export const runKijijiImport = async (job: ImportJob) => {
  const banner = createImportBanner('Importing Kijiji ads')
  banner.setStatus('Fetching your active Kijiji ads…')

  try {
    await delay(800)
    if (pageLooksLikeLogin()) {
      await sendMessage({ type: 'IMPORT_RESULT', ads: [], needsLogin: true })
      banner.setStatus('Sign in to Kijiji, then click Sync again in ListSync.', 'warning')
      return
    }

    let ads: ImportedAd[] = []
    try {
      const jsonResult = await fetchKijijiAdsJson()
      if (jsonResult.needsLogin) {
        await sendMessage({ type: 'IMPORT_RESULT', ads: [], needsLogin: true })
        banner.setStatus('Sign in to Kijiji, then click Sync again in ListSync.', 'warning')
        return
      }
      ads = jsonResult.ads
    } catch {
      banner.setStatus('JSON feed unavailable — reading the My Ads page…', 'warning')
    }

    if (ads.length === 0) {
      await delay(1500)
      ads = scrapeKijijiMyAdsDom()
      if (ads.length > 0) {
        const ranks = await fetchKijijiRanks(ads.map((ad) => ad.externalId))
        ads = applyRanks(ads, ranks)
      }
    } else {
      ads = mergeImportedAdsById(ads, scrapeKijijiMyAdsDom())
      const ranks = await fetchKijijiRanks(ads.map((ad) => ad.externalId))
      ads = applyRanks(ads, ranks)
    }

    await sendMessage({ type: 'IMPORT_RESULT', ads })
    const withStats = ads.filter((ad) => ad.views !== undefined || ad.searchPage !== undefined).length
    banner.setStatus(
      ads.length === 0
        ? 'No active Kijiji ads found on this account.'
        : `Imported ${ads.length} Kijiji ad${ads.length === 1 ? '' : 's'} (${withStats} with views/page). You can close this tab.`,
      ads.length === 0 ? 'warning' : 'success',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await sendMessage({ type: 'IMPORT_RESULT', ads: [], error: message })
    banner.setStatus(message, 'warning')
  } finally {
    void job
  }
}
