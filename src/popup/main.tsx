import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { formatPrice } from '../shared/format'
import { getListingStats, getStaleListings } from '../shared/stale'
import type { Listing } from '../shared/types'
import { getErrorMessage, importFromMarketplaces, openDashboard, refreshListing } from '../ui/actions'
import { Button } from '../ui/components'
import { useListings, useNow, useSettings } from '../ui/hooks'

const MAX_STALE_ITEMS = 4

const Popup = () => {
  const { value: listings } = useListings()
  const { value: settings } = useSettings()
  const now = useNow()
  const [error, setError] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const stats = getListingStats(listings, settings, now)
  const staleListings = getStaleListings(listings, settings, now)

  const handleRefresh = async (listing: Listing) => {
    try {
      await refreshListing(listing, settings, now)
    } catch (refreshError) {
      setError(getErrorMessage(refreshError))
    }
  }

  const handleSync = async () => {
    setIsSyncing(true)
    setError(null)
    try {
      await importFromMarketplaces(['kijiji', 'facebook'])
    } catch (syncError) {
      setError(getErrorMessage(syncError))
    } finally {
      setIsSyncing(false)
    }
  }

  const statItems = [
    { label: 'Live', value: stats.live, className: 'text-emerald-600' },
    { label: 'Stale', value: stats.stale, className: 'text-amber-600' },
    { label: 'Drafts', value: stats.drafts, className: 'text-slate-500' },
  ]

  return (
    <div className="flex w-80 flex-col gap-4 bg-white p-4">
      <header className="flex items-center gap-2">
        <img src="icons/icon-32.png" alt="" className="h-7 w-7" />
        <h1 className="text-base font-bold text-slate-900">ListSync</h1>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {statItems.map((item) => (
          <div key={item.label} className="rounded-lg bg-slate-50 p-2 text-center ring-1 ring-slate-200">
            <p className={`text-xl font-bold ${item.className}`}>{item.value}</p>
            <p className="text-[11px] text-slate-500">{item.label}</p>
          </div>
        ))}
      </div>

      {staleListings.length > 0 ? (
        <section aria-label="Stale listings">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Needs refresh</h2>
          <ul className="flex flex-col gap-1.5">
            {staleListings.slice(0, MAX_STALE_ITEMS).map((listing) => (
              <li key={listing.id} className="flex items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{listing.title}</span>
                  <span className="text-xs text-slate-500">{formatPrice(listing.price)}</span>
                </span>
                <Button size="sm" variant="warning" onClick={() => void handleRefresh(listing)} aria-label={`Refresh ${listing.title}`}>
                  ↻
                </Button>
              </li>
            ))}
          </ul>
          {staleListings.length > MAX_STALE_ITEMS && (
            <button type="button" className="mt-1 text-xs text-indigo-700 hover:underline" onClick={() => void openDashboard('#stale')}>
              +{staleListings.length - MAX_STALE_ITEMS} more
            </button>
          )}
        </section>
      ) : (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {stats.total === 0 ? 'No listings yet. Sync ads from your Kijiji account.' : 'All your listings are fresh.'}
        </p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <Button variant="primary" onClick={() => void handleSync()} disabled={isSyncing}>
        {isSyncing ? 'Opening account pages…' : 'Sync my ads'}
      </Button>

      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => void openDashboard()}>Dashboard</Button>
        <Button onClick={() => void openDashboard('#new')}>+ New listing</Button>
      </div>
    </div>
  )
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  )
}
