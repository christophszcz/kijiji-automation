import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS } from '../shared/constants'
import { LISTINGS_KEY, SETTINGS_KEY, getListings, getSettings } from '../shared/storage'
import type { Listing, Settings } from '../shared/types'

const useStorageValue = <T>(storageKey: string, load: () => Promise<T>, initialValue: T) => {
  const [value, setValue] = useState<T>(initialValue)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    const refresh = () =>
      load().then((next) => {
        if (!isMounted) return
        setValue(next)
        setIsLoading(false)
      })
    const handleChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && storageKey in changes) void refresh()
    }
    void refresh()
    chrome.storage.onChanged.addListener(handleChange)
    return () => {
      isMounted = false
      chrome.storage.onChanged.removeListener(handleChange)
    }
  }, [storageKey, load])

  return { value, isLoading }
}

const EMPTY_LISTINGS: Listing[] = []

export const useListings = () => useStorageValue(LISTINGS_KEY, getListings, EMPTY_LISTINGS)

export const useSettings = () => useStorageValue<Settings>(SETTINGS_KEY, getSettings, DEFAULT_SETTINGS)

export const useNow = (intervalMs = 60_000) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
