import { PLATFORMS } from '../shared/constants'
import { resolveImagesForUpload } from '../shared/images'
import { sendMessage } from '../shared/messages'
import type { JobContext, Listing, PlatformId } from '../shared/types'
import { createBanner, type Banner, type FieldKey } from './banner'
import { attachImagesSequentially, delay, findImageInput, findTextField, setFieldValue } from './dom'
import { createImportBanner } from './import-banner'

const JOB_LOOKUP_ATTEMPTS = 3
const AUTOFILL_TIMEOUT_MS = 90_000
const URL_POLL_INTERVAL_MS = 1000

export interface FieldSpec {
  key: Exclude<FieldKey, 'photos'>
  selectors: string[]
  labelPattern: RegExp
  getValue: (listing: Listing) => string
}

export interface PostedDetection {
  url?: string
}

export type RefreshOutcome =
  | { status: 'done'; url?: string }
  | { status: 'continue' }
  | { status: 'aborted' }

export interface PlatformAdapter {
  platform: PlatformId
  fields: FieldSpec[]
  hint: string
  refreshHint?: string
  isPostPage: (url: URL) => boolean
  detectPosted: (url: URL) => PostedDetection | null
  refresh?: (context: JobContext, banner: Banner) => Promise<RefreshOutcome>
  autoPost?: (listing: Listing, report: (text: string) => void) => Promise<'submitted' | 'navigating'>
}

const createStatusChip = (title: string): Banner => {
  const chip = createImportBanner(title, 'Starting…')
  return {
    setStatus: (text, tone) => chip.setStatus(text, tone),
    setFieldState: () => undefined,
    setAction: () => undefined,
    showSuccess: (text) => {
      chip.setStatus(text, 'success')
      setTimeout(() => chip.remove(), 4000)
    },
  }
}

const fetchJobContext = async (): Promise<JobContext | null> => {
  for (let attempt = 0; attempt < JOB_LOOKUP_ATTEMPTS; attempt++) {
    const context = await sendMessage<JobContext | null>({ type: 'GET_JOB' }).catch(() => null)
    if (context) return context
    await delay(1000)
  }
  return null
}

