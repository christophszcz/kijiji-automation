import { DAY_MS, PLATFORMS } from '../shared/constants'
import { mergeImportedAds } from '../shared/import'
import { mapPosts, withPost } from '../shared/listing'
import type { Message, MessageResponse } from '../shared/messages'
import { getStaleListings, getStalePosts } from '../shared/stale'
import {
  LISTINGS_KEY,
  SETTINGS_KEY,
  findListing,
  getListings,
  getSettings,
  saveListings,
  updateListing,
  updateListings,
  updatePost,
} from '../shared/storage'
import type { ImportSummary, JobContext, JobType, Listing, ListingSnapshot, PlatformId } from '../shared/types'
import { getImportJob, removeImportJob, removeImportJobs, saveImportJob } from './import-jobs'
import { getJob, getJobs, removeJob, removeJobs, saveJob } from './jobs'

const STALE_ALARM = 'stale-check'
const REMINDER_NOTIFICATION_ID = 'stale-reminder'
const REMINDER_COOLDOWN_MS = DAY_MS
const SNOOZE_MS = DAY_MS
const REFRESH_NOTIFICATION_PREFIX = 'refresh-problem:'
const AUTO_CLOSE_DELAY_MS = 2500

type JobResultMessage = Extract<Message, { type: 'JOB_RESULT' }>

const openDashboard = (hash = '') => chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${hash}`) })

const scheduleStaleCheck = async () => {
  const settings = await getSettings()
  await chrome.alarms.clear(STALE_ALARM)
  await chrome.alarms.create(STALE_ALARM, { delayInMinutes: 1, periodInMinutes: settings.checkIntervalHours * 60 })
}

const updateBadge = async () => {
  const [listings, settings] = await Promise.all([getListings(), getSettings()])
  const staleCount = getStaleListings(listings, settings, Date.now()).length
  await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' })
  await chrome.action.setBadgeText({ text: staleCount > 0 ? String(staleCount) : '' })
}

const runStaleCheck = async ({ isForced = false } = {}) => {
  const [listings, settings] = await Promise.all([getListings(), getSettings()])
  const now = Date.now()
  const staleListings = getStaleListings(listings, settings, now)
  await updateBadge()
  if (!settings.remindersEnabled && !isForced) return staleListings.length

  const isReminderDue = (lastRemindedAt?: number) => isForced || !lastRemindedAt || now - lastRemindedAt >= REMINDER_COOLDOWN_MS
  const dueListings = staleListings.filter((listing) =>
    getStalePosts(listing, settings, now).some((post) => isReminderDue(post.lastRemindedAt)),
  )
  if (dueListings.length === 0) return staleListings.length

  const titles = dueListings.slice(0, 3).map((listing) => `• ${listing.title}`)
  const moreCount = dueListings.length - titles.length
  await chrome.notifications.create(REMINDER_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: `${dueListings.length} listing${dueListings.length === 1 ? ' is' : 's are'} getting stale`,
    message: [...titles, moreCount > 0 ? `…and ${moreCount} more` : ''].filter(Boolean).join('\n'),
    buttons: [{ title: 'Review & refresh' }, { title: 'Snooze 1 day' }],
    priority: 1,
  })

  await updateListings(
    dueListings.map((listing) => listing.id),
    (listing) => ({
      ...listing,
      posts: mapPosts(listing.posts, (post) =>
        getStalePosts(listing, settings, now).some((stale) => stale.platform === post.platform)
          ? { ...post, lastRemindedAt: now }
          : post,
      ),
    }),
  )
  return staleListings.length
}

const snoozeStaleListings = async () => {
  const [listings, settings] = await Promise.all([getListings(), getSettings()])
  const now = Date.now()
  const staleIds = getStaleListings(listings, settings, now).map((listing) => listing.id)
  await updateListings(staleIds, (listing) => ({ ...listing, snoozedUntil: now + SNOOZE_MS }))
}

const resetOrphanedPendingPosts = async () => {
  const activeJobs = new Set(Object.values(await getJobs()).map((job) => `${job.listingId}:${job.platform}`))
  const listings = await getListings()
  let hasChanges = false
  const next = listings.map((listing) => ({
    ...listing,
    posts: mapPosts(listing.posts, (post) => {
      if (post.status !== 'pending' || activeJobs.has(`${listing.id}:${post.platform}`)) return post
      hasChanges = true
      return { ...post, status: post.postedAt ? 'posted' : 'not_posted' }
    }),
  }))
  if (hasChanges) await saveListings(next)
}

const resolveKijijiRefreshUrl = (listing: Listing, postUrl?: string) => {
  const adId = listing.externalIds?.kijiji || postUrl?.match(/(\d{8,})/)?.[1]
  if (adId) return `https://www.kijiji.ca/p-edit-ad.html?adId=${encodeURIComponent(adId)}`
  return postUrl || PLATFORMS.kijiji.importUrl
}

