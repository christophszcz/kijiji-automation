import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import {
  formatRefreshQuota,
  getListingStats,
  getStaleListings,
  hasRefreshQuota,
  isAvailableForRefresh,
  isListingStale,
} from '../shared/stale'
import type { Listing, PlatformId } from '../shared/types'
import { ButtonComponent } from '../ui/button.component'
import { ListingActionsService } from '../ui/listing-actions.service'
import { ListingStore, NowStore, SettingsStore } from '../ui/listing.store'
import { ToastComponent } from '../ui/toast.component'
import { ListingCardComponent } from './listing-card.component'
import { SettingsPanelComponent } from './settings-panel.component'

type Filter = 'available' | 'stale' | 'all'
type View = 'listings' | 'settings'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'available', label: 'Available For Refresh' },
  { id: 'stale', label: 'Stale' },
  { id: 'all', label: 'All' },
]

const getFilterFromHash = (): Filter => (location.hash === '#stale' ? 'stale' : 'available')

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, ButtonComponent, ToastComponent, ListingCardComponent, SettingsPanelComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly listingStore = inject(ListingStore)
  private readonly settingsStore = inject(SettingsStore)
  private readonly nowStore = inject(NowStore)
  private readonly actions = inject(ListingActionsService)

  readonly filters = FILTERS
  readonly view = signal<View>('listings')
  readonly filter = signal<Filter>(getFilterFromHash())
  readonly query = signal('')
  readonly toast = signal<string | null>(null)
  readonly isSyncing = signal(false)
  readonly isRefreshingAll = signal(false)

  readonly listings = this.listingStore.listings
  readonly isLoading = this.listingStore.isLoading
  readonly settings = this.settingsStore.settings
  readonly now = this.nowStore.now

  readonly stats = computed(() => getListingStats(this.listings(), this.settings(), this.now()))
  readonly staleListings = computed(() => getStaleListings(this.listings(), this.settings(), this.now()))
  readonly refreshableListings = computed(() => {
    const settings = this.settings()
    const now = this.now()
    return this.listings()
      .filter((listing) => isAvailableForRefresh(listing, settings, now))
      .sort((a, b) => Number(isListingStale(b, settings, now)) - Number(isListingStale(a, settings, now)) || b.updatedAt - a.updatedAt)
  })
  readonly visibleListings = computed(() => {
    const normalizedQuery = this.query().trim().toLowerCase()
    const settings = this.settings()
    const now = this.now()
    const filter = this.filter()
    const matchesFilter = (listing: Listing) => {
      if (filter === 'available') return isAvailableForRefresh(listing, settings, now)
      if (filter === 'stale') return isListingStale(listing, settings, now)
      return true
    }
    const matchesQuery = (listing: Listing) =>
      !normalizedQuery || `${listing.title} ${listing.category} ${listing.location}`.toLowerCase().includes(normalizedQuery)
    return this.listings()
      .filter((listing) => matchesFilter(listing) && matchesQuery(listing))
      .sort((a, b) => Number(isListingStale(b, settings, now)) - Number(isListingStale(a, settings, now)) || b.updatedAt - a.updatedAt)
  })

  readonly statCards = computed(() => {
    const stats = this.stats()
    return [
      { label: 'Available for refresh', value: stats.available, className: 'text-emerald-600' },
      { label: 'Stale', value: stats.stale, className: 'text-amber-600' },
      { label: 'All', value: stats.total, className: 'text-slate-900' },
    ]
  })

  readonly refreshQuotaLabel = computed(() => formatRefreshQuota(this.settings(), this.now()))
  readonly canRefreshMore = computed(() => hasRefreshQuota(this.settings(), this.now()))

  private handleHashChange = () => {
    this.filter.set(getFilterFromHash())
  }

  ngOnInit() {
    window.addEventListener('hashchange', this.handleHashChange)
  }

  ngOnDestroy() {
    window.removeEventListener('hashchange', this.handleHashChange)
  }

  handleDismissToast() {
    this.toast.set(null)
  }

  private async runAction(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action()
      this.toast.set(successMessage)
    } catch (error) {
      this.toast.set(this.actions.getErrorMessage(error))
    }
  }

  handlePublish(listing: Listing, platforms: PlatformId[]) {
    void this.runAction(() => this.actions.publishListing(listing.id, platforms), 'Opened the marketplace tabs. Finish posting there.')
  }

  handleRefresh(listing: Listing, platforms?: PlatformId[]) {
    void this.runAction(
      () => this.actions.refreshListing(listing, this.settings(), this.now(), platforms),
      'Refresh started in a new tab',
    )
  }

  handleSnooze(listing: Listing) {
    void this.runAction(() => this.actions.snoozeListing(listing.id), 'Snoozed for 1 day')
  }

  private async refreshListings(listings: Listing[], emptyMessage: string) {
    if (listings.length === 0) {
      this.toast.set(emptyMessage)
      return
    }
    this.isRefreshingAll.set(true)
    try {
      await this.runAction(async () => {
        let started = 0
        for (const listing of listings) {
          try {
            await this.actions.refreshListing(listing, this.settings(), Date.now())
            started += 1
          } catch (error) {
            if (started === 0) throw error
            throw new Error(
              `Started ${started} refresh${started === 1 ? '' : 'es'}, then stopped: ${this.actions.getErrorMessage(error)}`,
            )
          }
        }
      }, `Refreshing ${listings.length} listing${listings.length === 1 ? '' : 's'}`)
    } finally {
      this.isRefreshingAll.set(false)
    }
  }

  handleRefreshAll() {
    void this.refreshListings(this.refreshableListings(), 'No ads available to refresh right now')
  }

  handleRefreshAllStale() {
    void this.refreshListings(this.staleListings(), 'No never-refreshed ads to refresh')
  }

  handleSync(platforms: PlatformId[] = ['kijiji']) {
    this.isSyncing.set(true)
    void (async () => {
      try {
        const result = await this.actions.importFromMarketplaces(platforms)
        this.toast.set(result?.message || 'Dashboard ads updated')
      } catch (error) {
        this.toast.set(this.actions.getErrorMessage(error))
      } finally {
        this.isSyncing.set(false)
      }
    })()
  }
}
