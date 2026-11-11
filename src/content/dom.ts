import { dataUrlToFile } from '../shared/images'

export type TextField = HTMLInputElement | HTMLTextAreaElement

const TEXT_FIELD_SELECTOR =
  'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]), textarea'

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const isVisible = (element: Element) => {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

const getLabelTexts = (field: TextField): string[] => {
  const labelledBy = field.getAttribute('aria-labelledby')?.split(/\s+/) ?? []
  const texts = [
    field.getAttribute('aria-label'),
    field.placeholder,
    ...labelledBy.map((id) => document.getElementById(id)?.textContent),
    ...[...(field.labels ?? [])].map((label) => label.textContent?.replace(field.textContent ?? '', '')),
  ]
  return texts.map((text) => text?.trim() ?? '').filter(Boolean)
}

export const findTextField = (selectors: string[], labelPattern: RegExp): TextField | null => {
  for (const selector of selectors) {
    const element = document.querySelector<TextField>(selector)
    if (element && isVisible(element)) return element
  }
  const candidates = [...document.querySelectorAll<TextField>(TEXT_FIELD_SELECTOR)]
  return candidates.find((field) => isVisible(field) && getLabelTexts(field).some((text) => labelPattern.test(text))) ?? null
}

export const setFieldValue = (field: TextField, value: string) => {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  field.focus()
  if (nativeSetter) nativeSetter.call(field, value)
  else field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
  field.blur()
}

export const findImageInput = () =>
  document.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]') ??
  document.querySelector<HTMLInputElement>('input[type="file"]')

export const attachImages = (input: HTMLInputElement, images: string[]) => {
  const transfer = new DataTransfer()
  images.forEach((image, index) => transfer.items.add(dataUrlToFile(image, `photo-${index + 1}.jpg`)))
  input.files = transfer.files
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

export const findClickableByText = (root: ParentNode, pattern: RegExp) =>
  [...root.querySelectorAll<HTMLElement>('button, [role="button"], a')].find((element) => {
    const text = (element.textContent || element.getAttribute('aria-label') || '').trim()
    return isVisible(element) && pattern.test(text)
  }) ?? null

export const waitFor = async <T>(find: () => T | null, timeoutMs: number, intervalMs = 500): Promise<T | null> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = find()
    if (result) return result
    await delay(intervalMs)
  }
  return null
}
