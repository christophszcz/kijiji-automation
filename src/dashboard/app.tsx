import { useCallback, useEffect, useMemo, useState } from 'react'
import { isDraft, isLive } from '../shared/listing'
import { getListingStats, getStaleListings, isListingStale } from '../shared/stale'
import { deleteListing, upsertListing } from '../shared/storage'
import type { Listing, PlatformId } from '../shared/types'
import { getErrorMessage, importFromMarketplaces, publishListing, refreshListing, snoozeListing } from '../ui/actions'
import { Button, Toast } from '../ui/components'
import { useListings, useNow, useSettings } from '../ui/hooks'
import { ListingCard } from './listing-card'
import { ListingForm, type ListingFormResult } from './listing-form'
import { SettingsPanel } from './settings-panel'

type Filter = 'all' | 'stale' | 'live' | 'drafts'
type View = 'listings' | 'settings'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stale', label: 'Needs refresh' },
  { id: 'live', label: 'Live' },
  { id: 'drafts', label: 'Drafts' },
]

const getFilterFromHash = (): Filter => (location.hash === '#stale' ? 'stale' : 'all')

export const App = () => {
  const { value: listings, isLoading } = useListings()
  const { value: settings } = useSettings()
  const now = useNow()
  const [view, setView] = useState<View>('listings')
  const [filter, setFilter] = useState<Filter>(getFilterFromHash)
  const [query, setQuery] = useState('')
  const [editingListing, setEditingListing] = useState<Listing | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(() => location.hash === '#new')
  const [toast, setToast] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    const handleHashChange = () => {
      setFilter(getFilterFromHash())
      if (location.hash === '#new') openCreateForm()
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const stats = useMemo(() => getListingStats(listings, settings, now), [listings, settings, now])
  const staleListings = useMemo(() => getStaleListings(listings, settings, now), [listings, settings, now])

  const visibleListings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const matchesFilter = (listing: Listing) => {
      if (filter === 'stale') return isListingStale(listing, settings, now)
      if (filter === 'live') return isLive(listing)
      if (filter === 'drafts') return isDraft(listing)
      return true
    }
    const matchesQuery = (listing: Listing) =>
      !normalizedQuery || `${listing.title} ${listing.category} ${listing.location}`.toLowerCase().includes(normalizedQuery)
    return listings
      .filter((listing) => matchesFilter(listing) && matchesQuery(listing))
      .sort((a, b) => Number(isListingStale(b, settings, now)) - Number(isListingStale(a, settings, now)) || b.updatedAt - a.updatedAt)
  }, [listings, settings, now, filter, query])

  const dismissToast = useCallback(() => setToast(null), [])
  const closeForm = useCallback(() => {
    setIsFormOpen(false)
    setEditingListing(null)
    if (location.hash === '#new') history.replaceState(null, '', location.pathname)
  }, [])

  function openCreateForm() {
    setEditingListing(null)
    setIsFormOpen(true)
  }

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    try {
      await action()
      setToast(successMessage)
    } catch (error) {
      setToast(getErrorMessage(error))
    }
  }

  const handleEdit = (listing: Listing) => {
    setEditingListing(listing)
    setIsFormOpen(true)
  }

  const handleDelete = (listing: Listing) => {
    if (!confirm(`Delete "${listing.title}" from ListSync? This does not remove it from the marketplaces.`)) return
    void runAction(() => deleteListing(listing.id), 'Listing deleted')
  }

  const handlePublish = (listing: Listing, platforms: PlatformId[]) =>
    void runAction(() => publishListing(listing.id, platforms), 'Opened the marketplace tabs. Finish posting there.')

  const handleRefresh = (listing: Listing, platforms?: PlatformId[]) =>
    void runAction(() => refreshListing(listing, settings, now, platforms), 'Refresh started in a new tab')

  const handleSnooze = (listing: Listing) => void runAction(() => snoozeListing(listing.id), 'Snoozed for 1 day')

  const handleRefreshAllStale = () =>
    void runAction(async () => {
      for (const listing of staleListings) await refreshListing(listing, settings, now)
    }, `Refreshing ${staleListings.length} listing${staleListings.length === 1 ? '' : 's'}`)

  const handleSync = (platforms: PlatformId[] = ['kijiji', 'facebook']) => {
    setIsSyncing(true)
    void runAction(async () => {
      await importFromMarketplaces(platforms)
    }, 'Opened your marketplace account pages. Ads will appear here once import finishes.').finally(() => setIsSyncing(false))
  }

  const handleSave = async ({ listing, publishTo }: ListingFormResult) => {
    await upsertListing(listing)
    closeForm()
    if (publishTo.length === 0) {
      setToast('Listing saved')
      return
    }
    await runAction(() => publishListing(listing.id, publishTo), 'Saved. Finish posting in the opened tabs.')
  }

  const statCards = [
    { label: 'Total listings', value: stats.total, className: 'text-slate-900' },
    { label: 'Live', value: stats.live, className: 'text-emerald-600' },
    { label: 'Need refresh', value: stats.stale, className: 'text-amber-600' },
    { label: 'Drafts', value: stats.drafts, className: 'text-slate-500' },
  ]

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="icons/icon-48.png" alt="" className="h-9 w-9" />
            <div>
              <h1 className="text-lg font-bold text-slate-900">ListSync</h1>
              <p className="text-xs text-slate-500">Kijiji & Facebook Marketplace manager</p>
            </div>
          </div>
          <nav className="flex items-center gap-1" aria-label="Main">
            {(['listings', 'settings'] as View[]).map((id) => (
              <Button key={id} variant={view === id ? 'secondary' : 'ghost'} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}>
                {id === 'listings' ? 'Listings' : 'Settings'}
              </Button>
            ))}
            <Button className="ml-2" onClick={() => handleSync()} disabled={isSyncing}>
              {isSyncing ? 'Syncing…' : 'Sync my ads'}
            </Button>
            <Button variant="primary" onClick={openCreateForm}>
              + New listing
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {view === 'settings' ? (
          <SettingsPanel settings={settings} onNotify={setToast} />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-label="Summary">
              {statCards.map((card) => (
                <div key={card.label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
                  <p className={`mt-1 text-3xl font-bold ${card.className}`}>{card.value}</p>
                </div>
              ))}
            </section>

            {staleListings.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-50 px-5 py-3 ring-1 ring-amber-200">
                <p className="text-sm text-amber-900">
                  <strong>{staleListings.length}</strong> listing{staleListings.length === 1 ? ' has' : 's have'} been up for{' '}
                  {settings.staleAfterDays}+ days and may be buried in search results.
                </p>
                <Button variant="warning" size="sm" onClick={handleRefreshAllStale}>
                  ↻ Refresh all stale
                </Button>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200" role="tablist" aria-label="Filter listings">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === item.id}
                    onClick={() => setFilter(item.id)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${filter === item.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <input
                type="search"
                placeholder="Search listings…"
                aria-label="Search listings"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {!isLoading && visibleListings.length === 0 && (
              <div className="mt-10 rounded-2xl border-2 border-dashed border-slate-300 px-6 py-16 text-center">
                <p className="text-base font-medium text-slate-700">
                  {listings.length === 0 ? 'No listings yet' : 'No listings match this view'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {listings.length === 0
                    ? 'Pull in the ads already on your Kijiji and Facebook accounts, or create a new one.'
                    : 'Try another filter or search.'}
                </p>
                {listings.length === 0 && (
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                    <Button variant="primary" onClick={() => handleSync(['kijiji'])} disabled={isSyncing}>
                      Sync from Kijiji
                    </Button>
                    <Button onClick={() => handleSync(['facebook'])} disabled={isSyncing}>
                      Sync from Facebook
                    </Button>
                    <Button variant="ghost" onClick={openCreateForm}>
                      + Create listing
                    </Button>
                  </div>
                )}
              </div>
            )}

            <section className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Listings">
              {visibleListings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  settings={settings}
                  now={now}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onPublish={handlePublish}
                  onRefresh={handleRefresh}
                  onSnooze={handleSnooze}
                />
              ))}
            </section>
          </>
        )}
      </main>

      {isFormOpen && <ListingForm key={editingListing?.id ?? 'new'} listing={editingListing} onSave={handleSave} onClose={closeForm} />}
      {toast && <Toast message={toast} onDismiss={dismissToast} />}
    </div>
  )
}
