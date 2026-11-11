import { DEFAULT_SETTINGS } from './constants'
import type { Listing, PlatformId, PlatformPost, Settings } from './types'
import { withPost } from './listing'

export const LISTINGS_KEY = 'listings'
export const SETTINGS_KEY = 'settings'

export const getListings = async (): Promise<Listing[]> => {
  const result = await chrome.storage.local.get(LISTINGS_KEY)
  return (result[LISTINGS_KEY] as Listing[] | undefined) ?? []
}

export const saveListings = (listings: Listing[]) => chrome.storage.local.set({ [LISTINGS_KEY]: listings })

export const findListing = async (id: string) => (await getListings()).find((listing) => listing.id === id) ?? null

export const upsertListing = async (listing: Listing) => {
  const listings = await getListings()
  const exists = listings.some((item) => item.id === listing.id)
  const next = exists ? listings.map((item) => (item.id === listing.id ? listing : item)) : [listing, ...listings]
  await saveListings(next)
}

export const updateListing = async (id: string, updater: (listing: Listing) => Listing) => {
  const listings = await getListings()
  await saveListings(listings.map((listing) => (listing.id === id ? updater(listing) : listing)))
}

export const updateListings = async (ids: string[], updater: (listing: Listing) => Listing) => {
  const idSet = new Set(ids)
  const listings = await getListings()
  await saveListings(listings.map((listing) => (idSet.has(listing.id) ? updater(listing) : listing)))
}

export const updatePost = (listingId: string, platform: PlatformId, patch: Partial<PlatformPost>) =>
  updateListing(listingId, (listing) => withPost(listing, platform, { ...listing.posts[platform], ...patch }))

export const deleteListing = async (id: string) => {
  const listings = await getListings()
  await saveListings(listings.filter((listing) => listing.id !== id))
}

export const getSettings = async (): Promise<Settings> => {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] as Partial<Settings> | undefined) }
}

export const saveSettings = (settings: Settings) => chrome.storage.local.set({ [SETTINGS_KEY]: settings })
