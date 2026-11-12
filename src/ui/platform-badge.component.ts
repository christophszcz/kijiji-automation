import { Component, input } from '@angular/core'
import { PLATFORMS } from '../shared/constants'
import type { PlatformId } from '../shared/types'

@Component({
  selector: 'app-platform-badge',
  standalone: true,
  template: `
    <span [class]="'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' + platformConfig.badgeClassName">
      {{ platformConfig.shortLabel }}
    </span>
  `,
})
export class PlatformBadgeComponent {
  readonly platform = input.required<PlatformId>()

  get platformConfig() {
    return PLATFORMS[this.platform()]
  }
}
