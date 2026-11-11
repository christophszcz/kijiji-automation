const MAX_IMAGE_DIMENSION = 1600
const JPEG_QUALITY = 0.85

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
