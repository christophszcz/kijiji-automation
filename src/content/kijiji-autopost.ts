import { resolveImagesForUpload } from '../shared/images'
import type { ItemCondition, Listing } from '../shared/types'
import { attachImagesSequentially, delay, findImageInput, findTextField, isVisible, setFieldValue, waitFor, type TextField } from './dom'

type StatusReporter = (text: string) => void

const FORM_TIMEOUT_MS = 30_000
const PHOTO_UPLOAD_TIMEOUT_MS = 45_000
const DROPDOWN_TIMEOUT_MS = 8_000

const CONDITION_VALUES: Record<ItemCondition, string[]> = {
  new: ['new'],
  like_new: ['usedlikenew', 'likenew', 'like new', 'used - like new'],
  good: ['usedgood', 'good', 'used - good'],
  fair: ['usedfair', 'fair', 'used - fair'],
}

const DEFAULT_ATTRIBUTES: Record<string, string[]> = {
  forsaleby: ['ownr', 'owner', 'offering'],
  condition: [],
}

export class KijijiAutoPostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KijijiAutoPostError'
  }
}

const TITLE_SELECTORS = ['#postad-title', 'input[name="postAdForm.title"]', 'input[name="adTitle"]', 'input[name="title"]']
const DESCRIPTION_SELECTORS = ['#pstad-descrptn', 'textarea[name="postAdForm.description"]', 'textarea[name="description"]']
const PRICE_SELECTORS = ['#PriceAmount', 'input[name="postAdForm.priceAmount"]', 'input[name="price.amount"]', 'input[name="priceAmount"]']

const normalize = (value: string) => value.replace(/[\s_-]+/g, '').toLowerCase()

const attributeKey = (name: string) =>
  normalize(name)
    .replace(/^postadformattributemap/, '')
    .replace(/attributemap/, '')
    .replace(/[sbdil]$/, '')

const labelText = (element: HTMLElement) =>
  [
    element.getAttribute('aria-label'),
    element.getAttribute('name'),
    element.getAttribute('data-testid'),
    element.id,
    element.getAttribute('placeholder'),
    ...[...((element as HTMLInputElement).labels ?? [])].map((label) => label.textContent),
  ]
    .filter(Boolean)
    .join(' ')

const nearbyLabel = (element: HTMLElement) => {
  const own = labelText(element)
  const labelledBy = element
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent)
    .filter(Boolean)
    .join(' ')
  const parentLabel = element.closest('label')?.textContent
  const fieldset = element.closest('fieldset')?.querySelector('legend')?.textContent
  const previous = element.previousElementSibling?.textContent
  const containerLabel = element
    .closest('[class*="field" i], [class*="form" i], [class*="attribute" i], [data-testid], li, div')
    ?.querySelector('label, legend, [class*="label" i], span, p')
    ?.textContent
  return [own, labelledBy, parentLabel, fieldset, previous, containerLabel].filter(Boolean).join(' ')
}

const clickByText = (root: ParentNode, pattern: RegExp) => {
  const candidates = [
    ...root.querySelectorAll<HTMLElement>(
      'button, a, label, summary, [role="button"], [role="radio"], [role="option"], [role="tab"], input[type="submit"]',
    ),
  ]
  const match = candidates.find((element) => {
    const text = `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''} ${(element as HTMLInputElement).value ?? ''}`.trim()
    return isVisible(element) && pattern.test(text)
  })
  match?.click()
  return match ?? null
}

const expandMoreInfoSection = async () => {
  const triggers = [
    ...document.querySelectorAll<HTMLElement>('button, a, summary, [role="button"], [role="tab"], h2, h3, h4, legend'),
  ].filter((element) => {
    const text = `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`.trim()
    return isVisible(element) && /^more\s*info\b/i.test(text)
  })

  for (const trigger of triggers) {
    const expanded = trigger.getAttribute('aria-expanded')
    if (expanded === 'true') continue
    trigger.click()
    await delay(400)
  }
}

