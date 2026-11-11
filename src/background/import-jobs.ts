import type { ImportJob } from '../shared/types'

const IMPORT_JOBS_KEY = 'importJobs'

type ImportJobMap = Record<string, ImportJob>

export const getImportJobs = async (): Promise<ImportJobMap> => {
  const result = await chrome.storage.session.get(IMPORT_JOBS_KEY)
  return (result[IMPORT_JOBS_KEY] as ImportJobMap | undefined) ?? {}
}

const saveImportJobs = (jobs: ImportJobMap) => chrome.storage.session.set({ [IMPORT_JOBS_KEY]: jobs })

export const getImportJob = async (tabId: number) => (await getImportJobs())[String(tabId)] ?? null

export const saveImportJob = async (job: ImportJob) => {
  const jobs = await getImportJobs()
  await saveImportJobs({ ...jobs, [String(job.tabId)]: job })
}

export const removeImportJobs = async (predicate: (job: ImportJob) => boolean) => {
  const jobs = await getImportJobs()
  const removed = Object.values(jobs).filter(predicate)
  await saveImportJobs(Object.fromEntries(Object.entries(jobs).filter(([, job]) => !predicate(job))))
  return removed
}

export const removeImportJob = async (tabId: number) => (await removeImportJobs((job) => job.tabId === tabId))[0] ?? null
