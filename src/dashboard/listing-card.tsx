import { CONDITION_LABELS, PLATFORM_IDS, PLATFORMS } from '../shared/constants'
import { formatDate, formatPrice } from '../shared/format'
import { getPostedPlatforms, getUnpostedPlatforms } from '../shared/listing'
import { formatAge, getPostAgeMs, isListingStale, isPostStale, isSnoozed } from '../shared/stale'
import type { Listing, PlatformId, Settings } from '../shared/types'
import { Button, PlatformBadge, StatusPill } from '../ui/components'

interface ListingCardProps {
  listing: Listing
  settings: Settings
  now: number
  onEdit: (listing: Listing) => void
  onDelete: (listing: Listing) => void
  onPublish: (listing: Listing, platforms: PlatformId[]) => void
  onRefresh: (listing: Listing, platforms?: PlatformId[]) => void
  onSnooze: (listing: Listing) => void
}

export const ListingCard = ({ listing, settings, now, onEdit, onDelete, onPublish, onRefresh, onSnooze }: ListingCardProps) => {
  const isStale = isListingStale(listing, settings, now)
  const unpostedPlatforms = getUnpostedPlatforms(listing)
  const postedPlatforms = getPostedPlatforms(listing)
  const coverImage = listing.images[0]

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ${isStale ? 'ring-amber-300' : 'ring-slate-200'}`}
      aria-label={listing.title}
    >
      <div className="relative aspect-[4/3] bg-slate-100">
        {coverImage ? (
          <img src={coverImage} alt={listing.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">No photo</div>
        )}
        {isStale && (
          <span className="absolute left-3 top-3 rounded-full bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white shadow">
            Needs refresh
          </span>
        )}
        {isSnoozed(listing, now) && listing.snoozedUntil && (
          <span className="absolute left-3 top-3 rounded-full bg-slate-700/80 px-2.5 py-1 text-xs font-medium text-white">
            Snoozed until {formatDate(listing.snoozedUntil)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-2 font-semibold text-slate-900">{listing.title}</h3>
            <span className="shrink-0 font-semibold text-indigo-700">{formatPrice(listing.price)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {[CONDITION_LABELS[listing.condition], listing.category, listing.location].filter(Boolean).join(' · ')}
          </p>
        </div>

        <ul className="flex flex-col gap-2" aria-label="Marketplace status">
          {PLATFORM_IDS.map((platformId) => {
            const post = listing.posts[platformId]
            const isPostStaleNow = isPostStale(post, settings, now)
            const isActionable = post.status === 'not_posted' || post.status === 'failed' || post.status === 'posted'
            const handlePlatformAction = () =>
              post.status === 'posted' ? onRefresh(listing, [platformId]) : onPublish(listing, [platformId])
            return (
              <li key={platformId} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-sm">
                <PlatformBadge platform={platformId} />
                <StatusPill status={post.status} isStale={isPostStaleNow} />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={post.error}>
                  {post.status === 'posted' && (post.lastRefreshedAt ? `refreshed ${formatAge(getPostAgeMs(post, now))}` : `posted ${formatAge(getPostAgeMs(post, now))}`)}
                  {post.status === 'failed' && post.error}
                </span>
                {post.url && (
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-indigo-700 hover:underline"
                    aria-label={`View on ${PLATFORMS[platformId].label}`}
                  >
                    View
                  </a>
                )}
                {isActionable && (
                  <Button size="sm" variant="ghost" onClick={handlePlatformAction} aria-label={`${post.status === 'posted' ? 'Refresh' : 'Post'} on ${PLATFORMS[platformId].label}`}>
                    {post.status === 'posted' ? 'Refresh' : 'Post'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {postedPlatforms.length > 0 && (
            <Button variant={isStale ? 'warning' : 'primary'} size="sm" onClick={() => onRefresh(listing)}>
              ↻ Refresh
            </Button>
          )}
          {unpostedPlatforms.length > 0 && (
            <Button variant={postedPlatforms.length > 0 ? 'secondary' : 'primary'} size="sm" onClick={() => onPublish(listing, unpostedPlatforms)}>
              Publish{unpostedPlatforms.length < PLATFORM_IDS.length ? ` to ${PLATFORMS[unpostedPlatforms[0]].shortLabel}` : ' everywhere'}
            </Button>
          )}
          {isStale && (
            <Button variant="ghost" size="sm" onClick={() => onSnooze(listing)}>
              Snooze 1d
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => onEdit(listing)} aria-label={`Edit ${listing.title}`}>
            Edit
          </Button>
          <Button variant="danger" size="sm" onClick={() => onDelete(listing)} aria-label={`Delete ${listing.title}`}>
            Delete
          </Button>
        </div>
      </div>
    </article>
  )
}
