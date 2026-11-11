import { PLATFORM_IDS } from './constants'
import type { Listing, PlatformId, PlatformPost, PlatformPosts } from './types'

export const createEmptyPosts = (): PlatformPosts => ({
  kijiji: { platform: 'kijiji', status: 'not_posted' },
  facebook: { platform: 'facebook', status: 'not_posted' },
})

export const mapPosts = (posts: PlatformPosts, mapper: (post: PlatformPost) => PlatformPost): PlatformPosts =>
  Object.fromEntries(PLATFORM_IDS.map((id) => [id, mapper(posts[id])])) as PlatformPosts

export const withPost = (listing: Listing, platform: PlatformId, post: PlatformPost): Listing => ({
  ...listing,
  posts: { ...listing.posts, [platform]: post },
  updatedAt: Date.now(),
})

export const getPosts = (listing: Listing): PlatformPost[] => PLATFORM_IDS.map((id) => listing.posts[id])

export const isLive = (listing: Listing) => getPosts(listing).some((post) => post.status === 'posted')

export const isDraft = (listing: Listing) => getPosts(listing).every((post) => post.status === 'not_posted' || post.status === 'failed')

export const getUnpostedPlatforms = (listing: Listing): PlatformId[] =>
  getPosts(listing)
    .filter((post) => post.status === 'not_posted' || post.status === 'failed')
    .map((post) => post.platform)

export const getPostedPlatforms = (listing: Listing): PlatformId[] =>
  getPosts(listing)
    .filter((post) => post.status === 'posted')
    .map((post) => post.platform)
