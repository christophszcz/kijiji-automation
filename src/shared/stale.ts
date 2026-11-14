import { DAY_MS, FREE_DAILY_REFRESH_LIMIT, HOUR_MS } from './constants'
import { getPosts } from './listing'
import type { Listing, ListingStats, PlatformId, PlatformPost, Settings } from './types'

export const getPostAgeMs = (post: PlatformPost, now: number) => {
  const reference = post.lastRefreshedAt ?? post.postedAt
  return reference ? Math.max(0, now - reference) : 0
}

export const localDayKey = (now = Date.now()) => {
  const date = new Date(now)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const getRefreshUsageCount = (settings: Settings, now = Date.now()) =>
  settings.refreshUsageDay === localDayKey(now) ? (settings.refreshUsageCount ?? 0) : 0

export const getDailyRefreshLimit = (settings: Settings) =>
  settings.membership === 'k_plus' ? Number.POSITIVE_INFINITY : FREE_DAILY_REFRESH_LIMIT

export const getRemainingRefreshes = (settings: Settings, now = Date.now()) => {
  const limit = getDailyRefreshLimit(settings)
  if (!Number.isFinite(limit)) return Number.POSITIVE_INFINITY
  return Math.max(0, limit - getRefreshUsageCount(settings, now))
}

export const hasRefreshQuota = (settings: Settings, now = Date.now()) => getRemainingRefreshes(settings, now) > 0

export const isPostedOnKijiji = (listing: Listing) => listing.posts.kijiji.status === 'posted'

/** Stale = Kijiji ad that is live but has never been refreshed. */
export const isKijijiNeverRefreshed = (listing: Listing) =>
  isPostedOnKijiji(listing) && listing.posts.kijiji.lastRefreshedAt === undefined

export const isSnoozed = (listing: Listing, now: number) => (listing.snoozedUntil ?? 0) > now

export const isPostStale = (post: PlatformPost, _settings?: Settings, _now?: number) =>
  post.platform === 'kijiji' && post.status === 'posted' && post.lastRefreshedAt === undefined

export const getStalePosts = (listing: Listing, _settings: Settings, now: number) => {
  if (isSnoozed(listing, now)) return []
  return getPosts(listing).filter((post) => isPostStale(post))
}

export const isListingStale = (listing: Listing, _settings?: Settings, now = Date.now()) =>
  !isSnoozed(listing, now) && isKijijiNeverRefreshed(listing)

export const getStaleListings = (listings: Listing[], settings: Settings, now: number) =>
  listings.filter((listing) => isListingStale(listing, settings, now))

/**
 * Available For Refresh = live Kijiji ads the member is still allowed to refresh.
 * Free members see none once today's 3-refresh quota is used; K+ sees all posted ads.
 */
export const isAvailableForRefresh = (listing: Listing, settings: Settings, now = Date.now()) =>
  isPostedOnKijiji(listing) && hasRefreshQuota(settings, now)

export const getRefreshTargets = (listing: Listing, settings?: Settings, now?: number): PlatformId[] => {
  if (!settings) return isPostedOnKijiji(listing) ? ['kijiji'] : []
  return isAvailableForRefresh(listing, settings, now) ? ['kijiji'] : []
}

export const getListingStats = (listings: Listing[], settings: Settings, now: number): ListingStats => ({
  total: listings.length,
  available: listings.filter((listing) => isAvailableForRefresh(listing, settings, now)).length,
  stale: getStaleListings(listings, settings, now).length,
})

export const formatAge = (ms: number) => {
  if (ms < HOUR_MS) return 'just now'
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h ago`
  const days = Math.floor(ms / DAY_MS)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export const formatRefreshQuota = (settings: Settings, now = Date.now()) => {
  if (settings.membership === 'k_plus') return 'K+ · unlimited refreshes'
  const used = getRefreshUsageCount(settings, now)
  const remaining = getRemainingRefreshes(settings, now)
  return `Free · ${remaining} of ${FREE_DAILY_REFRESH_LIMIT} refreshes left today (${used} used)`
}
