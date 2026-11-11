import { MAX_IMAGES } from './constants'

const MAX_IMAGE_DIMENSION = 1600
const JPEG_QUALITY = 0.85

const imageQualityScore = (url: string) => {
  if (url.startsWith('data:')) return 10_000
  const sizeMatch = /s-l(\d{2,4})/i.exec(url) || /[_\-](\d{3,4})x\d{2,4}/i.exec(url) || /\/(\d{3,4})\//.exec(url)
  if (sizeMatch) return Number(sizeMatch[1])
  if (/original|full|large|1600|1200|$_57|$_1\./i.test(url)) return 1600
  if (/thumb|small|preview|$_14|$_2\./i.test(url)) return 120
  return 500
}

const normalizeImageKey = (url: string) => {
  if (url.startsWith('data:')) return url.slice(0, 64)
  return url
    .split('?')[0]
    .replace(/s-l\d+/gi, 's-lSIZE')
    .replace(/[_\-]\d{2,4}x\d{2,4}/gi, '_SIZE')
    .replace(/\/\d{2,4}\//g, '/SIZE/')
    .replace(/_\$_\d+/gi, '_$_SIZE')
    .toLowerCase()
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
    for (const image of list ?? []) {
      if (!image || (!image.startsWith('data:') && !/^https?:/i.test(image))) continue
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

export const resolveImagesForUpload = async (images: string[]) => {
  const resolved: string[] = []
  for (const [index, image] of images.entries()) {
    if (image.startsWith('data:')) {
      resolved.push(image)
      continue
    }
    if (!/^https?:/i.test(image)) continue
    try {
      resolved.push(await urlToDataUrl(image))
    } catch {
      console.warn(`ListSync could not prepare image ${index + 1} for upload`)
    }
  }
  return resolved
}
