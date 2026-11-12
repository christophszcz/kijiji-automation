import { PLATFORMS } from '../shared/constants'
import { mergeImageLists } from '../shared/images'
import { sendMessage } from '../shared/messages'
import type { JobContext, Listing } from '../shared/types'
import type { Banner } from './banner'
import { delay } from './dom'
import {
  deleteKijijiAd,
  extractKijijiAdId,
  fetchKijijiAdFromAccount,
  fetchKijijiAdFromViewPage,
  hydrateSnapshotImages,
  mergeSnapshotWithListing,
  type KijijiAdSnapshot,
} from './kijiji-api'
import {
  captureKijijiEditPageSnapshot,
  fetchKijijiAdFromEditPage,
  getKijijiEditUrl,
  isKijijiEditPage,
} from './kijiji-edit'
import { parseKijijiTags } from './kijiji-tags'
import type { RefreshOutcome } from './runner'

const deletedKey = (jobId: string) => `listsync:kijiji-deleted:${jobId}`
const pendingDeleteKey = (jobId: string) => `listsync:kijiji-pending-delete:${jobId}`
const capturedKey = (jobId: string) => `listsync:kijiji-captured:${jobId}`

const resolveAdId = (context: JobContext) =>
  context.listing.externalIds?.kijiji ||
  extractKijijiAdId(context.job.previousUrl) ||
  extractKijijiAdId(context.listing.posts.kijiji.url)

const getRepostUrl = (categoryId?: string) =>
  categoryId ? `https://www.kijiji.ca/p-admarkt-post-ad.html?categoryId=${encodeURIComponent(categoryId)}` : PLATFORMS.kijiji.postUrl

const toListingSnapshot = (snapshot: KijijiAdSnapshot) => ({
  title: snapshot.title,
  description: snapshot.description,
  price: snapshot.price,
  location: snapshot.location,
  category: snapshot.category,
  images: snapshot.images,
  externalId: snapshot.externalId,
  url: snapshot.url,
  kijiji: {
    categoryId: snapshot.categoryId,
    attributes: snapshot.attributes,
    address: snapshot.address,
    formFields: snapshot.formFields,
    labeledFields: snapshot.labeledFields,
    tags: snapshot.tags,
  },
})

const captureFromEditSources = async (adId: string, listing: Listing, previousUrl?: string): Promise<KijijiAdSnapshot> => {
  let fromEditDom: KijijiAdSnapshot | null = null
  if (isKijijiEditPage()) {
    fromEditDom = await captureKijijiEditPageSnapshot(adId, location.href)
  }

  const fromEditFetch = fromEditDom ? null : await fetchKijijiAdFromEditPage(adId)
  const fromAccount = await fetchKijijiAdFromAccount(adId)
  const fromPage = await fetchKijijiAdFromViewPage(adId, previousUrl || listing.posts.kijiji.url)

  const primary = fromEditDom || fromEditFetch
  if (!primary?.title) {
    throw new Error('Could not open Kijiji’s edit-ad page to copy the form fields. Are you signed in?')
  }

  const merged = mergeSnapshotWithListing(listing, {
    externalId: adId,
    title: primary.title || fromPage?.title || fromAccount?.title || listing.title,
    description: primary.description || fromPage?.description || fromAccount?.description || listing.description,
    price:
      [primary.price, fromPage?.price, fromAccount?.price, listing.price].find((value) => typeof value === 'number' && value > 0) ??
      primary.price ??
      listing.price,
    location: primary.location || fromPage?.location || fromAccount?.location || listing.location,
    category: primary.category || fromPage?.category || fromAccount?.category || listing.category,
    categoryId: primary.categoryId || fromAccount?.categoryId || fromPage?.categoryId,
    attributes: { ...fromPage?.attributes, ...fromAccount?.attributes, ...primary.attributes },
    address: primary.address || fromAccount?.address || fromPage?.address,
    formFields: { ...fromEditFetch?.formFields, ...primary.formFields },
    labeledFields: { ...fromEditFetch?.labeledFields, ...primary.labeledFields },
    tags: parseKijijiTags(primary.tags, fromEditFetch?.tags, fromAccount?.tags, fromPage?.tags, listing.kijiji?.tags),
    // Prefer Kijiji's own gallery order (account / view page / saved listing),
    // then fill any missing photos from the edit-page scrape without reshuffling.
    images: mergeImageLists(fromAccount?.images, fromPage?.images, listing.images, primary.images),
    url:
      primary.url ||
      fromPage?.url ||
      fromAccount?.url ||
      previousUrl ||
      listing.posts.kijiji.url ||
      `https://www.kijiji.ca/v-view-details.html?adId=${adId}`,
  })

  return primary.images.some((image) => image.startsWith('data:')) ? merged : hydrateSnapshotImages(merged)
}

const beginRepost = async (banner: Banner, categoryId?: string): Promise<RefreshOutcome> => {
  banner.setStatus('Old ad deleted. Opening Kijiji’s post form with your copied fields…', 'success')
  await delay(600)
  location.assign(getRepostUrl(categoryId))
  await delay(30_000)
  return { status: 'continue' }
}

