import { Injectable, signal } from '@angular/core'
import { DEFAULT_SETTINGS } from '../shared/constants'
import { LISTINGS_KEY, SETTINGS_KEY, getListings, getSettings } from '../shared/storage'
import type { Listing, Settings } from '../shared/types'

@Injectable({ providedIn: 'root' })
export class ListingStore {
  readonly listings = signal<Listing[]>([])
  readonly isLoading = signal(true)

  constructor() {
    void this.refresh()
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && LISTINGS_KEY in changes) void this.refresh()
    })
  }

  async refresh() {
    const listings = await getListings()
    this.listings.set(listings)
    this.isLoading.set(false)
  }
}

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  readonly settings = signal<Settings>(DEFAULT_SETTINGS)

  constructor() {
    void this.refresh()
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && SETTINGS_KEY in changes) void this.refresh()
    })
  }

  async refresh() {
    this.settings.set(await getSettings())
  }
}

@Injectable({ providedIn: 'root' })
export class NowStore {
  readonly now = signal(Date.now())

  constructor() {
    setInterval(() => this.now.set(Date.now()), 60_000)
  }
}
