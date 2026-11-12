import { MAX_IMAGES } from '../shared/constants'
import { mergeImageLists } from '../shared/images'
import type { Listing } from '../shared/types'
import { delay, isVisible } from './dom'
import { parseKijijiTags, scrapeKijijiTagsFromHtml, tagsFromFormFields } from './kijiji-tags'

const AD_ID_PATTERN = /(\d{8,})/
const PRICE_PATTERN = /(?:CA\$|C\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/i

export interface KijijiAdSnapshot {
  externalId: string
  title: string
  description: string
  price: number
  location: string
  category: string
  categoryId?: string
  attributes?: Record<string, string>
  address?: string
  formFields?: Record<string, string>
  labeledFields?: Record<string, string>
  tags?: string[]
  images: string[]
  url: string
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined)

const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

export const extractKijijiAdId = (value?: string | null) => {
  if (!value) return null
  try {
    const url = new URL(value, 'https://www.kijiji.ca')
    return url.searchParams.get('adId') || AD_ID_PATTERN.exec(url.pathname)?.[1] || null
  } catch {
    return AD_ID_PATTERN.exec(value)?.[1] ?? null
  }
}

export const parseKijijiPrice = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
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

const collectImageUrls = (ad: Record<string, unknown>) => {
  const nestedImages = Array.isArray(ad.images)
    ? ad.images.flatMap((image) => {
        if (typeof image === 'string') return [image]
        const record = asRecord(image)
        return [
          asString(record?.url),
          asString(record?.href),
          asString(record?.src),
          asString(record?.thumbnailUrl),
          asString(record?.largeUrl),
          asString(record?.originalUrl),
        ].filter(Boolean)
      })
    : []
  const pictureList = Array.isArray(ad.pictures)
    ? ad.pictures.flatMap((picture) => {
        if (typeof picture === 'string') return [picture]
        const record = asRecord(picture)
        const sizes = asRecord(record?.sizes) ?? asRecord(record?.urls)
        return [
          asString(record?.href),
          asString(record?.url),
          asString(record?.src),
          asString(sizes?.large),
          asString(sizes?.big),
          asString(sizes?.normal),
        ].filter(Boolean)
      })
    : []
  const urls = [
    ...(Array.isArray(ad.imageUrls) ? ad.imageUrls : []),
    ...nestedImages,
    ...pictureList,
    ad.image,
    ad.thumbnailUrl,
    ad.imgUrl,
  ]
  return mergeImageLists(urls.map(asString).filter((url): url is string => Boolean(url)))
}

const stripHtml = (value: string) =>
  value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const rememberAttribute = (result: Record<string, string>, name: string | undefined, value: string | undefined) => {
  if (!name || !value) return
  result[name] = value
  const short = name.replace(/[sbdil]$/i, '')
  if (short && short !== name && !result[short]) result[short] = value
}

const extractAttributes = (ad: Record<string, unknown>): Record<string, string> => {
  const result: Record<string, string> = {}
  const sources = [ad.attributes, ad.attributeMap, ad.adAttributes, ad.localizedAttributes, asRecord(ad.attributesMap)]
  for (const raw of sources) {
    if (Array.isArray(raw)) {
      raw.forEach((entry) => {
        const record = asRecord(entry)
        if (!record) return
        const name =
          asString(record.canonicalName) ||
          asString(record.machineReadableValue) ||
          asString(record.name) ||
          asString(record.key) ||
          asString(record.label)
        const values = record.canonicalValues ?? record.machineReadableValues ?? record.values ?? record.value
        const value = Array.isArray(values)
          ? asString(values[0])
          : asString(values) || asString(record.localizedLabel) || asString(record.label)
        rememberAttribute(result, name, value)
      })
    } else if (raw && typeof raw === 'object') {
      Object.entries(raw as Record<string, unknown>).forEach(([name, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const record = asRecord(value)
          const nested =
            asString(record?.canonicalValue) ||
            asString(record?.machineReadableValue) ||
            asString(record?.value) ||
            asString(record?.label)
          rememberAttribute(result, name, nested)
          return
        }
        const text = Array.isArray(value)
          ? asString(value[0])
          : asString(value) ?? (typeof value === 'number' ? String(value) : undefined)
        rememberAttribute(result, name, text)
      })
    }
  }
  return result
}

const extractAttributesFromHtml = (html: string): Record<string, string> => {
  const result: Record<string, string> = {}
  const patterns = [
    /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi,
    /"canonicalName"\s*:\s*"([^"]+)"[\s\S]*?"canonicalValues"\s*:\s*\[\s*"([^"]+)"/gi,
    /"machineReadableValue"\s*:\s*"([^"]+)"[\s\S]*?"localizedLabel"\s*:\s*"([^"]+)"/gi,
  ]
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const name = stripHtml(decodeHtml(match[1] || '')).trim()
      const value = stripHtml(decodeHtml(match[2] || '')).trim()
      if (!name || !value || name.length > 40) continue
      rememberAttribute(result, name.toLowerCase().replace(/\s+/g, ''), value)
      rememberAttribute(result, name, value)
    }
  }
  return result
}

