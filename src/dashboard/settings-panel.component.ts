import { Component, effect, inject, input, output, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { DEFAULT_SETTINGS } from '../shared/constants'
import { saveSettings } from '../shared/storage'
import type { KijijiMembership, Settings } from '../shared/types'
import { ButtonComponent } from '../ui/button.component'
import { ListingActionsService } from '../ui/listing-actions.service'

const INPUT_CLASS =
  'w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value) || min))

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [FormsModule, ButtonComponent],
  templateUrl: './settings-panel.component.html',
})
export class SettingsPanelComponent {
  readonly settings = input.required<Settings>()
  readonly notify = output<string>()

  private readonly actions = inject(ListingActionsService)
  readonly draft = signal<Settings>({ ...DEFAULT_SETTINGS })
  readonly inputClass = INPUT_CLASS

  constructor() {
    effect(() => this.draft.set({ ...this.settings() }))
  }

  async handleSubmit(event: Event) {
    event.preventDefault()
    const current = this.draft()
    const membership: KijijiMembership = current.membership === 'k_plus' ? 'k_plus' : 'free'
    await saveSettings({
      ...current,
      membership,
      checkIntervalHours: clamp(current.checkIntervalHours, 1, 24),
      remindersEnabled: current.remindersEnabled,
    })
    this.notify.emit(membership === 'k_plus' ? 'Settings saved · K+ unlimited refreshes' : 'Settings saved · Free (3 refreshes/day)')
  }

  async handleCheckNow() {
    try {
      const staleCount = await this.actions.checkStaleNow()
      this.notify.emit(
        staleCount > 0
          ? `${staleCount} stale listing${staleCount === 1 ? '' : 's'} found`
          : 'No stale listings',
      )
    } catch (error) {
      this.notify.emit(this.actions.getErrorMessage(error))
    }
  }

  updateDraft(patch: Partial<Settings>) {
    this.draft.update((current) => ({ ...current, ...patch }))
  }
}
