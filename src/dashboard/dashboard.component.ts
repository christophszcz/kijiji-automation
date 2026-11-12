import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { isDraft, isLive } from '../shared/listing'
import { getListingStats, getStaleListings, isListingStale } from '../shared/stale'
import { deleteListing, upsertListing } from '../shared/storage'
import type { Listing, PlatformId } from '../shared/types'
import { ButtonComponent } from '../ui/button.component'
import { ListingActionsService } from '../ui/listing-actions.service'
import { ListingStore, NowStore, SettingsStore } from '../ui/listing.store'
import { ToastComponent } from '../ui/toast.component'
import { ListingCardComponent } from './listing-card.component'
import { ListingFormComponent, type ListingFormResult } from './listing-form.component'
import { SettingsPanelComponent } from './settings-panel.component'

type Filter = 'all' | 'stale' | 'live' | 'drafts'
type View = 'listings' | 'settings'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stale', label: 'Needs refresh' },
  { id: 'live', label: 'Live' },
  { id: 'drafts', label: 'Drafts' },
]

const getFilterFromHash = (): Filter => (location.hash === '#stale' ? 'stale' : 'all')

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    ToastComponent,
    ListingCardComponent,
    ListingFormComponent,
    SettingsPanelComponent,
  ],
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
  readonly editingListing = signal<Listing | null>(null)
  readonly isFormOpen = signal(location.hash === '#new')
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
      if (filter === 'stale') return isListingStale(listing, settings, now)
      if (filter === 'live') return isLive(listing)
      if (filter === 'drafts') return isDraft(listing)
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
      { label: 'Total listings', value: stats.total, className: 'text-slate-900' },
      { label: 'Live', value: stats.live, className: 'text-emerald-600' },
      { label: 'Need refresh', value: stats.stale, className: 'text-amber-600' },
      { label: 'Drafts', value: stats.drafts, className: 'text-slate-500' },
    ]
  })

  private handleHashChange = () => {
    this.filter.set(getFilterFromHash())
    if (location.hash === '#new') this.openCreateForm()
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

  closeForm() {
    this.isFormOpen.set(false)
    this.editingListing.set(null)
    if (location.hash === '#new') history.replaceState(null, '', location.pathname)
  }

  openCreateForm() {
    this.editingListing.set(null)
    this.isFormOpen.set(true)
  }

  private async runAction(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action()
      this.toast.set(successMessage)
    } catch (error) {
      this.toast.set(this.actions.getErrorMessage(error))
    }
  }

  handleEdit(listing: Listing) {
    this.editingListing.set(listing)
    this.isFormOpen.set(true)
  }

  handleDelete(listing: Listing) {
    if (!confirm(`Delete "${listing.title}" from ListSync? This does not remove it from the marketplaces.`)) return
    void this.runAction(() => deleteListing(listing.id), 'Listing deleted')
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

  async handleSave({ listing, publishTo }: ListingFormResult) {
    await upsertListing(listing)
    this.closeForm()
    if (publishTo.length === 0) {
      this.toast.set('Listing saved')
      return
    }
    await this.runAction(() => this.actions.publishListing(listing.id, publishTo), 'Saved. Finish posting in the opened tabs.')
  }
}