const resolveJobUrl = (type: JobType, platform: PlatformId, listing: Listing, postUrl?: string) => {
  if (type === 'publish') return PLATFORMS[platform].postUrl
  if (platform === 'kijiji') return resolveKijijiRefreshUrl(listing, postUrl)
  return PLATFORMS[platform].refreshUrl
}

const saveSnapshot = async (listingId: string, platform: PlatformId, snapshot: ListingSnapshot): Promise<Listing | null> => {
  let saved: Listing | null = null
  await updateListing(listingId, (listing) => {
    saved = {
      ...listing,
      title: snapshot.title?.trim() || listing.title,
      description: snapshot.description?.trim() || listing.description,
      price: snapshot.price && snapshot.price > 0 ? snapshot.price : listing.price > 0 ? listing.price : (snapshot.price ?? listing.price),
      location: snapshot.location?.trim() || listing.location,
      category: snapshot.category?.trim() || listing.category,
      images: snapshot.images && snapshot.images.length > 0 ? snapshot.images : listing.images,
      externalIds: snapshot.externalId ? { ...listing.externalIds, [platform]: snapshot.externalId } : listing.externalIds,
      kijiji: snapshot.kijiji
        ? {
            ...listing.kijiji,
            ...snapshot.kijiji,
            attributes: { ...listing.kijiji?.attributes, ...snapshot.kijiji.attributes },
            formFields: { ...listing.kijiji?.formFields, ...snapshot.kijiji.formFields },
            labeledFields: { ...listing.kijiji?.labeledFields, ...snapshot.kijiji.labeledFields },
          }
        : listing.kijiji,
      posts: {
        ...listing.posts,
        [platform]: {
          ...listing.posts[platform],
          url: snapshot.url || listing.posts[platform].url,
        },
      },
      updatedAt: Date.now(),
    }
    return saved
  })
  return saved
}

const startJobs = async (type: JobType, listingId: string, platforms: PlatformId[]) => {
  const listing = await findListing(listingId)
  if (!listing) throw new Error('Listing not found')
  if (platforms.length === 0) throw new Error('Choose at least one marketplace')

  for (const [index, platform] of platforms.entries()) {
    const post = listing.posts[platform]
    if (type === 'refresh' && platform === 'kijiji' && !post.url && !listing.externalIds?.kijiji) {
      throw new Error('This Kijiji ad has no saved URL yet. Sync your ads first, then refresh.')
    }
    const staleJobs = await removeJobs((job) => job.listingId === listingId && job.platform === platform)
    const previousStatus = staleJobs[0]?.previousStatus ?? (post.status === 'pending' ? 'not_posted' : post.status)
    const isAutomatic = type === 'refresh' && platform === 'kijiji'
    const tab = await chrome.tabs.create({ url: resolveJobUrl(type, platform, listing, post.url), active: !isAutomatic && index === 0 })
    if (tab.id === undefined) continue
    await saveJob({
      id: crypto.randomUUID(),
      type,
      listingId,
      platform,
      tabId: tab.id,
      createdAt: Date.now(),
      previousUrl: post.url,
      previousStatus,
    })
    await updatePost(listingId, platform, { status: 'pending', error: undefined })
  }
  return null
}

const getJobContext = async (tabId?: number): Promise<JobContext | null> => {
  if (tabId === undefined) return null
  const job = await getJob(tabId)
  if (!job) return null
  const listing = await findListing(job.listingId)
  if (listing) return { job, listing }
  await removeJob(tabId)
  return null
}

const completeJob = async (tabId: number | undefined, result: JobResultMessage) => {
  if (tabId === undefined) return null
  const job = await removeJob(tabId)
  if (!job) return null

  const isAutomatic = job.type === 'refresh' && job.platform === 'kijiji'

  if (result.status === 'failed') {
    await updatePost(job.listingId, job.platform, { status: 'failed', error: result.error })
    if (isAutomatic) {
      await chrome.tabs.update(tabId, { active: true }).catch(() => undefined)
      await notifyRefreshProblem(job.listingId, `Repost failed: ${result.error ?? 'unknown error'}. Your ad details are saved — open the tab or click Post in the dashboard.`)
    }
    return null
  }

  const now = Date.now()
  await updateListing(job.listingId, (listing) => {
    const post = listing.posts[job.platform]
    const isRefresh = job.type === 'refresh' && post.postedAt !== undefined
    return {
      ...withPost(listing, job.platform, {
        platform: job.platform,
        status: 'posted',
        url: result.url,
        postedAt: isRefresh ? post.postedAt : now,
        lastRefreshedAt: isRefresh ? now : undefined,
      }),
      snoozedUntil: undefined,
    }
  })
  if (isAutomatic) setTimeout(() => void chrome.tabs.remove(tabId).catch(() => undefined), AUTO_CLOSE_DELAY_MS)
  return null
}

