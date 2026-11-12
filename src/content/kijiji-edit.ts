import { MAX_IMAGES } from '../shared/constants'
import { mergeImageLists } from '../shared/images'
import { delay, isVisible, waitFor } from './dom'
import {
  extractKijijiAdId,
  hydrateSnapshotImages,
  parseKijijiPrice,
  type KijijiAdSnapshot,
} from './kijiji-api'
import { parseKijijiTags, scrapeKijijiTagsFromDom, scrapeKijijiTagsFromHtml, tagsFromFormFields } from './kijiji-tags'

const EDIT_FORM_TIMEOUT_MS = 45_000
const SKIP_FIELD_NAMES = /xsrf|csrf|fraud|token|password|submittype|adid|^file$|uuid|galleryimageindex/i

export const getKijijiEditUrl = (adId: string) => `https://www.kijiji.ca/p-edit-ad.html?adId=${encodeURIComponent(adId)}`

export const isKijijiEditPage = (url = location.href) => {
  try {
    const parsed = new URL(url, location.origin)
    return /p-edit-ad|edit-ad|\/edit\//i.test(parsed.pathname) || parsed.searchParams.has('adId') && /edit/i.test(parsed.pathname)
  } catch {
    return /p-edit-ad/i.test(url)
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined)

const normalizeKey = (value: string) => value.replace(/[\s_-]+/g, '').toLowerCase()

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const fieldLabelFor = (element: HTMLElement) => {
  const labelledBy = element
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent)
    .filter(Boolean)
    .join(' ')
  const labels = [...((element as HTMLInputElement).labels ?? [])].map((label) => label.textContent).join(' ')
  const nearby = element
    .closest('[class*="field" i], [class*="form" i], [class*="attribute" i], li, div, fieldset')
    ?.querySelector('label, legend, [class*="label" i]')
    ?.textContent
  return stripHtml([element.getAttribute('aria-label'), labels, labelledBy, nearby].filter(Boolean).join(' '))
}

const remember = (target: Record<string, string>, key: string | undefined, value: string | undefined) => {
  if (!key || value === undefined) return
  const trimmedKey = key.trim()
  const trimmedValue = value.trim()
  if (!trimmedKey || !trimmedValue) return
  if (SKIP_FIELD_NAMES.test(trimmedKey)) return
  target[trimmedKey] = trimmedValue
}

const attributeNameFromFormName = (name: string) => {
  const match = /attributeMap\[([^\]]+)\]/i.exec(name) || /attributes?\.([^.[\]]+)/i.exec(name)
  return match?.[1]
}

