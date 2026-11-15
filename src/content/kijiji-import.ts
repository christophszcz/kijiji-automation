import { expiresAtFromDaysRemaining } from '../shared/kijiji-dates'
import {
  applyKijijiRanks,
  fetchKijijiAdsFromAccount,
  fetchKijijiRanks,
  mergeImportedKijijiAdsById,
} from '../shared/kijiji-feed'
import { sendMessage } from '../shared/messages'
import type { ImportedAd, ImportJob } from '../shared/types'
import { delay } from './dom'
import { createImportBanner } from './import-banner'

const AD_ID_PATTERN = /(\d{8,})/
const PRICE_PATTERN = /(?:CA\$|C\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/i

const parseCount = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value)
  if (typeof value !== 'string') return undefined
  const match = /(\d[\d,]*)/.exec(value.replace(/\s+/g, ' '))
  if (!match) return undefined
  return Number(match[1].replace(/,/g, ''))
}

const scrapeLabeledStat = (card: Element, labels: string[]) => {
  const labelPattern = new RegExp(`^(?:${labels.join('|')})$`, 'i')
  const nodes = [...card.querySelectorAll('span, div, dd, dt, p, li, strong, em')]
  for (let index = 0; index < nodes.length; index += 1) {
    const text = (nodes[index].textContent || '').replace(/\s+/g, ' ').trim()
    if (!labelPattern.test(text)) continue
    const sibling = nodes[index + 1]
    const siblingText = (sibling?.textContent || '').replace(/\s+/g, ' ').trim()
    const fromSibling = parseCount(siblingText)
    if (fromSibling !== undefined) return fromSibling
    const parentText = (nodes[index].parentElement?.textContent || '').replace(/\s+/g, ' ').trim()
    const inline = scrapeStatFromText(parentText, [new RegExp(`(?:${labels.join('|')})[:\\s]*([\\d,]+)`, 'i')])
    if (inline !== undefined) return inline
  }
  return undefined
}

const scrapeStatFromText = (text: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (!match) continue
    const value = parseCount(match[1] ?? match[2])
    if (value !== undefined) return value
  }
  return undefined
}

const scrapeKijijiMyAdsDom = (): ImportedAd[] => {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="adId="], a[href*="/v-"]')]
  const ads = new Map<string, ImportedAd>()
  links.forEach((link) => {
    const href = link.href
    const id = new URL(href, location.origin).searchParams.get('adId') || AD_ID_PATTERN.exec(href)?.[1]
    if (!id || ads.has(id)) return
    let card = link.closest('li, article, tr, section, [class*="ad"], [data-testid], [class*="listing"]') ?? link.parentElement
    if (!card) return
    let root: Element | null = card
    for (let depth = 0; root && depth < 8; depth += 1) {
      if (/expires\s+in:\s*\d+/i.test(root.textContent || '')) {
        card = root
        break
      }
      root = root.parentElement
    }
    const text = (card.textContent || link.textContent || '').replace(/\s+/g, ' ').trim()
    const title = (link.getAttribute('aria-label') || link.textContent || text.split(PRICE_PATTERN)[0] || '').trim()
    if (!title || title.length < 3) return
    const image = card.querySelector('img')?.src
    const priceMatch = PRICE_PATTERN.exec(text)
    const views =
      scrapeLabeledStat(card, ['visits?', 'views?', 'vue[s]?']) ??
      scrapeStatFromText(text, [/\b(?:views?|visits?|vues?)\b[:\s]*([\d,]+)/i, /([\d,]+)\s*(?:views?|visits?|vues?)\b/i])
    const searchPage =
      scrapeLabeledStat(card, ['page', 'pages?', 'page\\s*#?']) ??
      scrapeStatFromText(text, [/\bpage\b[:\s#]*([\d,]+)/i, /([\d,]+)\s*(?:st|nd|rd|th)?\s*page\b/i])
    const expiresInDays = scrapeStatFromText(text, [/expires\s+in:\s*([\d,]+)\s*days?/i, /expires\s+in\s+([\d,]+)\s*days?/i])
    ads.set(id, {
      platform: 'kijiji',
      externalId: id,
      title: title.slice(0, 120),
      price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : /free/i.test(text) ? 0 : undefined,
      imageUrls: image && /^https?:/i.test(image) ? [image] : [],
      url: href.startsWith('http') ? href : `https://www.kijiji.ca/v-view-details.html?adId=${id}`,
      expiresAt: expiresInDays !== undefined ? expiresAtFromDaysRemaining(expiresInDays) : undefined,
      views,
      searchPage,
    })
  })
  return [...ads.values()]
}

const pageLooksLikeLogin = () =>
  Boolean(document.querySelector('a[href*="login"], button, a')) &&
  /sign\s*in|log\s*in/i.test(document.body.innerText.slice(0, 4000)) &&
  !/my ads|your ads|active ads/i.test(document.body.innerText.slice(0, 4000))

/** Legacy tab-based import kept for manual My Ads visits; Sync my ads uses the background feed instead. */
export const runKijijiImport = async (job: ImportJob) => {
  const banner = createImportBanner('Importing Kijiji ads')
  banner.setStatus('Fetching your active Kijiji ads…')

  try {
    await delay(800)
    if (pageLooksLikeLogin()) {
      await sendMessage({ type: 'IMPORT_RESULT', ads: [], needsLogin: true })
      banner.setStatus('Sign in to Kijiji, then click Sync again in ListSync.', 'warning')
      return
    }

    let ads: ImportedAd[] = []
    try {
      const jsonResult = await fetchKijijiAdsFromAccount()
      if (jsonResult.needsLogin) {
        await sendMessage({ type: 'IMPORT_RESULT', ads: [], needsLogin: true })
        banner.setStatus('Sign in to Kijiji, then click Sync again in ListSync.', 'warning')
        return
      }
      ads = jsonResult.ads
    } catch {
      banner.setStatus('JSON feed unavailable — reading the My Ads page…', 'warning')
    }

    if (ads.length === 0) {
      await delay(1500)
      ads = scrapeKijijiMyAdsDom()
      if (ads.length > 0) {
        const ranks = await fetchKijijiRanks(ads.map((ad) => ad.externalId))
        ads = applyKijijiRanks(ads, ranks)
      }
    } else {
      ads = mergeImportedKijijiAdsById(ads, scrapeKijijiMyAdsDom())
      const ranks = await fetchKijijiRanks(ads.map((ad) => ad.externalId))
      ads = applyKijijiRanks(ads, ranks)
    }

    await sendMessage({ type: 'IMPORT_RESULT', ads })
    const withStats = ads.filter((ad) => ad.views !== undefined || ad.searchPage !== undefined).length
    banner.setStatus(
      ads.length === 0
        ? 'No active Kijiji ads found on this account.'
        : `Imported ${ads.length} Kijiji ad${ads.length === 1 ? '' : 's'} (${withStats} with views/page). You can close this tab.`,
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
