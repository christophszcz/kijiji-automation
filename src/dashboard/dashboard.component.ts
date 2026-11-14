import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { getListingStats, getStaleListings, isAvailableForRefresh, isListingStale } from '../shared/stale'
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

  readonly listings = this.listingStore.listings
  readonly isLoading = this.listingStore.isLoading
  readonly settings = this.settingsStore.settings
  readonly now = this.nowStore.now

  readonly stats = computed(() => getListingStats(this.listings(), this.settings(), this.now()))
  readonly staleListings = computed(() => getStaleListings(this.listings(), this.settings(), this.now()))
  readonly visibleListings = computed(() => {
    const normalizedQuery = this.query().trim().toLowerCase()
    const settings = this.settings()
    const now = this.now()
    const filter = this.filter()
    const matchesFilter = (listing: Listing) => {
      if (filter === 'available') return isAvailableForRefresh(listing)
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

  handleRefreshAllStale() {
    const stale = this.staleListings()
    void this.runAction(async () => {
      for (const listing of stale) await this.actions.refreshListing(listing, this.settings(), this.now())
    }, `Refreshing ${stale.length} listing${stale.length === 1 ? '' : 's'}`)
  }

  handleSync(platforms: PlatformId[] = ['kijiji', 'facebook']) {
    this.isSyncing.set(true)
    void this.runAction(async () => {
      await this.actions.importFromMarketplaces(platforms)
    }, 'Opened your marketplace account pages. Ads will appear here once import finishes.').finally(() => this.isSyncing.set(false))
  }
}
