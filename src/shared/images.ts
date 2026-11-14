import { MAX_IMAGES } from './constants'

const MAX_IMAGE_DIMENSION = 1600
const JPEG_QUALITY = 0.85

const imageQualityScore = (url: string) => {
  if (url.startsWith('data:')) return 10_000
  const sizeMatch = /s-l(\d{2,4})/i.exec(url) || /[_\-](\d{3,4})x\d{2,4}/i.exec(url) || /\/(\d{3,4})\//.exec(url)
  if (sizeMatch) return Number(sizeMatch[1])
  if (/original|full|large|1600|1200|\$_57|\$_1\./i.test(url)) return 1600
  if (/thumb|small|preview|\$_14|\$_2\./i.test(url)) return 120
  return 500
}

const normalizeImageKey = (url: string) => {
  if (url.startsWith('data:')) return url
  return url
    .split(/[?#]/)[0]
    .replace(/s-l\d+/gi, 's-lSIZE')
    .replace(/[_\-]\d{2,4}x\d{2,4}/gi, '_SIZE')
    .replace(/\/\d{2,4}\//g, '/SIZE/')
    .replace(/\$_\d+/g, '$_SIZE')
    .replace(/\.(jpe?g|png|webp|gif)$/i, '')
    .toLowerCase()
}

const KIJIJI_FULL_SIZE_RULE = 'kijijica-1600-jpg'

/** Kijiji media URLs encode size/format in `rule`; always copy the full-size JPEG Kijiji's uploader accepts. */
export const toFullSizeImageUrl = (url: string) => {
  if (!/^https?:\/\/media\.kijiji\.ca\//i.test(url)) return url
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('rule', KIJIJI_FULL_SIZE_RULE)
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Merge image lists while preserving gallery order.
 * The first list that contains an image establishes its position; later lists may
 * only upgrade that slot to a higher-quality URL or append truly new images.
 */
export const mergeImageLists = (...lists: Array<string[] | undefined | null>) => {
  const order: string[] = []
  const bestByKey = new Map<string, string>()

  for (const list of lists) {
    for (const rawImage of list ?? []) {
      if (!rawImage || (!rawImage.startsWith('data:') && !/^https?:/i.test(rawImage))) continue
      const image = toFullSizeImageUrl(rawImage)
      const key = normalizeImageKey(image)
      const existing = bestByKey.get(key)
      if (!existing) {
        bestByKey.set(key, image)
        order.push(key)
        continue
      }
      if (imageQualityScore(image) > imageQualityScore(existing)) {
        bestByKey.set(key, image)
      }
    }
  }

  return order.map((key) => bestByKey.get(key)!).slice(0, MAX_IMAGES)
}

/**
 * Use the first non-empty list as-is (deduped, in order). Lists are never combined,
 * so photos from a weaker source can't be appended to or reorder the real gallery.
 */
export const pickImageList = (...lists: Array<string[] | undefined | null>) => {
  for (const list of lists) {
    const images = mergeImageLists(list)
    if (images.length > 0) return images
  }
  return []
}

export const resizeImage = async (file: File): Promise<string> => {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not supported')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

export const dataUrlToFile = (dataUrl: string, fileName: string): File => {
  const [meta, base64 = ''] = dataUrl.split(',')
  const mimeType = /data:(.*?);/.exec(meta)?.[1] ?? 'image/jpeg'
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return new File([bytes], fileName, { type: mimeType })
}

export const urlToDataUrl = async (url: string): Promise<string> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not download image (${response.status})`)
  const blob = await response.blob()
  const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' })
  return resizeImage(file)
}

const FINGERPRINT_SIZE = 16
const DUPLICATE_DISTANCE = 12

/** Difference hash of the downscaled grayscale image; the same photo at any size yields a near-identical hash. */
const imageFingerprint = async (dataUrl: string): Promise<boolean[] | null> => {
  try {
    const bitmap = await createImageBitmap(dataUrlToFile(dataUrl, 'fingerprint'))
    const canvas = document.createElement('canvas')
    canvas.width = FINGERPRINT_SIZE + 1
    canvas.height = FINGERPRINT_SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    const luminance = (x: number, y: number) => {
      const offset = (y * canvas.width + x) * 4
      return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
    }
    const bits: boolean[] = []
    for (let y = 0; y < FINGERPRINT_SIZE; y += 1) {
      for (let x = 0; x < FINGERPRINT_SIZE; x += 1) bits.push(luminance(x, y) > luminance(x + 1, y))
    }
    return bits
  } catch {
    return null
  }
}

const hammingDistance = (a: boolean[], b: boolean[]) => a.reduce((distance, bit, index) => distance + (bit === b[index] ? 0 : 1), 0)

/** Drop photos that are visually the same as an earlier one (e.g. the cover captured at two sizes), keeping order. */
export const dedupeIdenticalImages = async (dataUrls: string[]) => {
  const kept: string[] = []
  const fingerprints: boolean[][] = []
  for (const dataUrl of dataUrls) {
    if (kept.includes(dataUrl)) continue
    const fingerprint = await imageFingerprint(dataUrl)
    if (fingerprint && fingerprints.some((existing) => hammingDistance(existing, fingerprint) <= DUPLICATE_DISTANCE)) continue
    kept.push(dataUrl)
    if (fingerprint) fingerprints.push(fingerprint)
  }
  return kept
}

const UPLOADABLE_DATA_URL = /^data:image\/(jpeg|png|gif|bmp);/i

export const resolveImagesForUpload = async (images: string[]) => {
  const resolved: string[] = []
  for (const [index, image] of mergeImageLists(images).entries()) {
    if (UPLOADABLE_DATA_URL.test(image)) {
      resolved.push(image)
      continue
    }
    if (image.startsWith('data:')) {
      try {
        resolved.push(await resizeImage(dataUrlToFile(image, 'photo')))
      } catch {
        console.warn(`ListSync could not convert image ${index + 1} for upload`)
      }
      continue
    }
    try {
      resolved.push(await urlToDataUrl(image))
    } catch {
      console.warn(`ListSync could not prepare image ${index + 1} for upload`)
    }
  }
  return dedupeIdenticalImages(resolved)
}