export const scrapeKijijiEditFormFromDom = () => {
  const formFields: Record<string, string> = {}
  const labeledFields: Record<string, string> = {}
  const attributes: Record<string, string> = {}
  const images: string[] = []

  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((element) => {
    const name = element.name || element.id
    if (!name || SKIP_FIELD_NAMES.test(name)) return

    if (element instanceof HTMLInputElement) {
      if (element.type === 'password' || element.type === 'file' || element.type === 'hidden' && /token|csrf|xsrf|fraud/i.test(name)) return
      if (element.type === 'checkbox' || element.type === 'radio') {
        if (!element.checked) return
        remember(formFields, name, element.value || 'true')
      } else if (element.value) {
        remember(formFields, name, element.value)
      }
    } else if (element instanceof HTMLSelectElement) {
      const option = element.selectedOptions[0]
      if (!option?.value) return
      remember(formFields, name, option.value)
      const label = fieldLabelFor(element)
      if (label) remember(labeledFields, label, option.textContent?.trim() || option.value)
    } else if (element.value) {
      remember(formFields, name, element.value)
    }

    const label = fieldLabelFor(element)
    const value = formFields[name]
    if (label && value) remember(labeledFields, label, value)

    const attributeName = attributeNameFromFormName(name)
    if (attributeName && value) remember(attributes, attributeName, value)
  })

  document
    .querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"], [role="combobox"], [data-testid*="select" i]')
    .forEach((trigger) => {
      if (!isVisible(trigger)) return
      const label = fieldLabelFor(trigger) || trigger.getAttribute('aria-label') || ''
      const text = stripHtml(trigger.textContent || '')
      const value = trigger.getAttribute('data-value') || text
      if (!label || !value || /^(select|choose|pick|--|please)/i.test(value)) return
      remember(labeledFields, label, value)
      const key = normalizeKey(label)
      if (key) remember(attributes, key, value)
    })

  const pushImage = (target: string[], value?: string | null) => {
    if (!value) return
    value
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter((part) => /^https?:/i.test(part) || part.startsWith('data:'))
      .forEach((url) => {
        if (/logo|icon|avatar|sprite|placeholder|emoji|pixel|data:image\/svg/i.test(url)) return
        if (!target.includes(url)) target.push(url)
      })
  }

  const readImageElement = (image: HTMLImageElement, target: string[]) => {
    pushImage(target, image.currentSrc || image.src)
    pushImage(target, image.getAttribute('data-src'))
    pushImage(target, image.getAttribute('data-url'))
    pushImage(target, image.getAttribute('data-original'))
    const srcset = image.getAttribute('srcset')
    if (srcset) {
      // Prefer the largest descriptor, but keep a single URL per <img> slot
      const candidates = srcset
        .split(',')
        .map((entry) => {
          const [url, size = '0'] = entry.trim().split(/\s+/)
          return { url, size: Number.parseInt(size, 10) || 0 }
        })
        .filter((entry) => entry.url)
      candidates.sort((a, b) => b.size - a.size)
      if (candidates[0]) pushImage(target, candidates[0].url)
    }
  }

  const galleryImages: string[] = []
  const galleryRoots = [
    ...document.querySelectorAll<HTMLElement>(
      '[class*="gallery" i], [class*="uploader" i], [class*="photo-list" i], [class*="image-list" i], [data-testid*="image" i], [data-testid*="photo" i]',
    ),
  ]
  const galleryScope = galleryRoots.length > 0 ? galleryRoots : [document.body]
  galleryScope.forEach((root) => {
    root.querySelectorAll<HTMLImageElement>('img').forEach((image) => readImageElement(image, galleryImages))
  })

  const otherImages: string[] = []
  document.querySelectorAll<HTMLImageElement>('img').forEach((image) => readImageElement(image, otherImages))

  document.querySelectorAll<HTMLElement>('[style*="background"]').forEach((element) => {
    const background = /url\(["']?(https?:[^"')]+)["']?\)/i.exec(element.getAttribute('style') || '')?.[1]
    pushImage(otherImages, background)
  })

  const hiddenImages =
    formFields.images ||
    formFields['postAdForm.images'] ||
    formFields['postAdForm.imageUrls'] ||
    formFields['images[]'] ||
    ''
  const orderedHidden: string[] = []
  pushImage(orderedHidden, hiddenImages)

  const jsonImages: string[] = []
  for (const script of document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__')) {
    const text = script.textContent || ''
    for (const match of text.matchAll(/"imageUrls"\s*:\s*\[([^\]]+)\]/gi)) {
      for (const urlMatch of match[1].matchAll(/"(https?:[^"]+)"/gi)) pushImage(jsonImages, urlMatch[1])
    }
    for (const match of text.matchAll(/https?:\\\/\\\/[^"\\]+?\.(?:jpg|jpeg|png|webp)/gi)) {
      pushImage(jsonImages, match[0].replace(/\\\//g, '/'))
    }
  }

  // Keep gallery/DOM order first; only append extras from weaker sources.
  images.push(...mergeImageLists(orderedHidden, galleryImages, jsonImages, otherImages))
  const tags = parseKijijiTags(scrapeKijijiTagsFromDom(), tagsFromFormFields(formFields, attributes))

  return {
    formFields,
    labeledFields,
    attributes,
    tags,
    images: images.slice(0, MAX_IMAGES),
  }
}

const parseFormFieldsFromHtml = (html: string) => {
  const formFields: Record<string, string> = {}
  const attributes: Record<string, string> = {}

  const inputPattern =
    /<(input|textarea|select)([^>]*)>(?:([\s\S]*?)<\/\1>)?/gi
  for (const match of html.matchAll(inputPattern)) {
    const tag = match[1].toLowerCase()
    const attrs = match[2] || ''
    const body = match[3] || ''
    const name = /name=["']([^"']+)["']/i.exec(attrs)?.[1]
    if (!name || SKIP_FIELD_NAMES.test(name)) continue
    const type = /type=["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase() || (tag === 'textarea' ? 'textarea' : tag)

    if (type === 'checkbox' || type === 'radio') {
      if (!/\schecked\b/i.test(attrs)) continue
      const value = /value=["']([^"']*)["']/i.exec(attrs)?.[1] || 'true'
      remember(formFields, name, decodeHtml(value))
    } else if (tag === 'textarea') {
      remember(formFields, name, decodeHtml(stripHtml(body)))
    } else if (tag === 'select') {
      const selected =
        /<option[^>]*\sselected\b[^>]*value=["']([^"']*)["'][^>]*>/i.exec(body) ||
        /<option[^>]*value=["']([^"']*)["'][^>]*\sselected\b[^>]*>/i.exec(body) ||
        /<option[^>]*\sselected\b[^>]*>([\s\S]*?)<\/option>/i.exec(body)
      if (selected?.[1]) remember(formFields, name, decodeHtml(stripHtml(selected[1])))
    } else {
      const value = /value=["']([^"']*)["']/i.exec(attrs)?.[1]
      if (value) remember(formFields, name, decodeHtml(value))
    }

    const attributeName = attributeNameFromFormName(name)
    if (attributeName && formFields[name]) remember(attributes, attributeName, formFields[name])
  }

  for (const match of html.matchAll(/"attributeMap"\s*:\s*(\{[\s\S]*?\})/g)) {
    try {
      const map = asRecord(JSON.parse(match[1]))
      if (!map) continue
      Object.entries(map).forEach(([key, value]) => {
        const text = Array.isArray(value) ? asString(value[0]) : asString(value) ?? (typeof value === 'number' ? String(value) : undefined)
        remember(attributes, key, text)
        remember(formFields, `postAdForm.attributeMap[${key}]`, text)
      })
    } catch {
      // ignore malformed JSON islands
    }
  }

  return { formFields, attributes }
}

const extractImagesFromHtml = (html: string) => {
  const images: string[] = []
  const patterns = [
    /property="og:image"\s+content="([^"]+)"/gi,
    /"(?:thumbnailUrl|imageUrl|url|src)"\s*:\s*"(https?:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
    /value="(https?:[^"]+)"[^>]*name="[^"]*image/gi,
  ]
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const url = decodeHtml(match[1])
      if (/^https?:/i.test(url) && !images.includes(url)) images.push(url)
    }
  }
  return mergeImageLists(images).slice(0, MAX_IMAGES)
}

