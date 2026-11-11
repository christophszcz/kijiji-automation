import { PLATFORMS } from '../shared/constants'
import { sendMessage } from '../shared/messages'
import type { ImportJob, JobContext } from '../shared/types'
import type { Banner } from './banner'
import { delay, findClickableByText, waitFor } from './dom'
import { runFacebookImport } from './facebook-import'
import { runContentScript, type PlatformAdapter, type RefreshOutcome } from './runner'

const RENEW_PATTERN = /^(renew|relist)\b/i
const CARD_SEARCH_DEPTH = 10

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase()

const findRenewButton = (title: string) => {
  const target = normalize(title)
  const titleNodes = [...document.querySelectorAll<HTMLElement>('span, a, div')].filter(
    (element) => element.children.length === 0 && normalize(element.textContent ?? '') === target,
  )
  for (const node of titleNodes) {
    let card: HTMLElement | null = node
    for (let depth = 0; card && depth < CARD_SEARCH_DEPTH; depth++) {
      const button = findClickableByText(card, RENEW_PATTERN)
      if (button) return button
      card = card.parentElement
    }
  }
  return null
}

const renewOnSellingPage = async ({ listing }: JobContext, banner: Banner): Promise<RefreshOutcome> => {
  if (!location.pathname.startsWith('/marketplace/you/selling')) return { status: 'continue' }
  banner.setStatus(`Looking for "${listing.title}" in your selling list…`)
  const renewButton = await waitFor(() => findRenewButton(listing.title), 20_000)
  if (!renewButton) {
    banner.setStatus(
      'No "Renew" option found for this listing. Facebook only offers renewal on older listings. You can repost it instead.',
      'warning',
    )
    banner.setAction('Repost as a new listing', () => location.assign(PLATFORMS.facebook.postUrl))
    return { status: 'continue' }
  }
  renewButton.click()
  await delay(1500)
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  const confirmButton = dialog ? findClickableByText(dialog, RENEW_PATTERN) : null
  confirmButton?.click()
  return { status: 'done' }
}

const facebookAdapter: PlatformAdapter = {
  platform: 'facebook',
  hint: 'Choose the category and condition (and confirm location), then click Next → Publish. ListSync detects when it is live.',
  fields: [
    { key: 'title', selectors: [], labelPattern: /^title\b/i, getValue: (listing) => listing.title },
    { key: 'price', selectors: [], labelPattern: /^price\b/i, getValue: (listing) => String(listing.price) },
    { key: 'description', selectors: [], labelPattern: /^description\b/i, getValue: (listing) => listing.description },
  ],
  isPostPage: (url) => url.pathname.startsWith('/marketplace/create'),
  detectPosted: (url) => {
    const itemId = /\/marketplace\/item\/(\d+)/.exec(url.pathname)?.[1]
    if (itemId) return { url: `https://www.facebook.com/marketplace/item/${itemId}/` }
    if (url.pathname.startsWith('/marketplace/you/selling')) return {}
    return null
  },
  refresh: renewOnSellingPage,
}

const boot = async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const importJob = await sendMessage<ImportJob | null>({ type: 'GET_IMPORT_JOB' }).catch(() => null)
    if (importJob?.platform === 'facebook') {
      await runFacebookImport(importJob)
      return
    }
    await delay(400)
  }
  await runContentScript(facebookAdapter)
}

void boot()
