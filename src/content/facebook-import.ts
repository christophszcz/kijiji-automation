import { sendMessage } from '../shared/messages'
import type { ImportedAd, ImportJob } from '../shared/types'
import { delay } from './dom'
import { createImportBanner } from './import-banner'

const ITEM_PATH = /\/marketplace\/item\/(\d+)/
const PRICE_PATTERN = /(?:CA\$|C\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/i

const pageLooksLikeLogin = () => /log\s*in|sign\s*in/i.test(document.title) || Boolean(document.querySelector('form[action*="login"]'))

const scrapeFacebookSellingAds = (): ImportedAd[] => {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/marketplace/item/"]')]
  const ads = new Map<string, ImportedAd>()

  links.forEach((link) => {
    const match = ITEM_PATH.exec(link.href)
    if (!match) return
    const externalId = match[1]
    if (ads.has(externalId)) return

    let card: HTMLElement | null = link
    for (let depth = 0; card && depth < 8; depth += 1) {
      if ((card.innerText || '').includes('$') || card.querySelector('img')) break
      card = card.parentElement
    }

    const text = (card?.innerText || link.getAttribute('aria-label') || link.textContent || '').replace(/\s+/g, ' ').trim()
    const priceMatch = PRICE_PATTERN.exec(text)
    const title = text
      .replace(PRICE_PATTERN, '')
      .replace(/\b(renew|relist|mark as sold|delete|available|pending)\b/gi, '')
      .trim()
    if (!title || title.length < 3) return

    const image = card?.querySelector('img')?.src
    ads.set(externalId, {
      platform: 'facebook',
      externalId,
      title: title.slice(0, 120),
      price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : /free/i.test(text) ? 0 : undefined,
      imageUrls: image && /^https?:/i.test(image) ? [image] : [],
      url: `https://www.facebook.com/marketplace/item/${externalId}/`,
    })
  })

  return [...ads.values()]
}

export const runFacebookImport = async (job: ImportJob) => {
  const banner = createImportBanner('Importing Facebook Marketplace ads')
  banner.setStatus('Reading your selling listings…')

  try {
    await delay(2000)
    if (pageLooksLikeLogin()) {
      await sendMessage({ type: 'IMPORT_RESULT', ads: [], needsLogin: true })
      banner.setStatus('Sign in to Facebook, then click Sync again in ListSync.', 'warning')
      return
    }

    let ads = scrapeFacebookSellingAds()
    if (ads.length === 0) {
      banner.setStatus('Waiting for Marketplace to finish loading…')
      for (let attempt = 0; attempt < 10 && ads.length === 0; attempt += 1) {
        await delay(1000)
        ads = scrapeFacebookSellingAds()
      }
    }

    await sendMessage({ type: 'IMPORT_RESULT', ads })
    banner.setStatus(
      ads.length === 0
        ? 'No Marketplace listings found. Open “Your listings” / Selling and try Sync again.'
        : `Imported ${ads.length} Facebook ad${ads.length === 1 ? '' : 's'} into ListSync. You can close this tab.`,
      ads.length === 0 ? 'warning' : 'success',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await sendMessage({ type: 'IMPORT_RESULT', ads: [], error: message })
    banner.setStatus(message, 'warning')
  } finally {
    void job
  }
}
