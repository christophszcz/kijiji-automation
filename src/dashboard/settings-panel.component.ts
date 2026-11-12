import { Component, effect, inject, input, output, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { saveSettings } from '../shared/storage'
import type { Settings } from '../shared/types'
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
  readonly draft = signal<Settings>({ staleAfterDays: 7, checkIntervalHours: 6, remindersEnabled: true })
  readonly inputClass = INPUT_CLASS

  constructor() {
    effect(() => this.draft.set({ ...this.settings() }))
  }

  async handleSubmit(event: Event) {
    event.preventDefault()
    const current = this.draft()
    await saveSettings({
      staleAfterDays: clamp(current.staleAfterDays, 1, 60),
      checkIntervalHours: clamp(current.checkIntervalHours, 1, 24),
      remindersEnabled: current.remindersEnabled,
    })
    this.notify.emit('Settings saved')
  }

  async handleCheckNow() {
    try {
      const staleCount = await this.actions.checkStaleNow()
      this.notify.emit(staleCount > 0 ? `${staleCount} stale listing${staleCount === 1 ? '' : 's'} found` : 'Everything is fresh')
    } catch (error) {
      this.notify.emit(this.actions.getErrorMessage(error))
    }
  }

  updateDraft(patch: Partial<Settings>) {
    this.draft.update((current) => ({ ...current, ...patch }))
  }
}