const setSelectValue = (select: HTMLSelectElement, value: string) => {
  const target = normalize(value)
  const option = [...select.options].find((item) => {
    const optionText = normalize(item.textContent ?? '')
    const optionValue = normalize(item.value)
    return optionValue === target || optionText === target || optionText.includes(target) || target.includes(optionText)
  })
  if (!option || !option.value) return false
  select.value = option.value
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

const isUnsetSelect = (select: HTMLSelectElement) => {
  const option = select.selectedOptions[0]
  if (!option) return true
  const text = (option.textContent ?? '').trim()
  return !option.value || /^(select|choose|pick|--|please)/i.test(text)
}

const dropdownTriggers = () =>
  [...document.querySelectorAll<HTMLElement>('button, [role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"], [data-testid*="select" i]')].filter(
    (element) => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) return false
      if (element instanceof HTMLButtonElement && element.type === 'submit') return false
      const text = `${element.textContent ?? ''} ${labelText(element)}`.trim()
      return (
        element.getAttribute('aria-haspopup') === 'listbox' ||
        element.getAttribute('role') === 'combobox' ||
        /select|choose|pick|condition|sale by|more info|please/i.test(text) ||
        Boolean(element.closest('[class*="select" i], [class*="dropdown" i], [data-testid*="select" i]'))
      )
    },
  )

const isUnsetDropdown = (trigger: HTMLElement) => {
  const text = (trigger.textContent ?? '').trim()
  const value = trigger.getAttribute('data-value') || trigger.getAttribute('value') || ''
  if (trigger.getAttribute('aria-invalid') === 'true') return true
  if (!value && /^(select|choose|pick|--|please select)/i.test(text)) return true
  if (!value && text.length < 2) return true
  return false
}

const openDropdownOptions = async (trigger: HTMLElement) => {
  trigger.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
  trigger.click()
  await delay(250)
  const options = await waitFor(() => {
    const found = [
      ...document.querySelectorAll<HTMLElement>('[role="option"], [role="menuitem"], [role="listbox"] li, ul[role="listbox"] li, [class*="option" i], [class*="menu" i] li'),
    ].filter((option) => isVisible(option) && (option.textContent ?? '').trim().length > 0)
    return found.length > 0 ? found : null
  }, DROPDOWN_TIMEOUT_MS, 150)
  return options ?? []
}

const pickOption = async (trigger: HTMLElement, values: string[]) => {
  const options = await openDropdownOptions(trigger)
  if (options.length === 0) {
    document.body.click()
    return false
  }

  const targets = values.map(normalize).filter(Boolean)
  const match =
    options.find((option) => {
      const text = normalize(option.textContent ?? '')
      const value = normalize(option.getAttribute('data-value') || option.getAttribute('value') || '')
      return targets.some((target) => text === target || value === target || text.includes(target) || target.includes(text))
    }) ?? null

  if (!match) {
    document.body.click()
    return false
  }

  match.click()
  await delay(200)
  return true
}

const fieldsMatchingAttribute = (name: string) => {
  const key = attributeKey(name)
  const all = [
    ...document.querySelectorAll<HTMLElement>(
      'select, input[type="radio"], input[type="checkbox"], input[type="text"], input[type="number"], button, [role="combobox"], [aria-haspopup="listbox"]',
    ),
  ]
  return all.filter((element) => {
    if (!isVisible(element)) return false
    const haystack = normalize(`${labelText(element)} ${nearbyLabel(element)} ${(element as HTMLInputElement).name ?? ''}`)
    return haystack.includes(key) || (key.length > 3 && haystack.includes(key.slice(0, -1)))
  })
}

const applyAttributeValues = async (name: string, values: string[]) => {
  const usable = values.filter(Boolean)
  if (usable.length === 0) return false

  for (const field of fieldsMatchingAttribute(name)) {
    if (field instanceof HTMLSelectElement) {
      if (usable.some((value) => setSelectValue(field, value))) return true
      continue
    }
    if (field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox')) {
      const matches = usable.some(
        (value) => normalize(field.value) === normalize(value) || normalize(nearbyLabel(field)).includes(normalize(value)),
      )
      if (matches) {
        if (!field.checked) field.click()
        return true
      }
      continue
    }
    if (field instanceof HTMLInputElement && (field.type === 'text' || field.type === 'number')) {
      if (!field.value) {
        setFieldValue(field, usable[0])
        return true
      }
      continue
    }
    if (await pickOption(field, usable)) return true
  }

  return false
}

