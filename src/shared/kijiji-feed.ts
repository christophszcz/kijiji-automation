import { pickImageList } from './images'
import { expiresAtFromDaysRemaining } from './kijiji-dates'
import type { ImportedAd } from './types'

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
  const toUrls = (values: unknown[]) => values.map(asString).filter((url): url is string => Boolean(url))
  const images = Array.isArray(ad.images) ? ad.images.map((image) => asString(image) ?? asRecord(image)?.url) : []
  return pickImageList(
    Array.isArray(ad.imageUrls) ? toUrls(ad.imageUrls) : [],
    toUrls(images),
    toUrls([ad.image ?? ad.thumbnailUrl]),
  )
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

const parseExpiresAt = (ad: Record<string, unknown>, now = Date.now()) => {
  const absolute = parsePostedAt(
    ad.expiryDate ?? ad.expirationDate ?? ad.expiresAt ?? ad.expireDate ?? ad.endDate ?? ad.adExpiryDate,
  )
  if (absolute !== undefined) return absolute
  const days = firstDefinedCount(
    nestedStat(ad, ['daysToExpire', 'daysUntilExpiry', 'expireInDays', 'expiresInDays', 'expiryDays', 'daysLeft']),
  )
  return days !== undefined ? expiresAtFromDaysRemaining(days, now) : undefined
}

export const toImportedKijijiAd = (raw: unknown): ImportedAd | null => {
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
    expiresAt: parseExpiresAt(ad),
    views: extractViews(ad),
    searchPage: extractSearchPage(ad),
  }
}

const extractAdsFromPayload = (payload: unknown): ImportedAd[] => {
  const root = asRecord(payload)
  if (!root) return []
  const adsValue = root.ads ?? root.myAdEntries ?? root.adEntries ?? root.results
  const entries = Array.isArray(adsValue) ? adsValue : adsValue ? Object.values(asRecord(adsValue) ?? {}) : []
  return entries.map(toImportedKijijiAd).filter((ad): ad is ImportedAd => Boolean(ad))
}

export const mergeImportedKijijiAdsById = (...lists: ImportedAd[][]) => {
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
      expiresAt: ad.expiresAt ?? existing.expiresAt,
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
  for (const url of ['https://www.kijiji.ca/m-my-ads/active', 'https://www.kijiji.ca/m-my-ads.html', 'https://www.kijiji.ca/my/profile']) {
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
      if (!response.ok) continue
      if (response.redirected && /login|sign-?in/i.test(response.url)) return undefined
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

export const fetchKijijiRanks = async (adIds: string[]): Promise<Record<string, number>> => {
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

export const applyKijijiRanks = (ads: ImportedAd[], ranks: Record<string, number>): ImportedAd[] =>
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
  return mergeImportedKijijiAdsById(collected)
}

/** Fetches active Kijiji ads using the signed-in browser session — safe to call from the service worker. */
export const fetchKijijiAdsFromAccount = async (): Promise<{ ads: ImportedAd[]; needsLogin: boolean }> => {
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
  if (!userId && collected.length === 0) {
    return { ads: [], needsLogin: true }
  }

  if (userId) {
    try {
      const legacyAds = await fetchLegacyMyAdsWithStats(userId)
      if (legacyAds.length > 0) {
        sawOk = true
        collected.push(...legacyAds)
      }
    } catch {
      // ranks still available below
    }
  }

  let ads = mergeImportedKijijiAdsById(collected)
  if (ads.length > 0) {
    const ranks = await fetchKijijiRanks(ads.map((ad) => ad.externalId))
    ads = applyKijijiRanks(ads, ranks)
  }

  if (!sawOk && sawLogin) return { ads: [], needsLogin: true }
  if (!sawOk && ads.length === 0) {
    throw new Error('Could not load Kijiji ads. Sign in to Kijiji in Chrome, then try Sync again.')
  }
  return { ads, needsLogin: false }
}
