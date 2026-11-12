import { Injectable } from '@angular/core'
import { DAY_MS, PLATFORM_IDS } from '../shared/constants'
import { sendMessage } from '../shared/messages'
import { getRefreshTargets } from '../shared/stale'
import { updateListing } from '../shared/storage'
import type { Listing, PlatformId, Settings } from '../shared/types'

@Injectable({ providedIn: 'root' })
export class ListingActionsService {
  publishListing = (listingId: string, platforms: PlatformId[]) =>
    sendMessage({ type: 'PUBLISH', listingId, platforms })

  refreshListing = (listing: Listing, settings: Settings, now: number, platforms?: PlatformId[]) =>
    sendMessage({ type: 'REFRESH', listingId: listing.id, platforms: platforms ?? getRefreshTargets(listing, settings, now) })

  importFromMarketplaces = (platforms: PlatformId[] = PLATFORM_IDS) =>
    sendMessage({ type: 'IMPORT', platforms })

  snoozeListing = (listingId: string, days = 1) =>
    updateListing(listingId, (listing) => ({ ...listing, snoozedUntil: Date.now() + days * DAY_MS }))

  checkStaleNow = () => sendMessage<number>({ type: 'CHECK_STALE' })

  openDashboard = (hash = '') => chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${hash}`) })

  getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
}