const applyCondition = async (condition: ItemCondition) => {
  const values = CONDITION_VALUES[condition]
  return (await applyAttributeValues('condition', values)) || (await applyAttributeValues('condition_s', values))
}

const fillText = (selectors: string[], label: RegExp, value: string) => {
  const field = findTextField(selectors, label)
  if (!field) return false
  if (field.value !== value) setFieldValue(field, value)
  return true
}

const fillLocation = async (address?: string) => {
  if (!address) return
  const field = findTextField(['input[name*="location" i]', 'input[name*="address" i]', 'input[name*="postal" i]'], /(postal|address|location)/i)
  if (!field || field.value.trim()) return
  setFieldValue(field, address)
  field.focus()
  await delay(1200)
  const option = document.querySelector<HTMLElement>('[role="option"], [role="listbox"] li, [class*="suggestion" i] li')
  option?.click()
}

const selectFreePackage = () => {
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
  const basic = radios.find((radio) => {
    const text = `${radio.name} ${radio.value} ${labelText(radio)} ${nearbyLabel(radio)}`
    if (/price|pricetype|amount/i.test(text)) return false
    return /pkg_basic|featurepackage|feature package|package.*basic|\bbasic\b.*package|package.*\bfree\b/i.test(text)
  })
  if (basic && !basic.checked) basic.click()
}

const resolveListingPrice = (listing: Listing) => {
  const candidates = [
    listing.price,
    parseFloat(listing.kijiji?.formFields?.['postAdForm.priceAmount'] || ''),
    parseFloat(listing.kijiji?.formFields?.priceAmount || ''),
    parseFloat(listing.kijiji?.formFields?.PriceAmount || ''),
    parseFloat(listing.kijiji?.formFields?.['price.amount'] || ''),
  ]
  const paid = candidates.find((value) => Number.isFinite(value) && value > 0)
  if (paid !== undefined) return paid
  return Number.isFinite(listing.price) ? listing.price : 0
}

const setPriceType = async (type: 'FIXED' | 'FREE' | 'CONTACT') => {
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
  const match = radios.find((radio) => {
    const text = `${radio.name} ${radio.value} ${labelText(radio)} ${nearbyLabel(radio)}`
    if (!/price|pricetype|amount|offer/i.test(text) && !/^(FIXED|FREE|CONTACT)$/i.test(radio.value)) return false
    return normalize(radio.value) === normalize(type) || new RegExp(`\\b${type}\\b`, 'i').test(text)
  })
  if (match && !match.checked) {
    match.click()
    await delay(200)
  }

  const buttons = [...document.querySelectorAll<HTMLElement>('button, [role="radio"], [role="tab"], label')]
  const button = buttons.find((element) => {
    const text = `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`
    if (/package|bump|feature|promote/i.test(text)) return false
    if (type === 'FIXED') return /^(price|fixed price|set price|\$)$/i.test(text.trim()) || /\bfixed\b/i.test(text)
    if (type === 'FREE') return /^(free|give.?away)$/i.test(text.trim())
    return /\bcontact\b/i.test(text)
  })
  button?.click()
}

const ensureCorrectPrice = async (listing: Listing, report: StatusReporter) => {
  const price = resolveListingPrice(listing)
  if (price > 0) {
    report(`Setting price to $${price}…`)
    await setPriceType('FIXED')
    fillText(PRICE_SELECTORS, /^(price|amount)\b/i, String(price))
    const amountField = findTextField(PRICE_SELECTORS, /^(price|amount)\b/i)
    if (amountField && (!amountField.value || Number(amountField.value) === 0)) {
      setFieldValue(amountField, String(price))
    }
    return
  }
  await setPriceType('FREE')
}

const acceptTerms = () => {
  document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
    if (/terms|confirm|agree|policy/i.test(labelText(checkbox)) && !checkbox.checked) checkbox.click()
  })
}

