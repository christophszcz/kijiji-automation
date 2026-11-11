import { useEffect, useState, type FormEvent } from 'react'
import { saveSettings } from '../shared/storage'
import type { Settings } from '../shared/types'
import { checkStaleNow, getErrorMessage } from '../ui/actions'
import { Button } from '../ui/components'

interface SettingsPanelProps {
  settings: Settings
  onNotify: (message: string) => void
}

const INPUT_CLASS =
  'w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value) || min))

export const SettingsPanel = ({ settings, onNotify }: SettingsPanelProps) => {
  const [draft, setDraft] = useState(settings)

  useEffect(() => setDraft(settings), [settings])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    await saveSettings({
      staleAfterDays: clamp(draft.staleAfterDays, 1, 60),
      checkIntervalHours: clamp(draft.checkIntervalHours, 1, 24),
      remindersEnabled: draft.remindersEnabled,
    })
    onNotify('Settings saved')
  }

  const handleCheckNow = async () => {
    try {
      const staleCount = await checkStaleNow()
      onNotify(staleCount > 0 ? `${staleCount} stale listing${staleCount === 1 ? '' : 's'} found` : 'Everything is fresh')
    } catch (error) {
      onNotify(getErrorMessage(error))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold text-slate-900">Stale listing reminders</h2>
      <p className="mt-1 text-sm text-slate-500">
        Listings sink in search results as they age. ListSync flags them and reminds you to refresh.
      </p>

      <div className="mt-6 flex flex-col gap-5">
        <label className="flex items-center justify-between gap-4 text-sm text-slate-700">
          <span>
            <span className="block font-medium">Mark listings stale after</span>
            <span className="text-slate-500">Days since posting or the last refresh</span>
          </span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={60}
              className={INPUT_CLASS}
              value={draft.staleAfterDays}
              onChange={(event) => setDraft({ ...draft, staleAfterDays: Number(event.target.value) })}
            />
            days
          </span>
        </label>

        <label className="flex items-center justify-between gap-4 text-sm text-slate-700">
          <span>
            <span className="block font-medium">Check every</span>
            <span className="text-slate-500">How often ListSync looks for stale listings</span>
          </span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={24}
              className={INPUT_CLASS}
              value={draft.checkIntervalHours}
              onChange={(event) => setDraft({ ...draft, checkIntervalHours: Number(event.target.value) })}
            />
            hours
          </span>
        </label>

        <label className="flex items-center justify-between gap-4 text-sm text-slate-700">
          <span>
            <span className="block font-medium">Desktop notifications</span>
            <span className="text-slate-500">At most one reminder per listing per day</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="h-5 w-5 rounded border-slate-300 text-indigo-600"
            checked={draft.remindersEnabled}
            onChange={(event) => setDraft({ ...draft, remindersEnabled: event.target.checked })}
          />
        </label>
      </div>

      <div className="mt-8 flex justify-between gap-2">
        <Button onClick={() => void handleCheckNow()}>Check now</Button>
        <Button type="submit" variant="primary">
          Save settings
        </Button>
      </div>
    </form>
  )
}
