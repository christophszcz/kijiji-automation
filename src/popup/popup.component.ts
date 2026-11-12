import { Component, computed, inject, signal } from '@angular/core'
import { formatPrice } from '../shared/format'
import { getListingStats, getStaleListings } from '../shared/stale'
import type { Listing } from '../shared/types'
import { ButtonComponent } from '../ui/button.component'
import { ListingActionsService } from '../ui/listing-actions.service'
import { ListingStore, NowStore, SettingsStore } from '../ui/listing.store'

const MAX_STALE_ITEMS = 4

@Component({
  selector: 'app-popup',
  standalone: true,
  imports: [ButtonComponent],
  templateUrl: './popup.component.html',
})
export class PopupComponent {
  private readonly listingStore = inject(ListingStore)
  private readonly settingsStore = inject(SettingsStore)
  private readonly nowStore = inject(NowStore)
  private readonly actions = inject(ListingActionsService)

  readonly error = signal<string | null>(null)
  readonly isSyncing = signal(false)

  readonly listings = this.listingStore.listings
  readonly settings = this.settingsStore.settings
  readonly now = this.nowStore.now

  readonly stats = computed(() => getListingStats(this.listings(), this.settings(), this.now()))
  readonly staleListings = computed(() => getStaleListings(this.listings(), this.settings(), this.now()))
  readonly formatPrice = formatPrice

  readonly statItems = computed(() => {
    const stats = this.stats()
    return [
      { label: 'Live', value: stats.live, className: 'text-emerald-600' },
      { label: 'Stale', value: stats.stale, className: 'text-amber-600' },
      { label: 'Drafts', value: stats.drafts, className: 'text-slate-500' },
    ]
  })

  readonly visibleStale = computed(() => this.staleListings().slice(0, MAX_STALE_ITEMS))
  readonly extraStaleCount = computed(() => Math.max(0, this.staleListings().length - MAX_STALE_ITEMS))

  async handleRefresh(listing: Listing) {
    try {
      await this.actions.refreshListing(listing, this.settings(), this.now())
    } catch (refreshError) {
      this.error.set(this.actions.getErrorMessage(refreshError))
    }
  }

  async handleSync() {
    this.isSyncing.set(true)
    this.error.set(null)
    try {
      await this.actions.importFromMarketplaces(['kijiji', 'facebook'])
    } catch (syncError) {
      this.error.set(this.actions.getErrorMessage(syncError))
    } finally {
      this.isSyncing.set(false)
    }
  }

  handleOpenDashboard(hash = '') {
    void this.actions.openDashboard(hash)
  }
}