const adRecordToSnapshot = (raw: unknown, fallbackUrl?: string): KijijiAdSnapshot | null => {
  const ad = asRecord(raw)
  if (!ad) return null
  const externalId = String(ad.id ?? ad.adId ?? extractKijijiAdId(fallbackUrl) ?? '')
  const title = asString(ad.title)?.trim()
  if (!externalId || !title) return null
  const location = asRecord(ad.location)
  const url =
    asString(ad.viewAdPageUrl) ||
    asString(ad.url) ||
    asString(ad.seoUrl) ||
    asString(ad.shareUrl) ||
    fallbackUrl ||
    `https://www.kijiji.ca/v-view-details.html?adId=${externalId}`
  return {
    externalId,
    title,
    description: stripHtml(asString(ad.description) || asString(ad.descriptionHtml) || ''),
    price: parseKijijiPrice(ad.price) ?? 0,
    location: asString(ad.location) || asString(location?.name) || asString(ad.city) || '',
    category: asString(ad.categoryName) || asString(asRecord(ad.category)?.name) || '',
    categoryId: String(ad.categoryId ?? asRecord(ad.category)?.id ?? '') || undefined,
    attributes: extractAttributes(ad),
    address: asString(location?.address) || asString(ad.address) || asString(ad.postalCode) || undefined,
    tags: parseKijijiTags(
      Array.isArray(ad.tags) ? ad.tags.map((tag) => asString(tag) ?? '').filter(Boolean) : asString(ad.tags),
      Array.isArray(ad.keywords) ? ad.keywords.map((tag) => asString(tag) ?? '').filter(Boolean) : asString(ad.keywords),
      asString(asRecord(ad.attributeMap)?.tags_s),
      asString(asRecord(ad.attributes)?.tags_s),
    ),
    images: collectImageUrls(ad).slice(0, MAX_IMAGES),
    url,
  }
}

const findJsonScripts = (html: string) => {
  const scripts: string[] = []
  const pattern = /<script[^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    const body = match[1]
    if (body.includes('__NEXT_DATA__') || body.includes('window.__data') || body.includes('"imageUrls"') || body.includes('description')) {
      scripts.push(body)
    }
  }
  return scripts
}