const snapshotFromFormFields = (
  adId: string,
  pageUrl: string,
  formFields: Record<string, string>,
  attributes: Record<string, string>,
  labeledFields: Record<string, string>,
  images: string[],
  tags: string[] = [],
): KijijiAdSnapshot => {
  const title =
    formFields['postAdForm.title'] ||
    formFields['adTitle'] ||
    formFields.title ||
    formFields['postad-title'] ||
    ''
  const description =
    formFields['postAdForm.description'] ||
    formFields.description ||
    formFields['pstad-descrptn'] ||
    ''
  const priceType =
    formFields['postAdForm.priceType'] ||
    formFields.priceType ||
    formFields['price.type'] ||
    ''
  const rawPriceAmount =
    formFields['postAdForm.priceAmount'] ||
    formFields['price.amount'] ||
    formFields.priceAmount ||
    formFields.PriceAmount
  const parsedPrice = parseKijijiPrice(rawPriceAmount)
  const price =
    parsedPrice !== undefined && parsedPrice > 0
      ? parsedPrice
      : /free/i.test(priceType)
        ? 0
        : parsedPrice ?? 0
  if (price > 0) {
    remember(formFields, 'postAdForm.priceType', 'FIXED')
    remember(formFields, 'postAdForm.priceAmount', String(price))
  }
  const address =
    formFields['postAdForm.postalCode'] ||
    formFields['postAdForm.mapAddress'] ||
    formFields.postalCode ||
    formFields.mapAddress ||
    labeledFields.Location ||
    labeledFields.Address
  const location =
    formFields['postAdForm.city'] ||
    formFields.city ||
    formFields['postAdForm.mapAddress'] ||
    address ||
    ''
  const categoryId =
    formFields.categoryId ||
    formFields['postAdForm.categoryId'] ||
    formFields['category.id']
  const resolvedTags = parseKijijiTags(tags, tagsFromFormFields(formFields, attributes))
  if (resolvedTags.length > 0) {
    remember(formFields, 'postAdForm.tags', resolvedTags.join(','))
    remember(attributes, 'tags_s', resolvedTags.join(','))
  }

  return {
    externalId: adId,
    title: title.trim(),
    description: description.trim(),
    price,
    location: location.trim(),
    category: '',
    categoryId: categoryId || undefined,
    attributes,
    address: address || undefined,
    formFields,
    labeledFields,
    tags: resolvedTags,
    images,
    url: pageUrl.includes('edit') ? `https://www.kijiji.ca/v-view-details.html?adId=${adId}` : pageUrl,
  }
}

