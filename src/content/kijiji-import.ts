import { sendMessage } from '../shared/messages'
import type { ImportedAd, ImportJob } from '../shared/types'
import { delay } from './dom'
import { createImportBanner } from './import-banner'

const AD_ID_PATTERN = /(\d{8,})/
const PRICE_PATTERN = /(?:CA\$|C\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/i

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
  // Kijiji usually stores FIXED prices in cents
  return record.type === 'FIXED' || amount >= 100 ? amount / 100 : amount
}

const parsePostedAt = (value: unknown) => {
  if (typeof value === 'number' && value > 0) return value < 1e12 ? value * 1000 : value
  if (typeof value !== 'string' || !value) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
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
    postedAt: parsePostedAt(ad.activationDate ?? ad.postedDate ?? ad.startDate ?? ad.sortingDate),
  }
}

const extractAdsFromPayload = (payload: unknown): ImportedAd[] => {
  const root = asRecord(payload)
  if (!root) return []
  const adsValue = root.ads ?? root.myAdEntries ?? root.adEntries
  const entries = Array.isArray(adsValue) ? adsValue : adsValue ? Object.values(asRecord(adsValue) ?? {}) : []
  return entries.map(toImportedAd).filter((ad): ad is ImportedAd => Boolean(ad))
}

const fetchKijijiAdsJson = async (): Promise<{ ads: ImportedAd[]; needsLogin: boolean }> => {
  const response = await fetch('https://www.kijiji.ca/my/ads.json', { credentials: 'include' })
  if (response.status === 401 || response.status === 403) return { ads: [], needsLogin: true }
  if (response.redirected && /login|sign-?in/i.test(response.url)) return { ads: [], needsLogin: true }
  if (!response.ok) throw new Error(`Kijiji returned ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    const text = await response.text()
    if (/sign\s*in|log\s*in/i.test(text)) return { ads: [], needsLogin: true }
    throw new Error('Kijiji did not return ad JSON. Are you signed in?')
  }
  return { ads: extractAdsFromPayload(await response.json()), needsLogin: false }
}

const scrapeKijijiMyAdsDom = (): ImportedAd[] => {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="adId="], a[href*="/v-"]')]
  const ads = new Map<string, ImportedAd>()
  links.forEach((link) => {
    const href = link.href
    const id = new URL(href, location.origin).searchParams.get('adId') || AD_ID_PATTERN.exec(href)?.[1]
    if (!id || ads.has(id)) return
    const card = link.closest('li, article, tr, [class*="ad"], [data-testid]') ?? link.parentElement
    const text = (card?.textContent || link.textContent || '').replace(/\s+/g, ' ').trim()
    const title = (link.getAttribute('aria-label') || link.textContent || text.split(PRICE_PATTERN)[0] || '').trim()
    if (!title || title.length < 3) return
    const image = card?.querySelector('img')?.src
    const priceMatch = PRICE_PATTERN.exec(text)
    ads.set(id, {
      platform: 'kijiji',
      externalId: id,
      title: title.slice(0, 120),
      price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : /free/i.test(text) ? 0 : undefined,
      imageUrls: image && /^https?:/i.test(image) ? [image] : [],
      url: href.startsWith('http') ? href : `https://www.kijiji.ca/v-view-details.html?adId=${id}`,
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
    }

    await sendMessage({ type: 'IMPORT_RESULT', ads })
    banner.setStatus(
      ads.length === 0 ? 'No active Kijiji ads found on this account.' : `Imported ${ads.length} Kijiji ad${ads.length === 1 ? '' : 's'} into ListSync. You can close this tab.`,
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