const extractSnapshotFromHtml = (html: string, adId: string, pageUrl: string): KijijiAdSnapshot | null => {
  for (const script of findJsonScripts(html)) {
    const nextData = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1] || /__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/m.exec(script)?.[1]
    const dataMatch = /window\.__data\s*=\s*(\{[\s\S]*?\});/.exec(script)
    for (const raw of [nextData, dataMatch?.[1]]) {
      if (!raw) continue
      try {
        const json = JSON.parse(raw) as unknown
        const found = findAdInTree(json, adId)
        const snapshot = adRecordToSnapshot(found, pageUrl)
        if (snapshot) {
          const htmlAttributes = extractAttributesFromHtml(html)
          return {
            ...snapshot,
            attributes: { ...htmlAttributes, ...snapshot.attributes },
            tags: parseKijijiTags(snapshot.tags, scrapeKijijiTagsFromHtml(html), tagsFromFormFields({}, htmlAttributes)),
          }
        }
      } catch {
        // keep trying other payloads
      }
    }
  }

  const title =
    /property="og:title"\s+content="([^"]+)"/i.exec(html)?.[1] ||
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, '').trim()
  const description =
    /property="og:description"\s+content="([^"]+)"/i.exec(html)?.[1] ||
    /itemprop="description"[^>]*>([\s\S]*?)<\//i.exec(html)?.[1]
  const priceText = /property="product:price:amount"\s+content="([^"]+)"/i.exec(html)?.[1] || PRICE_PATTERN.exec(html)?.[0]
  const images = [...html.matchAll(/property="og:image"\s+content="([^"]+)"/gi)].map((match) => match[1])
  if (!title) return null
  return {
    externalId: adId,
    title: decodeHtml(title),
    description: decodeHtml(stripHtml(description || '')),
    price: parseKijijiPrice(priceText) ?? 0,
    location: '',
    category: '',
    attributes: extractAttributesFromHtml(html),
    tags: scrapeKijijiTagsFromHtml(html),
    images: images.filter((url) => /^https?:/i.test(url)).slice(0, MAX_IMAGES),
    url: pageUrl,
  }
}

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const findAdInTree = (value: unknown, adId: string): Record<string, unknown> | null => {
  const record = asRecord(value)
  if (!record) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findAdInTree(item, adId)
        if (found) return found
      }
    }
    return null
  }
  const id = String(record.id ?? record.adId ?? '')
  if (id === adId && (record.title || record.description || record.imageUrls)) return record
  for (const child of Object.values(record)) {
    const found = findAdInTree(child, adId)
    if (found) return found
  }
  return null
}

export const fetchKijijiAdFromAccount = async (adId: string): Promise<KijijiAdSnapshot | null> => {
  const response = await fetch('https://www.kijiji.ca/my/ads.json', { credentials: 'include' })
  if (!response.ok) return null
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) return null
  const payload = asRecord(await response.json())
  if (!payload) return null
  const adsValue = payload.ads ?? payload.myAdEntries ?? payload.adEntries
  const entries = Array.isArray(adsValue) ? adsValue : adsValue ? Object.values(asRecord(adsValue) ?? {}) : []
  for (const entry of entries) {
    const snapshot = adRecordToSnapshot(entry)
    if (snapshot?.externalId === adId) return snapshot
  }
  return null
}

export const fetchKijijiAdFromViewPage = async (adId: string, preferredUrl?: string): Promise<KijijiAdSnapshot | null> => {
  const pageUrl = preferredUrl || `https://www.kijiji.ca/v-view-details.html?adId=${adId}`
  const response = await fetch(pageUrl, { credentials: 'include' })
  if (!response.ok) return null
  return extractSnapshotFromHtml(await response.text(), adId, response.url || pageUrl)
}

const extractXsrfToken = (html: string) => {
  const patterns = [
    /name=["']ca\.kijiji\.xsrf\.token["'][^>]*value=["']([^"']+)/i,
    /value=["']([^"']+)["'][^>]*name=["']ca\.kijiji\.xsrf\.token["']/i,
    /"ca\.kijiji\.xsrf\.token"\s*:\s*"([^"]+)"/i,
    /"xsrfToken"\s*:\s*"([^"]+)"/i,
    /"xsrf_token"\s*:\s*"([^"]+)"/i,
    /token:\s*['"]([0-9]+\.[a-f0-9]+)['"]/i,
    /Zoop\.init\([\s\S]*?token:\s*['"]([^'"]+)['"]/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match?.[1]) return match[1]
  }
  return null
}

const extractTokenFromCookies = () => {
  const cookies = document.cookie.split(';').map((part) => part.trim())
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=')
    const value = rest.join('=')
    if (/token|xsrf|csrf/i.test(name) && value && value.length > 8) return decodeURIComponent(value)
  }
  return null
}

