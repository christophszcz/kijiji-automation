import { DAY_MS, PLATFORM_IDS } from '../shared/constants'
import { sendMessage } from '../shared/messages'
import { getRefreshTargets } from '../shared/stale'
import { updateListing } from '../shared/storage'
import type { Listing, PlatformId, Settings } from '../shared/types'

export const publishListing = (listingId: string, platforms: PlatformId[]) =>
  sendMessage({ type: 'PUBLISH', listingId, platforms })

export const refreshListing = (listing: Listing, settings: Settings, now: number, platforms?: PlatformId[]) =>
  sendMessage({ type: 'REFRESH', listingId: listing.id, platforms: platforms ?? getRefreshTargets(listing, settings, now) })

export const importFromMarketplaces = (platforms: PlatformId[] = PLATFORM_IDS) =>
  sendMessage({ type: 'IMPORT', platforms })

export const snoozeListing = (listingId: string, days = 1) =>
  updateListing(listingId, (listing) => ({ ...listing, snoozedUntil: Date.now() + days * DAY_MS }))

export const checkStaleNow = () => sendMessage<number>({ type: 'CHECK_STALE' })

export const openDashboard = (hash = '') => chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${hash}`) })

export const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