const countUploadedPhotos = () => {
  const previews = document.querySelectorAll('[class*="image" i] img, [class*="photo" i] img, [class*="thumbnail" i] img, [data-testid*="image" i] img')
  return [...previews].filter((img) => isVisible(img) && !/placeholder|icon|logo/i.test((img as HTMLImageElement).src)).length
}

const uploadPhotos = async (images: string[], report: StatusReporter) => {
  if (images.length === 0) return
  report(`Preparing ${images.length} photo${images.length === 1 ? '' : 's'}…`)
  const prepared = await resolveImagesForUpload(images)
  if (prepared.length === 0) throw new KijijiAutoPostError('Could not prepare the saved photos for upload')
  const input = await waitFor(findImageInput, FORM_TIMEOUT_MS)
  if (!input) throw new KijijiAutoPostError('Could not find the photo uploader on Kijiji’s form')

  try {
    await attachImagesSequentially(prepared, {
      findInput: findImageInput,
      countUploaded: countUploadedPhotos,
      timeoutMs: Math.max(15_000, Math.floor(PHOTO_UPLOAD_TIMEOUT_MS / Math.max(prepared.length, 1))),
      onProgress: (index, total) => report(`Uploading photo ${index} of ${total}…`),
    })
  } catch (error) {
    throw new KijijiAutoPostError(error instanceof Error ? error.message : 'Photo upload failed')
  }

  const uploaded = countUploadedPhotos()
  if (uploaded < prepared.length) {
    report(`Uploaded ${uploaded} of ${prepared.length} photos — waiting a moment…`)
    await delay(3000)
  }
}

const isSelectCategoryPage = () => /select-category/i.test(location.pathname)

export const pickCategoryFromSuggestions = async (listing: Listing, report: StatusReporter) => {
  report('Choosing the category…')
  const titleField = await waitFor(() => findTextField(TITLE_SELECTORS, /^(ad )?title\b/i), FORM_TIMEOUT_MS)
  if (titleField) setFieldValue(titleField, listing.title)
  await delay(2000)

  const wanted = listing.category.trim().toLowerCase()
  const suggestion =
    (wanted && clickByText(document, new RegExp(wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))) ||
    document.querySelector<HTMLElement>('[data-testid*="category" i] button, [class*="category" i] button, [class*="suggest" i] button, [role="radio"]')
  if (!suggestion) throw new KijijiAutoPostError('Kijiji did not suggest a category. Sync the ad again so its category is saved.')
  suggestion.click()
  await delay(800)
  clickByText(document, /^(next|continue|go)\b/i)
}

const findSubmitButton = () =>
  [...document.querySelectorAll<HTMLElement>('button[type="submit"], input[type="submit"], button')].find((button) => {
    const text = `${button.textContent ?? ''} ${(button as HTMLInputElement).value ?? ''}`.trim()
    return isVisible(button) && /post (your )?ad|post listing|publish|submit/i.test(text)
  }) ?? null

const collectErrors = () =>
  [...document.querySelectorAll<HTMLElement>('[role="alert"], [class*="error" i], [aria-invalid="true"]')]
    .map((element) => {
      const text = element.textContent?.trim() ?? ''
      const label = nearbyLabel(element)
      return text || label
    })
    .filter((text): text is string => Boolean(text && text.length > 2 && text.length < 220))
    .slice(0, 5)

const waitForAttributeFields = async () => {
  await waitFor(() => {
    const selects = [...document.querySelectorAll('select')].filter((element) => isVisible(element))
    const customs = dropdownTriggers()
    return selects.length + customs.length > 0 ? true : null
  }, 8_000, 400)
}

const findFieldByName = (name: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    `[name="${CSS.escape(name)}"], #${CSS.escape(name)}`,
  )