const autofill = (adapter: PlatformAdapter, listing: Listing, banner: Banner) => {
  const filledKeys = new Set<FieldKey>()
  let isLoadingPhotos = false
  if (listing.images.length === 0) {
    filledKeys.add('photos')
    banner.setFieldState('photos', 'skipped')
  }
  const totalKeys = adapter.fields.length + 1

  const fillAvailableFields = () => {
    adapter.fields.forEach((spec) => {
      if (filledKeys.has(spec.key)) return
      const field = findTextField(spec.selectors, spec.labelPattern)
      if (!field) return
      setFieldValue(field, spec.getValue(listing))
      filledKeys.add(spec.key)
      banner.setFieldState(spec.key, 'done')
    })
    if (!filledKeys.has('photos') && !isLoadingPhotos) {
      const input = findImageInput()
      if (input) {
        isLoadingPhotos = true
        void resolveImagesForUpload(listing.images)
          .then(async (images) => {
            if (images.length === 0) {
              filledKeys.add('photos')
              banner.setFieldState('photos', 'skipped')
              return
            }
            banner.setStatus(`Uploading photo 1 of ${images.length}…`)
            await attachImagesSequentially(images, {
              findInput: findImageInput,
              onProgress: (index, total) => banner.setStatus(`Uploading photo ${index} of ${total}…`),
            })
            filledKeys.add('photos')
            banner.setFieldState('photos', 'done')
          })
          .catch(() => {
            banner.setFieldState('photos', 'skipped')
            filledKeys.add('photos')
          })
          .finally(() => {
            isLoadingPhotos = false
            fillAvailableFields()
          })
      }
    }
    const isComplete = filledKeys.size === totalKeys
    banner.setStatus(
      isComplete
        ? 'Exact copy restored. Review category/condition if needed, then post.'
        : isLoadingPhotos
          ? 'Preparing photos for upload…'
          : 'Filling the form… some fields appear after you pick a category.',
      isComplete ? 'success' : 'info',
    )
    return isComplete
  }

  if (fillAvailableFields()) return
  let isScheduled = false
  const observer = new MutationObserver(() => {
    if (isScheduled) return
    isScheduled = true
    setTimeout(() => {
      isScheduled = false
      if (fillAvailableFields()) observer.disconnect()
    }, 400)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  setTimeout(() => observer.disconnect(), AUTOFILL_TIMEOUT_MS)
}

export const runContentScript = async (adapter: PlatformAdapter) => {
  const context = await fetchJobContext()
  if (!context) return
  let { job, listing } = context
  const postPageKey = `listsync:post-page:${job.id}`
  let isFinished = false
  let lastHref = ''
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let autofilledPath = ''

  const hint = job.type === 'refresh' && adapter.refreshHint ? adapter.refreshHint : adapter.hint
  const isAutomatic = job.type === 'refresh' && Boolean(adapter.autoPost)

  const finish = async (url?: string) => {
    if (isFinished) return
    isFinished = true
    clearInterval(pollTimer)
    sessionStorage.removeItem(postPageKey)
    await sendMessage({ type: 'JOB_RESULT', status: 'posted', url })
    banner.showSuccess(
      isAutomatic
        ? `Reposted on ${PLATFORMS[job.platform].shortLabel}. This tab will close.`
        : `Saved! Your listing is tracked as live on ${PLATFORMS[job.platform].shortLabel}.`,
    )
  }

  const fail = async (error: string) => {
    if (isFinished) return
    isFinished = true
    clearInterval(pollTimer)
    banner.setStatus(error, 'warning')
    await sendMessage({ type: 'JOB_RESULT', status: 'failed', error })
  }

  const banner = isAutomatic
    ? createStatusChip(`Refreshing “${listing.title}”`)
    : createBanner({ job, listing }, hint, {
        onMarkPosted: (url) => void finish(url ?? adapter.detectPosted(new URL(location.href))?.url),
        onCancel: () => {
          isFinished = true
          clearInterval(pollTimer)
          void sendMessage({ type: 'CANCEL_JOB' })
        },
      })

  const runAutoPost = async () => {
    if (!adapter.autoPost) return
    try {
      const result = await adapter.autoPost(listing, (text) => banner.setStatus(text))
      if (result === 'submitted') banner.setStatus('Waiting for Kijiji to confirm the new ad…')
    } catch (error) {
      await fail(error instanceof Error ? error.message : String(error))
    }
  }

  const refreshListing = async () => {
    const latest = await sendMessage<JobContext | null>({ type: 'GET_JOB' }).catch(() => null)
    if (latest?.listing) listing = latest.listing
  }

  const handleLocationChange = () => {
    if (isFinished || location.href === lastHref) return
    lastHref = location.href
    const url = new URL(location.href)
    const detection = sessionStorage.getItem(postPageKey) ? adapter.detectPosted(url) : null
    if (detection && (!detection.url || detection.url !== job.previousUrl)) {
      void finish(detection.url)
      return
    }
    if (!adapter.isPostPage(url)) return
    sessionStorage.setItem(postPageKey, '1')
    if (autofilledPath && (!isAutomatic || autofilledPath === url.pathname)) return
    autofilledPath = url.pathname
    void refreshListing().then(() => (isAutomatic ? runAutoPost() : autofill(adapter, listing, banner)))
  }

  if (job.type === 'refresh' && adapter.refresh && !sessionStorage.getItem(postPageKey)) {
    const outcome = await adapter.refresh({ job, listing }, banner)
    if (outcome.status === 'done') {
      await finish(outcome.url ?? job.previousUrl)
      return
    }
    if (outcome.status === 'aborted') return
    await refreshListing()
  }

  handleLocationChange()
  pollTimer = setInterval(handleLocationChange, URL_POLL_INTERVAL_MS)
}
