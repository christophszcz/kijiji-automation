import { sendMessage } from '../shared/messages'
import type { ImportJob } from '../shared/types'
import { delay } from './dom'
import { autoPostKijiji } from './kijiji-autopost'
import { runKijijiImport } from './kijiji-import'
import { refreshKijijiAd } from './kijiji-refresh'
import { runContentScript, type PlatformAdapter } from './runner'

const AD_ID_PATTERN = /\/(\d{8,})(?:[/?#]|$)/

const kijijiAdapter: PlatformAdapter = {
  platform: 'kijiji',
  hint: 'Pick the category and condition, review the details, then click "Post Your Ad". ListSync detects when the ad is live.',
  refreshHint:
    'ListSync saves your ad, deletes it from Kijiji, then reposts the same title, price, description, and photos. Confirm category/condition, then post.',
  fields: [
    {
      key: 'title',
      selectors: ['#postad-title', 'input[name="postAdForm.title"]', 'input[name="adTitle"]', 'input[name="title"]'],
      labelPattern: /^(ad )?title\b/i,
      getValue: (listing) => listing.title,
    },
    {
      key: 'price',
      selectors: ['#PriceAmount', 'input[name="postAdForm.priceAmount"]', 'input[name="price.amount"]', 'input[name="priceAmount"]'],
      labelPattern: /^(price|amount)\b/i,
      getValue: (listing) => String(listing.price),
    },
    {
      key: 'description',
      selectors: ['#pstad-descrptn', 'textarea[name="postAdForm.description"]', 'textarea[name="description"]'],
      labelPattern: /^description\b/i,
      getValue: (listing) => listing.description,
    },
  ],
  isPostPage: (url) => /^\/p-/.test(url.pathname) && !/edit/i.test(url.pathname),
  detectPosted: (url) => {
    const adIdParam = url.searchParams.get('adId')
    if (adIdParam) return { url: `https://www.kijiji.ca/v-view-details.html?adId=${adIdParam}` }
    if (url.pathname.startsWith('/v-') && AD_ID_PATTERN.test(url.pathname)) return { url: `${url.origin}${url.pathname}` }
    if (/\/m-my-ads/.test(url.pathname)) return {}
    return null
  },
  refresh: refreshKijijiAd,
  autoPost: (listing, report) => autoPostKijiji({ listing, report }),
}

const boot = async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const importJob = await sendMessage<ImportJob | null>({ type: 'GET_IMPORT_JOB' }).catch(() => null)
    if (importJob?.platform === 'kijiji') {
      await runKijijiImport(importJob)
      return
    }
    await delay(400)
  }
  await runContentScript(kijijiAdapter)
}

void boot()