const abortBeforeDelete = async (banner: Banner, error: unknown): Promise<RefreshOutcome> => {
  const message = error instanceof Error ? error.message : String(error)
  banner.setStatus(`${message}. Your ad was not deleted.`, 'warning')
  await sendMessage({ type: 'CANCEL_JOB', error: message })
  return { status: 'aborted' }
}

const saveCapturedSnapshot = async (listing: Listing, snapshot: KijijiAdSnapshot, jobId: string) => {
  await sendMessage({
    type: 'SAVE_SNAPSHOT',
    listingId: listing.id,
    platform: 'kijiji',
    snapshot: toListingSnapshot(snapshot),
  })
  sessionStorage.setItem(capturedKey(jobId), '1')
}

export const refreshKijijiAd = async (context: JobContext, banner: Banner): Promise<RefreshOutcome> => {
  const { job, listing } = context
  const categoryId = listing.kijiji?.categoryId

  if (sessionStorage.getItem(deletedKey(job.id)) === '1') {
    banner.setStatus('Old ad deleted. Reposting the exact edit-page copy…')
    if (!location.pathname.startsWith('/p-') || isKijijiEditPage()) {
      location.assign(getRepostUrl(categoryId))
      await delay(30_000)
    }
    return { status: 'continue' }
  }

  const pendingDeleteAdId = sessionStorage.getItem(pendingDeleteKey(job.id))
  if (pendingDeleteAdId) {
    try {
      banner.setStatus('Deleting the old ad from Kijiji…')
      if (!/m-my-ads|\/my\/ads/i.test(location.pathname)) {
        location.assign(PLATFORMS.kijiji.importUrl)
        await delay(30_000)
        return { status: 'continue' }
      }
      await delay(1200)
      await deleteKijijiAd(pendingDeleteAdId, listing.title)
      sessionStorage.removeItem(pendingDeleteKey(job.id))
      sessionStorage.setItem(deletedKey(job.id), '1')
      return beginRepost(banner, categoryId)
    } catch (error) {
      return abortBeforeDelete(banner, error)
    }
  }

  const adId = resolveAdId(context)
  if (!adId) {
    banner.setStatus('Missing Kijiji ad ID. Sync your ads first, then try Refresh again.', 'warning')
    await sendMessage({ type: 'JOB_RESULT', status: 'failed', error: 'Missing Kijiji ad ID' })
    return { status: 'aborted' }
  }

  try {
    if (sessionStorage.getItem(capturedKey(job.id)) !== '1') {
      if (!isKijijiEditPage()) {
        banner.setStatus('Opening Kijiji’s edit-ad page to copy every field…')
        location.assign(getKijijiEditUrl(adId))
        await delay(30_000)
        return { status: 'continue' }
      }

      banner.setStatus('Copying all fields and text boxes from the edit-ad page…')
      const snapshot = await captureFromEditSources(adId, listing, job.previousUrl)
      const fieldCount = Object.keys(snapshot.formFields ?? {}).length + Object.keys(snapshot.labeledFields ?? {}).length
      if (!snapshot.title || snapshot.description.length < 5) {
        throw new Error('Could not capture enough ad details from the edit page to repost safely')
      }
      if (fieldCount === 0) {
        throw new Error('No form fields were found on Kijiji’s edit-ad page')
      }

      await saveCapturedSnapshot(listing, snapshot, job.id)
      banner.setStatus(`Copied ${fieldCount} fields. Deleting the old ad…`)
      try {
        await deleteKijijiAd(adId, listing.title)
        sessionStorage.setItem(deletedKey(job.id), '1')
        return beginRepost(banner, snapshot.categoryId || categoryId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === 'UI_DELETE_REQUIRED' || /TOKEN_MISSING|security token|delete failed/i.test(message)) {
          sessionStorage.setItem(pendingDeleteKey(job.id), adId)
          banner.setStatus('Opening My Ads so ListSync can delete the listing from the page…')
          location.assign(PLATFORMS.kijiji.importUrl)
          await delay(30_000)
          return { status: 'continue' }
        }
        throw error
      }
    }

    banner.setStatus('Deleting the old ad from Kijiji…')
    try {
      await deleteKijijiAd(adId, listing.title)
      sessionStorage.setItem(deletedKey(job.id), '1')
      return beginRepost(banner, categoryId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'UI_DELETE_REQUIRED' || /TOKEN_MISSING|security token|delete failed/i.test(message)) {
        sessionStorage.setItem(pendingDeleteKey(job.id), adId)
        banner.setStatus('Opening My Ads so ListSync can delete the listing from the page…')
        location.assign(PLATFORMS.kijiji.importUrl)
        await delay(30_000)
        return { status: 'continue' }
      }
      throw error
    }
  } catch (error) {
    return abortBeforeDelete(banner, error)
  }
}
