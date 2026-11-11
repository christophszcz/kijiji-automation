import type { ItemCondition, PlatformConfig, PlatformId, Settings } from './types'

export const DAY_MS = 86_400_000
export const HOUR_MS = 3_600_000
export const MAX_IMAGES = 10

export const PLATFORM_IDS: PlatformId[] = ['kijiji', 'facebook']

export const PLATFORMS: Record<PlatformId, PlatformConfig> = {
  kijiji: {
    id: 'kijiji',
    label: 'Kijiji',
    shortLabel: 'Kijiji',
    postUrl: 'https://www.kijiji.ca/p-select-category.html',
    refreshUrl: 'https://www.kijiji.ca/m-my-ads/active',
    importUrl: 'https://www.kijiji.ca/m-my-ads/active',
    refreshMode: 'repost',
    badgeClassName: 'bg-violet-100 text-violet-800 ring-violet-200',
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook Marketplace',
    shortLabel: 'Facebook',
    postUrl: 'https://www.facebook.com/marketplace/create/item',
    refreshUrl: 'https://www.facebook.com/marketplace/you/selling',
    importUrl: 'https://www.facebook.com/marketplace/you/selling',
    refreshMode: 'renew',
    badgeClassName: 'bg-blue-100 text-blue-800 ring-blue-200',
  },
}

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  new: 'New',
  like_new: 'Used – Like new',
  good: 'Used – Good',
  fair: 'Used – Fair',
}

export const DEFAULT_SETTINGS: Settings = {
  staleAfterDays: 7,
  remindersEnabled: true,
  checkIntervalHours: 6,
}
