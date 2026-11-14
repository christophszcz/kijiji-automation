import { DAY_MS, KIJIJI_AD_DURATION_DAYS } from './constants'
import { startOfLocalDay } from './format'

/** Absolute Kijiji expiry day from “Expires in: N days”. */
export const expiresAtFromDaysRemaining = (daysRemaining: number, now = Date.now()) =>
  startOfLocalDay(now + Math.max(0, Math.round(daysRemaining)) * DAY_MS)

/**
 * Kijiji’s Posted day is the Expires calendar day minus the standard ad lifetime.
 * Example: Expires in 60 days → originally posted today.
 */
export const originalPostedAtFromExpires = (expiresAt: number) =>
  startOfLocalDay(expiresAt - KIJIJI_AD_DURATION_DAYS * DAY_MS)

export const resolveOriginalPostedAt = (options: {
  expiresAt?: number
  existing?: number
  postedAt?: number
  now?: number
}) => {
  if (options.expiresAt !== undefined) return originalPostedAtFromExpires(options.expiresAt)
  if (options.existing !== undefined) return startOfLocalDay(options.existing)
  if (options.postedAt !== undefined) return startOfLocalDay(options.postedAt)
  return startOfLocalDay(options.now ?? Date.now())
}