const applyNamedFormFields = async (formFields: Record<string, string>, listing: Listing, report: StatusReporter) => {
  const entries = Object.entries(formFields)
  if (entries.length === 0) return
  report(`Restoring ${entries.length} fields from the edit-ad page…`)
  const paidPrice = resolveListingPrice(listing)

  for (const [name, value] of entries) {
    if (/priceType|price\.type/i.test(name)) {
      if (paidPrice > 0 && /free/i.test(value)) continue
      continue
    }
    if (/priceAmount|price\.amount|PriceAmount/i.test(name) && paidPrice > 0) {
      const field = findFieldByName(name)
      if (field && !(field instanceof HTMLSelectElement)) setFieldValue(field, String(paidPrice))
      continue
    }
    if (/featurePackage|featuresForm/i.test(name)) continue

    const field = findFieldByName(name)
    if (!field) {
      const attributeName = /attributeMap\[([^\]]+)\]/i.exec(name)?.[1]
      if (attributeName) await applyAttributeValues(attributeName, [value])
      continue
    }

    if (field instanceof HTMLSelectElement) {
      setSelectValue(field, value)
      continue
    }
    if (field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox')) {
      const text = `${field.name} ${field.value} ${labelText(field)} ${nearbyLabel(field)}`
      if (paidPrice > 0 && /pricetype|price type/i.test(text) && /free/i.test(`${field.value} ${text}`)) continue
      const match = [...document.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`)].find(
        (input) => input.value === value || normalize(input.value) === normalize(value),
      )
      if (match && !match.checked) match.click()
      continue
    }
    if (field.value !== value) setFieldValue(field, value)
  }
}

const applyLabeledFormFields = async (labeledFields: Record<string, string>) => {
  for (const [label, value] of Object.entries(labeledFields)) {
    await applyAttributeValues(label, [value])
  }
}

const fillSavedAttributes = async (listing: Listing, report: StatusReporter) => {
  report('Filling More Info dropdowns…')
  await expandMoreInfoSection()
  await waitForAttributeFields()

  await applyNamedFormFields(listing.kijiji?.formFields ?? {}, listing, report)
  await applyLabeledFormFields(listing.kijiji?.labeledFields ?? {})

  const attributes = { ...listing.kijiji?.attributes }
  for (const [name, value] of Object.entries(attributes)) {
    await applyAttributeValues(name, [value])
  }

  if (!attributes.condition && !attributes.condition_s) await applyCondition(listing.condition)

  for (const [name, defaults] of Object.entries(DEFAULT_ATTRIBUTES)) {
    if (name === 'condition') {
      await applyCondition(listing.condition)
      continue
    }
    const saved = attributes[name] || attributes[`${name}_s`]
    await applyAttributeValues(name, saved ? [saved, ...defaults] : defaults)
  }
}

const fillUnsetDropdowns = async (listing: Listing, report: StatusReporter) => {
  report('Checking required More Info fields…')
  await expandMoreInfoSection()

  const conditionValues = CONDITION_VALUES[listing.condition]
  const preferredValues = [
    ...Object.values(listing.kijiji?.formFields ?? {}),
    ...Object.values(listing.kijiji?.labeledFields ?? {}),
    ...Object.values(listing.kijiji?.attributes ?? {}),
    ...conditionValues,
    'ownr',
    'owner',
    'offering',
  ]

  for (const select of [...document.querySelectorAll('select')].filter((element) => isVisible(element) && isUnsetSelect(element))) {
    const names = [nearbyLabel(select), select.name, select.id]
    const isCondition = names.some((name) => /condition/i.test(name))
    const isForSaleBy = names.some((name) => /forsaleby|for sale by|offered by/i.test(name))
    const values = isCondition ? conditionValues : isForSaleBy ? ['ownr', 'owner', 'offering'] : preferredValues
    if (!values.some((value) => setSelectValue(select, value))) {
      const firstReal = [...select.options].find((option) => option.value && !/^(select|choose|pick|--)/i.test(option.textContent ?? ''))
      if (firstReal) setSelectValue(select, firstReal.value)
    }
  }

  for (const trigger of dropdownTriggers().filter(isUnsetDropdown)) {
    const names = [nearbyLabel(trigger), labelText(trigger), trigger.textContent ?? '']
    const isCondition = names.some((name) => /condition/i.test(name))
    const isForSaleBy = names.some((name) => /forsaleby|for sale by|offered by/i.test(name))
    const values = isCondition ? conditionValues : isForSaleBy ? ['ownr', 'owner', 'offering'] : preferredValues
    if (await pickOption(trigger, values)) continue

    const options = await openDropdownOptions(trigger)
    const firstReal = options.find((option) => {
      const text = (option.textContent ?? '').trim()
      return text.length > 0 && !/^(select|choose|pick|--|please)/i.test(text)
    })
    if (firstReal) {
      firstReal.click()
      await delay(200)
    } else {
      document.body.click()
    }
  }
}

const stillUnsetRequired = () => {
  const unsetSelects = [...document.querySelectorAll('select')].filter(
    (element) => isVisible(element) && (element.required || element.getAttribute('aria-required') === 'true') && isUnsetSelect(element),
  )
  const unsetCustoms = dropdownTriggers().filter(
    (element) => (element.getAttribute('aria-required') === 'true' || element.getAttribute('aria-invalid') === 'true') && isUnsetDropdown(element),
  )
  return [...unsetSelects, ...unsetCustoms]
}

export interface KijijiAutoPostInput {
  listing: Listing
  report: StatusReporter
}

export const autoPostKijiji = async ({ listing, report }: KijijiAutoPostInput) => {
  if (isSelectCategoryPage()) {
    await pickCategoryFromSuggestions(listing, report)
    return 'navigating' as const
  }

  report('Filling in your saved ad from the edit-ad copy…')
  const titleField = await waitFor<TextField>(() => findTextField(TITLE_SELECTORS, /^(ad )?title\b/i), FORM_TIMEOUT_MS)
  if (!titleField) throw new KijijiAutoPostError('Kijiji’s post form did not load')

  const formFields = listing.kijiji?.formFields ?? {}
  const title =
    formFields['postAdForm.title'] || formFields.adTitle || formFields.title || listing.title
  const description =
    formFields['postAdForm.description'] || formFields.description || listing.description
  const price = resolveListingPrice(listing)

  fillText(TITLE_SELECTORS, /^(ad )?title\b/i, title)
  fillText(DESCRIPTION_SELECTORS, /^description\b/i, description)
  if (price > 0) {
    await setPriceType('FIXED')
    fillText(PRICE_SELECTORS, /^(price|amount)\b/i, String(price))
  }

  await applyNamedFormFields(formFields, listing, report)
  await fillSavedAttributes(listing, report)
  await ensureCorrectPrice(listing, report)
  await fillLocation(
    listing.kijiji?.address ||
      formFields['postAdForm.postalCode'] ||
      formFields['postAdForm.mapAddress'] ||
      formFields.postalCode,
  )
  await uploadPhotos(listing.images, report)
  await fillUnsetDropdowns(listing, report)

  const leftover = stillUnsetRequired()
  if (leftover.length > 0) {
    await fillUnsetDropdowns(listing, report)
  }

  selectFreePackage()
  await ensureCorrectPrice(listing, report)
  acceptTerms()
  await delay(500)

  const submit = findSubmitButton()
  if (!submit) throw new KijijiAutoPostError('Could not find Kijiji’s “Post Your Ad” button')
  report('Posting your ad…')
  submit.click()

  const startedAt = Date.now()
  let retriedForDropdowns = false
  while (Date.now() - startedAt < 45_000) {
    await delay(1000)
    if (!/^\/p-/.test(location.pathname) || new URL(location.href).searchParams.has('adId')) return 'submitted' as const
    const errors = collectErrors()
    const mentionsMoreInfo = errors.some((error) => /more\s*info|select|required|condition|dropdown/i.test(error))
    if (mentionsMoreInfo && !retriedForDropdowns) {
      retriedForDropdowns = true
      report('More Info dropdown was missed — filling it and trying again…')
      await fillUnsetDropdowns(listing, report)
      findSubmitButton()?.click()
      continue
    }
    if (errors.length > 0 && Date.now() - startedAt > 4000) {
      throw new KijijiAutoPostError(`Kijiji rejected the post: ${errors.join(' · ')}`)
    }
  }
  throw new KijijiAutoPostError('Kijiji did not confirm the new ad in time')
}
