import { delay, findTextField, isVisible, setFieldValue, waitFor } from './dom'

export const MAX_KIJIJI_TAGS = 5

const TAG_FIELD_NAME = /tags?|keywords?/i
const TAG_LABEL = /^(tags?|keywords?)\b/i

export const normalizeKijijiTag = (value: string) =>
  value
    .replace(/^[#]+/, '')
    .replace(/\s+/g, ' ')
    .trim()

export const parseKijijiTags = (...sources: Array<string | string[] | undefined | null>) => {
  const tags: string[] = []
  const seen = new Set<string>()

  const push = (raw?: string) => {
    const tag = normalizeKijijiTag(raw || '')
    if (!tag || tag.length > 40) return
    if (/^(add|enter|type|select|tag|keyword)s?\b/i.test(tag)) return
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

export const tagsFromFormFields = (formFields: Record<string, string>, attributes: Record<string, string> = {}) => {
  const named = Object.entries(formFields)
    .filter(([name]) => TAG_FIELD_NAME.test(name))
    .map(([, value]) => value)
  const attributed = Object.entries(attributes)
    .filter(([name]) => TAG_FIELD_NAME.test(name))
    .map(([, value]) => value)
  return parseKijijiTags(...named, ...attributed, formFields['postAdForm.tags'], formFields.tags, formFields.tags_s, attributes.tags_s, attributes.tags)
}

export const scrapeKijijiTagsFromDom = () => {
  const tags: string[] = []

  const chipCandidates = [
    ...document.querySelectorAll<HTMLElement>(
      '[class*="tag" i], [class*="chip" i], [class*="keyword" i], [data-testid*="tag" i], [data-testid*="keyword" i]',
    ),
  ]

  chipCandidates.forEach((element) => {
    const context = `${element.className} ${element.getAttribute('data-testid') || ''} ${element.closest('[class*="tag" i], [class*="keyword" i], section, fieldset, div')?.textContent || ''}`
    if (!/tag|keyword/i.test(context)) return
    if (element.matches('input, textarea, button, a, svg, path')) return
    const text = (element.textContent || '').replace(/[×x✕✖]/gi, '').trim()
    if (!text || text.length > 40) return
    if (/add|enter|type|maximum|optional|up to/i.test(text) && text.split(/\s+/).length > 3) return
    tags.push(text)
  })

  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((field) => {
    const name = `${field.name} ${field.id} ${field.getAttribute('aria-label') || ''} ${field.placeholder || ''}`
    const label = [...(field.labels ?? [])].map((item) => item.textContent).join(' ')
    if (!TAG_FIELD_NAME.test(`${name} ${label}`)) return
    if (field.value) tags.push(field.value)
  })

  return parseKijijiTags(tags)
}

export const scrapeKijijiTagsFromHtml = (html: string) => {
  const matches: string[] = []
  const patterns = [
    /name=["'][^"']*tags?[^"']*["'][^>]*value=["']([^"']+)["']/gi,
    /value=["']([^"']+)["'][^>]*name=["'][^"']*tags?[^"']*["']/gi,
    /"tags?"\s*:\s*\[([^\]]+)\]/gi,
    /"tags?"\s*:\s*"([^"]+)"/gi,
    /"tags_s"\s*:\s*"([^"]+)"/gi,
    /attributeMap\[tags_s\][^>]*value=["']([^"']+)["']/gi,
  ]

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (match[1].includes('"')) {
        for (const item of match[1].matchAll(/"([^"]+)"/g)) matches.push(item[1])
      } else {
        matches.push(match[1])
      }
    }
  }

  return parseKijijiTags(matches)
}

const findTagsInput = () => {
  const byName =
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      'input[name*="tag" i], textarea[name*="tag" i], input[name*="keyword" i], textarea[name*="keyword" i], input[id*="tag" i], input[id*="keyword" i]',
    ) || null
  if (byName && isVisible(byName)) return byName

  const byLabel = findTextField([], TAG_LABEL)
  if (byLabel) return byLabel

  const labelled = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].find((field) => {
    if (!isVisible(field)) return false
    const text = [
      field.getAttribute('aria-label'),
      field.placeholder,
      ...[...(field.labels ?? [])].map((label) => label.textContent),
      field.closest('[class*="tag" i], [class*="keyword" i], [class*="field" i]')?.querySelector('label, legend, [class*="label" i]')?.textContent,
    ]
      .filter(Boolean)
      .join(' ')
    return TAG_LABEL.test(text) || /add tags?|add keywords?/i.test(text)
  })
  return labelled ?? null
}

const currentTagChips = () =>
  scrapeKijijiTagsFromDom().map((tag) => tag.toLowerCase())

const commitTag = async (input: HTMLInputElement | HTMLTextAreaElement, tag: string) => {
  input.focus()
  setFieldValue(input, tag)
  await delay(120)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', keyCode: 188, which: 188, bubbles: true }))
  await delay(250)

  if (!currentTagChips().includes(tag.toLowerCase()) && input.value.trim()) {
    const addButton = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].find((button) => {
      const text = `${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`
      return isVisible(button) && /^(add|create|save)\b/i.test(text.trim()) && /tag|keyword/i.test(text + (button.closest('[class*="tag" i], [class*="keyword" i]')?.textContent || ''))
    })
    addButton?.click()
    await delay(250)
  }

  if (input.value.trim()) setFieldValue(input, '')
}

export const fillKijijiTags = async (tags: string[], report?: (text: string) => void) => {
  const wanted = parseKijijiTags(tags)
  if (wanted.length === 0) return false

  report?.(`Adding ${wanted.length} tag${wanted.length === 1 ? '' : 's'}…`)
  const input = await waitFor(findTagsInput, 8_000)
  if (!input) {
    // Fall back to hidden/native fields when the chip UI is missing
    const native =
      document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[name="postAdForm.tags"], input[name="tags"], input[name="tags_s"], input[name="postAdForm.attributeMap[tags_s]"]',
      ) || null
    if (!native) return false
    setFieldValue(native, wanted.join(','))
    return true
  }

  for (const tag of wanted) {
    if (currentTagChips().includes(tag.toLowerCase())) continue
    if (currentTagChips().length >= MAX_KIJIJI_TAGS) break
    await commitTag(input, tag)
  }

  return currentTagChips().length > 0 || wanted.every((tag) => currentTagChips().includes(tag.toLowerCase()))
}
