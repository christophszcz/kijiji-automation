import { Component, computed, input, output } from '@angular/core'
import { CONDITION_LABELS, PLATFORM_IDS, PLATFORMS } from '../shared/constants'
import { formatDate, formatPrice } from '../shared/format'
import { getPostedPlatforms, getUnpostedPlatforms } from '../shared/listing'
import { formatAge, getPostAgeMs, isListingStale, isPostStale, isSnoozed } from '../shared/stale'
import type { Listing, PlatformId, Settings } from '../shared/types'
import { ButtonComponent } from '../ui/button.component'
import { PlatformBadgeComponent } from '../ui/platform-badge.component'
import { StatusPillComponent } from '../ui/status-pill.component'

@Component({
  selector: 'app-listing-card',
  standalone: true,
  imports: [ButtonComponent, PlatformBadgeComponent, StatusPillComponent],
  templateUrl: './listing-card.component.html',
})
export class ListingCardComponent {
  readonly listing = input.required<Listing>()
  readonly settings = input.required<Settings>()
  readonly now = input.required<number>()

  readonly edit = output<Listing>()
  readonly deleted = output<Listing>()
  readonly publish = output<{ listing: Listing; platforms: PlatformId[] }>()
  readonly refresh = output<{ listing: Listing; platforms?: PlatformId[] }>()
  readonly snooze = output<Listing>()

  readonly platformIds = PLATFORM_IDS
  readonly platforms = PLATFORMS
  readonly formatPrice = formatPrice
  readonly formatDate = formatDate
  readonly formatAge = formatAge
  readonly getPostAgeMs = getPostAgeMs

  readonly isStale = computed(() => isListingStale(this.listing(), this.settings(), this.now()))
  readonly unpostedPlatforms = computed(() => getUnpostedPlatforms(this.listing()))
  readonly postedPlatforms = computed(() => getPostedPlatforms(this.listing()))
  readonly coverImage = computed(() => this.listing().images[0])
  readonly isSnoozedNow = computed(() => isSnoozed(this.listing(), this.now()))
  readonly metaLine = computed(() =>
    [CONDITION_LABELS[this.listing().condition], this.listing().category, this.listing().location].filter(Boolean).join(' · '),
  )

  isPostStaleNow(platformId: PlatformId) {
    return isPostStale(this.listing().posts[platformId], this.settings(), this.now())
  }

  handlePlatformAction(platformId: PlatformId) {
    const post = this.listing().posts[platformId]
    if (post.status === 'posted') this.refresh.emit({ listing: this.listing(), platforms: [platformId] })
    else this.publish.emit({ listing: this.listing(), platforms: [platformId] })
  }

  publishLabel() {
    const unposted = this.unpostedPlatforms()
    if (unposted.length < PLATFORM_IDS.length) return `Publish to ${PLATFORMS[unposted[0]].shortLabel}`
    return 'Publish everywhere'
  }
}
