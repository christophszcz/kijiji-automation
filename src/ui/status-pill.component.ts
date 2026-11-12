import { Component, input } from '@angular/core'
import type { PostStatus } from '../shared/types'

const STATUS_STYLES: Record<PostStatus, { label: string; className: string }> = {
  not_posted: { label: 'Not posted', className: 'bg-slate-100 text-slate-600' },
  pending: { label: 'In progress…', className: 'bg-indigo-100 text-indigo-700 animate-pulse' },
  posted: { label: 'Live', className: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
}

@Component({
  selector: 'app-status-pill',
  standalone: true,
  template: `
    <span [class]="'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' + style.className">
      {{ style.label }}
    </span>
  `,
})
export class StatusPillComponent {
  readonly status = input.required<PostStatus>()
  readonly isStale = input(false)

  get style() {
    return this.isStale() ? { label: 'Stale', className: 'bg-amber-100 text-amber-800' } : STATUS_STYLES[this.status()]
  }
}