export const fetchKijijiAdFromEditPage = async (adId: string): Promise<KijijiAdSnapshot | null> => {
  const pageUrl = getKijijiEditUrl(adId)
  const response = await fetch(pageUrl, { credentials: 'include', cache: 'no-store' })
  if (!response.ok) return null
  const html = await response.text()
  if (/sign.?in|log.?in|create an account/i.test(html) && !/postAdForm|pstad|attributeMap/i.test(html)) return null
  const { formFields, attributes } = parseFormFieldsFromHtml(html)
  const images = extractImagesFromHtml(html)
  const tags = scrapeKijijiTagsFromHtml(html)
  const snapshot = snapshotFromFormFields(adId, response.url || pageUrl, formFields, attributes, {}, images, tags)
  if (!snapshot.title && Object.keys(formFields).length === 0) return null
  return snapshot
}

const waitForEditForm = async () => {
  const field = await waitFor(() => {
    const title =
      document.querySelector<HTMLInputElement>('#postad-title, input[name="postAdForm.title"], input[name="adTitle"], input[name="title"]')
    const description =
      document.querySelector<HTMLTextAreaElement>('#pstad-descrptn, textarea[name="postAdForm.description"], textarea[name="description"]')
    if (title && isVisible(title)) return title
    if (description && isVisible(description)) return description
    if (document.querySelector('form input, form textarea, form select')) return document.body
    return null
  }, EDIT_FORM_TIMEOUT_MS, 400)
  if (!field) throw new Error('Kijiji’s edit-ad form did not load. Are you signed in?')
  await delay(800)
}

export const captureKijijiEditPageSnapshot = async (adId: string, pageUrl = location.href): Promise<KijijiAdSnapshot> => {
  await waitForEditForm()
  const scraped = scrapeKijijiEditFormFromDom()
  const snapshot = snapshotFromFormFields(
    adId,
    pageUrl,
    scraped.formFields,
    scraped.attributes,
    scraped.labeledFields,
    scraped.images,
    scraped.tags,
  )
  if (!snapshot.title) throw new Error('Could not read the title from Kijiji’s edit-ad page')
  if (snapshot.description.length < 5) throw new Error('Could not read the description from Kijiji’s edit-ad page')
  return hydrateSnapshotImages({
    ...snapshot,
    externalId: extractKijijiAdId(pageUrl) || adId,
  })
}
