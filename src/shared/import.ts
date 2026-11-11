import { MAX_IMAGES } from './constants'
import { createEmptyPosts } from './listing'
import type { ImportedAd, ImportSummary, Listing, PlatformId } from './types'

const normalizeTitle = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ')

const titlesMatch = (a: string, b: string) => normalizeTitle(a) === normalizeTitle(b)

const pricesMatch = (a: number, b?: number) => b === undefined || Math.abs(a - b) < 0.01

const findMatchingListing = (listings: Listing[], ad: ImportedAd) => {
  const byExternalId = listings.findIndex((listing) => listing.externalIds?.[ad.platform] === ad.externalId)
  if (byExternalId >= 0) return byExternalId

  const byUrl = listings.findIndex((listing) => listing.posts[ad.platform].url === ad.url)
  if (byUrl >= 0) return byUrl

  return listings.findIndex((listing) => titlesMatch(listing.title, ad.title) && pricesMatch(listing.price, ad.price))
}

export const createListingFromImport = (ad: ImportedAd): Listing => {
  const now = Date.now()
  const posts = createEmptyPosts()
  posts[ad.platform] = {
    platform: ad.platform,
    status: 'posted',
    url: ad.url,
    postedAt: ad.postedAt ?? now,
  }
  return {
    id: crypto.randomUUID(),
    title: ad.title.trim(),
    description: ad.description?.trim() || '',
    price: ad.price ?? 0,
    condition: 'good',
    category: ad.category?.trim() || '',
    location: ad.location?.trim() || '',
    images: (ad.imageUrls ?? []).slice(0, MAX_IMAGES),
    posts,
    externalIds: { [ad.platform]: ad.externalId },
    createdAt: ad.postedAt ?? now,
    updatedAt: now,
  }
}

export const mergeImportedAds = (
  listings: Listing[],
  ads: ImportedAd[],
  platform: PlatformId,
): { listings: Listing[]; summary: ImportSummary } => {
  let added = 0
  let updated = 0
  const next = [...listings]

  ads.forEach((ad) => {
    const matchIndex = findMatchingListing(next, ad)
    if (matchIndex < 0) {
      next.unshift(createListingFromImport(ad))
      added += 1
      return
    }

    const listing = next[matchIndex]
    const existingPost = listing.posts[ad.platform]
    next[matchIndex] = {
      ...listing,
      title: listing.title || ad.title,
      description: listing.description || ad.description || '',
      price: listing.price > 0 ? listing.price : (ad.price ?? 0),
      location: listing.location || ad.location || '',
      category: listing.category || ad.category || '',
      images: listing.images.length > 0 ? listing.images : (ad.imageUrls ?? []).slice(0, MAX_IMAGES),
      externalIds: { ...listing.externalIds, [ad.platform]: ad.externalId },
      posts: {
        ...listing.posts,
        [ad.platform]: {
          platform: ad.platform,
          status: 'posted',
          url: ad.url,
          postedAt: existingPost.postedAt ?? ad.postedAt ?? Date.now(),
          lastRefreshedAt: existingPost.lastRefreshedAt,
          lastRemindedAt: existingPost.lastRemindedAt,
        },
      },
      updatedAt: Date.now(),
    }
    updated += 1
  })

  return {
    listings: next,
    summary: { platform, added, updated, total: ads.length },
  }
}

export const formatImportSummary = (summary: ImportSummary) => {
  if (summary.needsLogin) return `Sign in to ${summary.platform === 'kijiji' ? 'Kijiji' : 'Facebook'}, then sync again`
  if (summary.error) return summary.error
  if (summary.total === 0) return `No active ads found on ${summary.platform === 'kijiji' ? 'Kijiji' : 'Facebook'}`
  const parts = [
    summary.added > 0 ? `${summary.added} added` : null,
    summary.updated > 0 ? `${summary.updated} updated` : null,
  ].filter(Boolean)
  return `Synced ${summary.total} ${summary.platform === 'kijiji' ? 'Kijiji' : 'Facebook'} ad${summary.total === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}`
}
