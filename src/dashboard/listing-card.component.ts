import { Component, computed, input, output } from '@angular/core'
import { CONDITION_LABELS, PLATFORMS } from '../shared/constants'
import { formatDate, formatDateTime, formatListingDate, formatPrice, startOfLocalDay } from '../shared/format'
import { originalPostedAtFromExpires } from '../shared/kijiji-dates'
import {
  formatAge,
  getPostAgeMs,
  hasRefreshQuota,
  isAvailableForRefresh,
  isKijijiNeverRefreshed,
  isKijijiPastPageOne,
  isListingStale,
  isPostStale,
  isSnoozed,
} from '../shared/stale'
import type { Listing, PlatformId, Settings } from '../shared/types'
import { ButtonComponent } from '../ui/button.component'
import { PlatformBadgeComponent } from '../ui/platform-badge.component'
import { StatusPillComponent } from '../ui/status-pill.component'

@Component({
  selector: 'app-listing-card',
  standalone: true,
  imports: [ButtonComponent, PlatformBadgeComponent, StatusPillComponent],
  templateUrl: './listing-card.component.html',
  host: {
    class: 'block h-full',
  },
})
export class ListingCardComponent {
  readonly listing = input.required<Listing>()
  readonly settings = input.required<Settings>()
  readonly now = input.required<number>()

  readonly publish = output<{ listing: Listing; platforms: PlatformId[] }>()
  readonly refresh = output<{ listing: Listing; platforms?: PlatformId[] }>()
  readonly snooze = output<Listing>()

  readonly platforms = PLATFORMS
  readonly formatPrice = formatPrice
  readonly formatDate = formatDate
  readonly formatDateTime = formatDateTime
  readonly formatListingDate = formatListingDate
  readonly formatAge = formatAge
  readonly getPostAgeMs = getPostAgeMs

  readonly isStale = computed(() => isListingStale(this.listing(), this.settings(), this.now()))
  readonly isNeverRefreshed = computed(() => isKijijiNeverRefreshed(this.listing()))
  readonly isPastPageOne = computed(() => isKijijiPastPageOne(this.listing()))
  readonly canRefresh = computed(() => isAvailableForRefresh(this.listing(), this.settings(), this.now()))
  readonly hasQuota = computed(() => hasRefreshQuota(this.settings(), this.now()))
  readonly coverImage = computed(() => this.listing().images[0])
  readonly isSnoozedNow = computed(() => isSnoozed(this.listing(), this.now()))
  readonly metaLine = computed(() =>
    [CONDITION_LABELS[this.listing().condition], this.listing().category, this.listing().location].filter(Boolean).join(' · '),
  )
  readonly kijijiPost = computed(() => this.listing().posts.kijiji)
  readonly kijijiStats = computed(() => {
    const post = this.kijijiPost()
    if (post.status !== 'posted' && post.status !== 'pending' && post.status !== 'failed') return null
    // Originally posted is the Expires calendar day minus Kijiji’s standard ad lifetime (date only).
    const originalPostedAt =
      post.expiresAt !== undefined
        ? originalPostedAtFromExpires(post.expiresAt)
        : post.originalPostedAt !== undefined
          ? startOfLocalDay(post.originalPostedAt)
          : post.postedAt !== undefined
            ? startOfLocalDay(post.postedAt)
            : undefined
    return {
      originalPostedAt,
      repostedAt: post.lastRefreshedAt,
      views: post.views,
      searchPage: post.searchPage,
      isPastPageOne: (post.searchPage ?? 1) > 1,
    }
  })
  readonly staleBadgeLabel = computed(() => {
    if (this.isPastPageOne() && this.isNeverRefreshed()) return 'Page > 1 · Never refreshed'
    if (this.isPastPageOne()) return 'Kijiji page > 1'
    if (this.isNeverRefreshed()) return 'Never refreshed'
    return 'Stale'
  })
  readonly pageAlertTooltip = computed(() => {
    const page = this.listing().posts.kijiji.searchPage
    if (!this.isPastPageOne() || page === undefined) return null
    return `This ad is on Kijiji page ${page}. Refresh to move it back toward page 1.`
  })

  isPostStaleNow(platformId: PlatformId) {
    return isPostStale(this.listing().posts[platformId], this.settings(), this.now())
  }

  handlePlatformAction(platformId: PlatformId) {
    if (platformId !== 'kijiji') return
    const post = this.listing().posts[platformId]
    if (post.status === 'posted') {
      if (!this.canRefresh()) return
      this.refresh.emit({ listing: this.listing(), platforms: [platformId] })
      return
    }
    this.publish.emit({ listing: this.listing(), platforms: [platformId] })
  }
}
