import { DAY_MS, HOUR_MS } from './constants'
import { getPosts } from './listing'
import type { Listing, ListingStats, PlatformId, PlatformPost, Settings } from './types'

export const getPostAgeMs = (post: PlatformPost, now: number) => {
  const reference = post.lastRefreshedAt ?? post.postedAt
  return reference ? Math.max(0, now - reference) : 0
}

export const isPostStale = (post: PlatformPost, settings: Settings, now: number) =>
  post.status === 'posted' && getPostAgeMs(post, now) >= settings.staleAfterDays * DAY_MS

export const isSnoozed = (listing: Listing, now: number) => (listing.snoozedUntil ?? 0) > now

export const getStalePosts = (listing: Listing, settings: Settings, now: number) =>
  isSnoozed(listing, now) ? [] : getPosts(listing).filter((post) => isPostStale(post, settings, now))

export const isListingStale = (listing: Listing, settings: Settings, now: number) =>
  getStalePosts(listing, settings, now).length > 0

export const getStaleListings = (listings: Listing[], settings: Settings, now: number) =>
  listings.filter((listing) => isListingStale(listing, settings, now))

/** Kijiji ads that are live and can be refreshed right now. */
export const isAvailableForRefresh = (listing: Listing) => listing.posts.kijiji.status === 'posted'

export const getRefreshTargets = (listing: Listing, _settings?: Settings, _now?: number): PlatformId[] => {
  // Facebook Marketplace support is not live yet — only refresh Kijiji.
  return isAvailableForRefresh(listing) ? ['kijiji'] : []
}

export const getListingStats = (listings: Listing[], settings: Settings, now: number): ListingStats => ({
  total: listings.length,
  available: listings.filter(isAvailableForRefresh).length,
  stale: getStaleListings(listings, settings, now).length,
})

export const formatAge = (ms: number) => {
  if (ms < HOUR_MS) return 'just now'
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h ago`
  const days = Math.floor(ms / DAY_MS)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
