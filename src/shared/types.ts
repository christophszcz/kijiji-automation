export type PlatformId = 'kijiji' | 'facebook'

export type PostStatus = 'not_posted' | 'pending' | 'posted' | 'failed'

export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair'

export type RefreshMode = 'repost' | 'renew'

export interface PlatformConfig {
  id: PlatformId
  label: string
  shortLabel: string
  postUrl: string
  refreshUrl: string
  importUrl: string
  refreshMode: RefreshMode
  badgeClassName: string
}

export interface PlatformPost {
  platform: PlatformId
  status: PostStatus
  url?: string
  /** First known post time on the marketplace (preserved across refreshes). */
  originalPostedAt?: number
  postedAt?: number
  /** Most recent successful refresh/repost time. */
  lastRefreshedAt?: number
  lastRemindedAt?: number
  /** Marketplace view/visit count when last synced. */
  views?: number
  /** Search-results page the ad currently appears on (Kijiji “Page”). */
  searchPage?: number
  error?: string
}

export type PlatformPosts = Record<PlatformId, PlatformPost>

export interface Listing {
  id: string
  title: string
  description: string
  price: number
  condition: ItemCondition
  category: string
  location: string
  images: string[]
  posts: PlatformPosts
  externalIds?: Partial<Record<PlatformId, string>>
  kijiji?: KijijiDetails
  snoozedUntil?: number
  createdAt: number
  updatedAt: number
}

export interface ImportedAd {
  platform: PlatformId
  externalId: string
  title: string
  description?: string
  price?: number
  location?: string
  category?: string
  imageUrls?: string[]
  url: string
  postedAt?: number
  views?: number
  searchPage?: number
}

export interface ImportSummary {
  platform: PlatformId
  added: number
  updated: number
  total: number
  needsLogin?: boolean
  error?: string
}

export interface ImportJob {
  id: string
  platform: PlatformId
  tabId: number
  createdAt: number
}

export interface KijijiDetails {
  categoryId?: string
  attributes?: Record<string, string>
  address?: string
  tags?: string[]
  formFields?: Record<string, string>
  labeledFields?: Record<string, string>
}

export interface ListingSnapshot {
  title?: string
  description?: string
  price?: number
  location?: string
  category?: string
  images?: string[]
  externalId?: string
  url?: string
  kijiji?: KijijiDetails
}

export interface Settings {
  staleAfterDays: number
  remindersEnabled: boolean
  checkIntervalHours: number
}

export type JobType = 'publish' | 'refresh'

export interface Job {
  id: string
  type: JobType
  listingId: string
  platform: PlatformId
  tabId: number
  createdAt: number
  previousUrl?: string
  previousStatus: Exclude<PostStatus, 'pending'>
}

export interface JobContext {
  job: Job
  listing: Listing
}

export interface ListingStats {
  total: number
  live: number
  stale: number
  drafts: number
}