const fetchTokenFromGenerator = async () => {
  for (const method of ['GET', 'HEAD'] as const) {
    try {
      const response = await fetch('https://www.kijiji.ca/j-token-gen.json', {
        method,
        credentials: 'include',
        cache: 'no-store',
      })
      const headerToken =
        response.headers.get('x-ebay-box-token') ||
        response.headers.get('X-Ebay-Box-Token') ||
        response.headers.get('x-csrf-token')
      if (headerToken) return headerToken
      if (method === 'GET') {
        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('json')) {
          const payload = asRecord(await response.json())
          const token = asString(payload?.token) || asString(payload?.xsrfToken) || asString(payload?.['ca.kijiji.xsrf.token'])
          if (token) return token
        } else {
          const token = extractXsrfToken(await response.text())
          if (token) return token
        }
      }
    } catch {
      // try the next method
    }
  }
  return null
}

const fetchTokenFromMyAdsPages = async () => {
  const urls = [
    'https://www.kijiji.ca/m-my-ads/active',
    'https://www.kijiji.ca/m-my-ads.html',
    'https://www.kijiji.ca/my/ads',
    location.href,
  ]
  for (const url of [...new Set(urls)]) {
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
      const token = extractXsrfToken(await response.text())
      if (token) return token
    } catch {
      // try the next page
    }
  }
  return extractXsrfToken(document.documentElement.outerHTML) || extractTokenFromCookies()
}

const isDeleteSuccess = (status: number, text: string) =>
  status === 204 ||
  ((status === 200 || status === 201) && (/ok/i.test(text) || /success/i.test(text) || /deleted/i.test(text) || text.trim() === ''))

const deleteKijijiAdViaApi = async (adId: string) => {
  const token = (await fetchTokenFromGenerator()) || (await fetchTokenFromMyAdsPages())
  if (!token) throw new Error('TOKEN_MISSING')

  const attempts: Array<{ url: string; init: RequestInit }> = [
    {
      url: 'https://www.kijiji.ca/j-delete-ad.json',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({
          Action: 'DELETE_ADS',
          Mode: 'ACTIVE',
          needsRedirect: 'false',
          ads: JSON.stringify([{ adId, reason: 'PREFER_NOT_TO_SAY', otherReason: '' }]),
          'ca.kijiji.xsrf.token': token,
        }),
      },
    },
    {
      url: 'https://www.kijiji.ca/j-delete-ad.json',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-ebay-box-token': token,
          'X-Ebay-Box-Token': token,
        },
        body: JSON.stringify({
          Action: 'DELETE_ADS',
          Mode: 'ACTIVE',
          needsRedirect: false,
          ads: [{ adId, reason: 'PREFER_NOT_TO_SAY', otherReason: '' }],
          'ca.kijiji.xsrf.token': token,
        }),
      },
    },
  ]

  let lastError = 'Kijiji did not confirm the delete'
  for (const attempt of attempts) {
    const response = await fetch(attempt.url, attempt.init)
    const text = await response.text()
    if (isDeleteSuccess(response.status, text)) return
    lastError = `Kijiji delete failed (${response.status})`
  }
  throw new Error(lastError)
}

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()

const findAdCard = (adId: string, title?: string) => {
  const links = [...document.querySelectorAll<HTMLAnchorElement>(`a[href*="${adId}"], a[href*="adId=${adId}"]`)]
  for (const link of links) {
    const card = link.closest('li, article, tr, section, [class*="ad"], [data-testid], [role="listitem"]')
    if (card instanceof HTMLElement) return card
  }
  if (!title) return null
  const target = normalizeText(title)
  return (
    [...document.querySelectorAll<HTMLElement>('li, article, tr, section, [class*="ad"], [data-testid]')].find((element) => {
      const text = normalizeText(element.innerText || '')
      return text.includes(target) && text.length < 2000
    }) ?? null
  )
}

const clickFirst = (root: ParentNode, pattern: RegExp) => {
  const candidates = [...root.querySelectorAll<HTMLElement>('button, a, [role="button"], [role="menuitem"], input[type="button"], input[type="submit"]')]
  const match = candidates.find((element) => {
    const label = `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('value') || ''}`
    return isVisible(element) && pattern.test(label.trim())
  })
  match?.click()
  return Boolean(match)
}

