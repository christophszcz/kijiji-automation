import type { Job } from '../shared/types'

const JOBS_KEY = 'jobs'

type JobMap = Record<string, Job>

export const getJobs = async (): Promise<JobMap> => {
  const result = await chrome.storage.session.get(JOBS_KEY)
  return (result[JOBS_KEY] as JobMap | undefined) ?? {}
}

const saveJobs = (jobs: JobMap) => chrome.storage.session.set({ [JOBS_KEY]: jobs })

export const getJob = async (tabId: number) => (await getJobs())[String(tabId)] ?? null

export const saveJob = async (job: Job) => {
  const jobs = await getJobs()
  await saveJobs({ ...jobs, [String(job.tabId)]: job })
}

export const removeJobs = async (predicate: (job: Job) => boolean) => {
  const jobs = await getJobs()
  const removed = Object.values(jobs).filter(predicate)
  await saveJobs(Object.fromEntries(Object.entries(jobs).filter(([, job]) => !predicate(job))))
  return removed
}

export const removeJob = async (tabId: number) => (await removeJobs((job) => job.tabId === tabId))[0] ?? null
