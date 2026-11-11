import type { ImportedAd, ImportJob, ImportSummary, ListingSnapshot, PlatformId } from './types'

export type Message =
  | { type: 'PUBLISH'; listingId: string; platforms: PlatformId[] }
  | { type: 'REFRESH'; listingId: string; platforms: PlatformId[] }
  | { type: 'IMPORT'; platforms: PlatformId[] }
  | { type: 'GET_JOB' }
  | { type: 'GET_IMPORT_JOB' }
  | { type: 'SAVE_SNAPSHOT'; listingId: string; platform: PlatformId; snapshot: ListingSnapshot }
  | { type: 'JOB_RESULT'; status: 'posted' | 'failed'; url?: string; error?: string }
  | { type: 'IMPORT_RESULT'; ads: ImportedAd[]; needsLogin?: boolean; error?: string }
  | { type: 'CANCEL_JOB'; error?: string }
  | { type: 'CHECK_STALE' }

export type MessageResponse<T> = { ok: true; data: T } | { ok: false; error: string }

export class ExtensionMessageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtensionMessageError'
  }
}

export const sendMessage = async <T = null>(message: Message): Promise<T> => {
  const response = (await chrome.runtime.sendMessage(message)) as MessageResponse<T> | undefined
  if (!response) throw new ExtensionMessageError('No response from the background worker')
  if (!response.ok) throw new ExtensionMessageError(response.error)
  return response.data
}

export type { ImportJob, ImportSummary }