const waitForDialog = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"], [aria-modal="true"], .modal, [class*="modal"], [class*="Dialog"]')
    if (dialog && isVisible(dialog)) return dialog
    await delay(250)
  }
  return null
}

export const deleteKijijiAdViaUi = async (adId: string, title?: string) => {
  const card = findAdCard(adId, title)
  if (!card) throw new Error(`Could not find ad ${adId} on the My Ads page to delete`)

  const openedMenu =
    clickFirst(card, /^(more|options|actions|manage)\b/i) ||
    clickFirst(card, /^…$|^\.{3}$|^⋮$/) ||
    Boolean(card.querySelector<HTMLElement>('button[aria-haspopup], [aria-label*="More"], [aria-label*="menu"]')?.click())

  if (openedMenu) await delay(400)

  const deleteClicked =
    clickFirst(card, /^(delete|remove)\b/i) ||
    clickFirst(document, /^(delete|remove)\s+(ad|listing)?$/i) ||
    clickFirst(document, /^(delete|remove)\b/i)

  if (!deleteClicked) throw new Error('Could not find Kijiji’s Delete button for this ad')

  await delay(500)
  const dialog = await waitForDialog()
  if (dialog) {
    clickFirst(dialog, /prefer not|don’t want|do not want|other/i)
    await delay(200)
    const confirmed =
      clickFirst(dialog, /^(delete|confirm|yes|remove|continue|submit)\b/i) ||
      clickFirst(dialog, /\bdelete\b/i)
    if (!confirmed) throw new Error('Could not confirm the Kijiji delete dialog')
  }

  // Give Kijiji a moment to remove the card
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(500)
    if (!findAdCard(adId, title)) return
  }
}

export const deleteKijijiAd = async (adId: string, title?: string) => {
  try {
    await deleteKijijiAdViaApi(adId)
    return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/m-my-ads|\/my\/ads/i.test(location.pathname + location.href)) {
      await deleteKijijiAdViaUi(adId, title)
      return
    }
    if (message === 'TOKEN_MISSING') {
      throw new Error('UI_DELETE_REQUIRED')
    }
    throw error instanceof Error ? error : new Error(message)
  }
}

export const imageUrlToDataUrl = async (url: string): Promise<string> => {
  const response = await fetch(url, { credentials: 'omit' })
  if (!response.ok) throw new Error(`Could not download image (${response.status})`)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read image data'))
    reader.readAsDataURL(blob)
  })
}

export const hydrateSnapshotImages = async (snapshot: KijijiAdSnapshot): Promise<KijijiAdSnapshot> => {
  const images: string[] = []
  for (const image of snapshot.images.slice(0, MAX_IMAGES)) {
    if (image.startsWith('data:')) {
      images.push(image)
      continue
    }
    try {
      images.push(await imageUrlToDataUrl(image))
    } catch {
      // keep going with the images we can download
    }
  }
  return { ...snapshot, images }
}

export const mergeSnapshotWithListing = (listing: Listing, snapshot: KijijiAdSnapshot): KijijiAdSnapshot => ({
  externalId: snapshot.externalId,
  title: snapshot.title || listing.title,
  description: snapshot.description || listing.description,
  price: snapshot.price > 0 ? snapshot.price : listing.price > 0 ? listing.price : snapshot.price || listing.price,
  location: snapshot.location || listing.location,
  category: snapshot.category || listing.category,
  categoryId: snapshot.categoryId || listing.kijiji?.categoryId,
  attributes: { ...listing.kijiji?.attributes, ...snapshot.attributes },
  address: snapshot.address || listing.kijiji?.address,
  formFields: { ...listing.kijiji?.formFields, ...snapshot.formFields },
  labeledFields: { ...listing.kijiji?.labeledFields, ...snapshot.labeledFields },
  tags: parseKijijiTags(snapshot.tags, listing.kijiji?.tags),
  images: mergeImageLists(snapshot.images, listing.images),
  url: snapshot.url,
})
