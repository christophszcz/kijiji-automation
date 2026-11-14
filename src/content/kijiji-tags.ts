import { delay, findTextField, isVisible, setFieldValue, waitFor } from './dom'

export const MAX_KIJIJI_TAGS = 5

const TAG_LABEL = /^(tags?|keywords?)\b/i
const TAGS_VALUE_SELECTOR = 'input[name="postAdForm.tags"], #pstad-tags'
const TAG_ENTRY_SELECTOR = 'input[name="postAdForm.tagsInput"], #pstad-tagsInput'
const TAG_CHIP_SELECTOR = '[class*="tagsList" i] [class*="tagItem" i]'

type TagSource = string | string[] | undefined | null

export const normalizeKijijiTag = (value: string) =>
  value
    .replace(/^[#]+/, '')
    .replace(/\s+/g, ' ')
    .trim()

export const parseKijijiTags = (...sources: TagSource[]) => {
  const tags: string[] = []
  const seen = new Set<string>()

  const push = (raw?: string) => {
    const tag = normalizeKijijiTag(raw || '')
    if (!tag || tag.length > 40) return
    const key = tag.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    tags.push(tag)
  }

  for (const source of sources) {
    if (!source) continue
    if (Array.isArray(source)) {
      source.forEach((item) => push(item))
      continue
    }
    source
      .split(/[,|;]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => push(part))
  }

  return tags.slice(0, MAX_KIJIJI_TAGS)
}

/** Tags from the first source that has any — sources are never merged, so stale tags can't leak in. */
export const pickKijijiTags = (...sources: TagSource[]) => {
  for (const source of sources) {
    const tags = parseKijijiTags(source)
    if (tags.length > 0) return tags
  }
  return []
}

export const tagsFromFormFields = (formFields: Record<string, string>, attributes: Record<string, string> = {}) =>
  pickKijijiTags(
    formFields['postAdForm.tags'],
    formFields['postAdForm.attributeMap[tags_s]'],
    formFields.tags,
    formFields.tags_s,
    attributes.tags_s,
    attributes.tags,
  )

export const scrapeKijijiTagsFromDom = (root: ParentNode = document) =>
  pickKijijiTags(
    root.querySelector<HTMLInputElement>(TAGS_VALUE_SELECTOR)?.value,
    [...root.querySelectorAll<HTMLElement>(TAG_CHIP_SELECTOR)].map((chip) => chip.textContent?.trim() ?? ''),
  )

export const scrapeKijijiTagsFromHtml = (html: string) => {
  const fromForm = scrapeKijijiTagsFromDom(new DOMParser().parseFromString(html, 'text/html'))
  if (fromForm.length > 0) return fromForm

  const match = /"tags(?:_s)?"\s*:\s*("(?:[^"\\]|\\.)*"|\[[^\]]*\])/.exec(html)
  if (!match) return []
  try {
    const value: unknown = JSON.parse(match[1])
    if (Array.isArray(value)) return parseKijijiTags(value.filter((item): item is string => typeof item === 'string'))
    return typeof value === 'string' ? parseKijijiTags(value) : []
  } catch {
    return []
  }
}

const findTagsInput = () => {
  const input = document.querySelector<HTMLInputElement>(TAG_ENTRY_SELECTOR)
  if (input && isVisible(input)) return input
  return findTextField([], TAG_LABEL)
}

const findAddButton = (input: Element) => {
  let container = input.parentElement
  for (let depth = 0; container && depth < 6; depth++, container = container.parentElement) {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => isVisible(candidate) && /^add$/i.test(candidate.textContent?.trim() ?? ''),
    )
    if (button) return button
  }
  return null
}

const currentTags = () => scrapeKijijiTagsFromDom()

const hasTag = (tag: string) => currentTags().some((existing) => existing.toLowerCase() === tag.toLowerCase())

const sameTags = (left: string[], right: string[]) =>
  left.length === right.length && left.every((tag, index) => tag.toLowerCase() === right[index].toLowerCase())

const typeIntoTagsInput = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  input.focus()
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const removeAllTags = async () => {
  for (let attempt = 0; attempt < MAX_KIJIJI_TAGS * 2; attempt++) {
    // Kijiji re-renders the list after every removal, so the button has to be looked up fresh each time.
    const removeButton = document.querySelector<HTMLElement>(`${TAG_CHIP_SELECTOR} button`)
    if (!removeButton) return
    removeButton.click()
    await delay(250)
  }
}

// Typing then clicking "Add" adds exactly the typed text. Enter is ignored by Kijiji's
// tag box, and its suggestion list must never be picked from.
const addTag = async (tag: string) => {
  const input = findTagsInput()
  if (!input) return false
  typeIntoTagsInput(input, tag)
  await delay(300)
  const addButton = findAddButton(input)
  if (!addButton) return false
  addButton.click()
  const added = await waitFor(() => hasTag(tag) || null, 3_000, 150)
  const leftover = findTagsInput()
  if (leftover?.value) typeIntoTagsInput(leftover, '')
  return Boolean(added)
}

export const fillKijijiTags = async (tags: string[], report?: (text: string) => void) => {
  const wanted = parseKijijiTags(tags)
  if (wanted.length === 0) return false

  const input = await waitFor(findTagsInput, 8_000)
  if (!input) {
    const native = document.querySelector<HTMLInputElement>(TAGS_VALUE_SELECTOR)
    if (!native) return false
    setFieldValue(native, wanted.join(','))
    return true
  }

  if (sameTags(currentTags(), wanted)) return true

  report?.(`Adding ${wanted.length} tag${wanted.length === 1 ? '' : 's'}: ${wanted.join(', ')}…`)
  await removeAllTags()
  for (const tag of wanted) {
    if (await addTag(tag) || hasTag(tag)) continue
    if (!(await addTag(tag))) break
  }

  const actual = currentTags()
  if (sameTags(actual, wanted)) return true
  report?.(`Kijiji only accepted tags: ${actual.join(', ') || 'none'} (expected ${wanted.join(', ')})`)
  return false
}