const notifyRefreshProblem = async (listingId: string, message: string) => {
  const listing = await findListing(listingId)
  await chrome.notifications.create(`${REFRESH_NOTIFICATION_PREFIX}${listingId}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: `Kijiji refresh: ${listing?.title ?? 'listing'}`,
    message,
    priority: 2,
  })
}

const cancelJob = async (tabId?: number, error?: string) => {
  if (tabId === undefined) return null
  const job = await removeJob(tabId)
  if (!job) return null
  await updatePost(job.listingId, job.platform, { status: job.previousStatus, error })
  if (error) await notifyRefreshProblem(job.listingId, `${error}. Your ad was not deleted.`)
  return null
}

const startImport = async (platforms: PlatformId[]) => {
  if (platforms.length === 0) throw new Error('Choose at least one marketplace')
  for (const [index, platform] of platforms.entries()) {
    await removeImportJobs((job) => job.platform === platform)
    const tab = await chrome.tabs.create({ url: PLATFORMS[platform].importUrl, active: index === 0 })
    if (tab.id === undefined) continue
    await saveImportJob({ id: crypto.randomUUID(), platform, tabId: tab.id, createdAt: Date.now() })
  }
  return null
}

const completeImport = async (
  tabId: number | undefined,
  result: Extract<Message, { type: 'IMPORT_RESULT' }>,
): Promise<ImportSummary | null> => {
  if (tabId === undefined) return null
  const job = await removeImportJob(tabId)
  if (!job) return null

  if (result.needsLogin) {
    return { platform: job.platform, added: 0, updated: 0, total: 0, needsLogin: true }
  }
  if (result.error) {
    return { platform: job.platform, added: 0, updated: 0, total: 0, error: result.error }
  }

  const listings = await getListings()
  const { listings: merged, summary } = mergeImportedAds(listings, result.ads, job.platform)
  await saveListings(merged)
  await updateBadge()
  return summary
}

const handleMessage = async (message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> => {
  switch (message.type) {
    case 'PUBLISH':
      return startJobs('publish', message.listingId, message.platforms)
    case 'REFRESH':
      return startJobs('refresh', message.listingId, message.platforms)
    case 'IMPORT':
      return startImport(message.platforms)
    case 'GET_JOB':
      return getJobContext(sender.tab?.id)
    case 'GET_IMPORT_JOB':
      return sender.tab?.id === undefined ? null : getImportJob(sender.tab.id)
    case 'SAVE_SNAPSHOT':
      return saveSnapshot(message.listingId, message.platform, message.snapshot)
    case 'JOB_RESULT':
      return completeJob(sender.tab?.id, message)
    case 'IMPORT_RESULT':
      return completeImport(sender.tab?.id, message)
    case 'CANCEL_JOB':
      return cancelJob(sender.tab?.id, message.error)
    case 'CHECK_STALE':
      return runStaleCheck({ isForced: true })
  }
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data: data ?? null } satisfies MessageResponse<unknown>))
    .catch((error: unknown) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies MessageResponse<unknown>),
    )
  return true
})

chrome.runtime.onInstalled.addListener(async () => {
  await scheduleStaleCheck()
  await resetOrphanedPendingPosts()
  await updateBadge()
})

chrome.runtime.onStartup.addListener(async () => {
  await scheduleStaleCheck()
  await resetOrphanedPendingPosts()
  await updateBadge()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === STALE_ALARM) void runStaleCheck()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (SETTINGS_KEY in changes) void scheduleStaleCheck()
  if (LISTINGS_KEY in changes || SETTINGS_KEY in changes) void updateBadge()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void cancelJob(tabId)
  void removeImportJob(tabId)
})

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith(REFRESH_NOTIFICATION_PREFIX)) {
    void openDashboard()
    void chrome.notifications.clear(notificationId)
    return
  }
  if (notificationId !== REMINDER_NOTIFICATION_ID) return
  void openDashboard('#stale')
  void chrome.notifications.clear(notificationId)
})

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId !== REMINDER_NOTIFICATION_ID) return
  if (buttonIndex === 0) void openDashboard('#stale')
  if (buttonIndex === 1) void snoozeStaleListings()
  void chrome.notifications.clear(notificationId)
})
