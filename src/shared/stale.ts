import { DAY_MS, HOUR_MS } from './constants'
import { getPostedPlatforms, getPosts, isDraft, isLive } from './listing'
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

export const getRefreshTargets = (listing: Listing, settings: Settings, now: number): PlatformId[] => {
  const stalePlatforms = getPosts(listing)
    .filter((post) => isPostStale(post, settings, now))
    .map((post) => post.platform)
  return stalePlatforms.length > 0 ? stalePlatforms : getPostedPlatforms(listing)
}

export const getListingStats = (listings: Listing[], settings: Settings, now: number): ListingStats => ({
  total: listings.length,
  live: listings.filter(isLive).length,
  stale: getStaleListings(listings, settings, now).length,
  drafts: listings.filter(isDraft).length,
})

export const formatAge = (ms: number) => {
  if (ms < HOUR_MS) return 'just now'
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h ago`
  const days = Math.floor(ms / DAY_MS)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
