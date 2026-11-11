import { useState, type ChangeEvent, type FormEvent } from 'react'
import { CONDITION_LABELS, MAX_IMAGES, PLATFORM_IDS, PLATFORMS } from '../shared/constants'
import { resizeImage } from '../shared/images'
import { createEmptyPosts, mapPosts } from '../shared/listing'
import type { ItemCondition, Listing, PlatformId } from '../shared/types'
import { Button, Modal } from '../ui/components'

interface PostDraft {
  isPosted: boolean
  url: string
  postedDate: string
}

interface ListingDraft {
  title: string
  description: string
  price: string
  condition: ItemCondition
  category: string
  location: string
  images: string[]
  posts: Record<PlatformId, PostDraft>
  publishTo: PlatformId[]
}

type DraftErrors = Partial<Record<'title' | 'description' | 'price' | 'images', string>>

export interface ListingFormResult {
  listing: Listing
  publishTo: PlatformId[]
}

interface ListingFormProps {
  listing: Listing | null
  onSave: (result: ListingFormResult) => Promise<void>
  onClose: () => void
}

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'

const toDateInput = (timestamp?: number) => (timestamp ? new Date(timestamp).toISOString().slice(0, 10) : '')

const fromDateInput = (value: string) => (value ? new Date(`${value}T12:00:00`).getTime() : Date.now())

const createDraft = (listing: Listing | null): ListingDraft => {
  const posts = listing?.posts ?? createEmptyPosts()
  return {
    title: listing?.title ?? '',
    description: listing?.description ?? '',
    price: listing ? String(listing.price) : '',
    condition: listing?.condition ?? 'good',
    category: listing?.category ?? '',
    location: listing?.location ?? '',
    images: listing?.images ?? [],
    posts: Object.fromEntries(
      PLATFORM_IDS.map((id) => [
        id,
        { isPosted: posts[id].status === 'posted', url: posts[id].url ?? '', postedDate: toDateInput(posts[id].postedAt) },
      ]),
    ) as Record<PlatformId, PostDraft>,
    publishTo: PLATFORM_IDS.filter((id) => posts[id].status !== 'posted' && posts[id].status !== 'pending'),
  }
}

const validateDraft = (draft: ListingDraft): DraftErrors => {
  const price = Number(draft.price)
  return {
    ...(draft.title.trim().length < 3 && { title: 'Title needs at least 3 characters' }),
    ...(draft.title.length > 100 && { title: 'Keep the title under 100 characters' }),
    ...(draft.description.trim().length < 10 && { description: 'Description needs at least 10 characters' }),
    ...((draft.price === '' || Number.isNaN(price) || price < 0) && { price: 'Enter a valid price (0 for free)' }),
  }
}

const draftToListing = (draft: ListingDraft, existing: Listing | null): Listing => {
  const now = Date.now()
  const basePosts = existing?.posts ?? createEmptyPosts()
  const posts = mapPosts(basePosts, (post) => {
    const postDraft = draft.posts[post.platform]
    if (post.status === 'pending') return post
    if (!postDraft.isPosted) return post.status === 'posted' ? { platform: post.platform, status: 'not_posted' } : post
    const isDateUnchanged = postDraft.postedDate === toDateInput(post.postedAt)
    return {
      ...post,
      status: 'posted',
      url: postDraft.url.trim() || undefined,
      postedAt: isDateUnchanged && post.postedAt ? post.postedAt : fromDateInput(postDraft.postedDate),
      error: undefined,
    }
  })
  return {
    id: existing?.id ?? crypto.randomUUID(),
    title: draft.title.trim(),
    description: draft.description.trim(),
    price: Number(draft.price),
    condition: draft.condition,
    category: draft.category.trim(),
    location: draft.location.trim(),
    images: draft.images,
    posts,
    snoozedUntil: existing?.snoozedUntil,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

export const ListingForm = ({ listing, onSave, onClose }: ListingFormProps) => {
  const [draft, setDraft] = useState<ListingDraft>(() => createDraft(listing))
  const [errors, setErrors] = useState<DraftErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isProcessingImages, setIsProcessingImages] = useState(false)

  const updateDraft = <K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const updatePostDraft = (platform: PlatformId, patch: Partial<PostDraft>) =>
    setDraft((current) => ({
      ...current,
      posts: { ...current.posts, [platform]: { ...current.posts[platform], ...patch } },
      publishTo: patch.isPosted ? current.publishTo.filter((id) => id !== platform) : current.publishTo,
    }))

  const handleTogglePublish = (platform: PlatformId) =>
    updateDraft(
      'publishTo',
      draft.publishTo.includes(platform) ? draft.publishTo.filter((id) => id !== platform) : [...draft.publishTo, platform],
    )

  const handleImagesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].slice(0, MAX_IMAGES - draft.images.length)
    event.target.value = ''
    if (files.length === 0) return
    setIsProcessingImages(true)
    try {
      const resized = await Promise.all(files.map(resizeImage))
      setDraft((current) => ({ ...current, images: [...current.images, ...resized].slice(0, MAX_IMAGES) }))
      setErrors((current) => ({ ...current, images: undefined }))
    } catch {
      setErrors((current) => ({ ...current, images: 'One of the images could not be read' }))
    } finally {
      setIsProcessingImages(false)
    }
  }

  const handleRemoveImage = (index: number) => updateDraft('images', draft.images.filter((_, i) => i !== index))

  const handleMakeCover = (index: number) =>
    updateDraft('images', [draft.images[index], ...draft.images.filter((_, i) => i !== index)])

  const submit = async (shouldPublish: boolean) => {
    const nextErrors = validateDraft(draft)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setIsSaving(true)
    try {
      await onSave({ listing: draftToListing(draft, listing), publishTo: shouldPublish ? draft.publishTo : [] })
    } finally {
      setIsSaving(false)
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit(draft.publishTo.length > 0)
  }

  return (
    <Modal title={listing ? 'Edit listing' : 'New listing'} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5 px-6 py-5">
        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium text-slate-700">
            Title
          </label>
          <input
            id="title"
            className={INPUT_CLASS}
            value={draft.title}
            maxLength={100}
            placeholder="e.g. Trek FX 2 hybrid bike – medium frame"
            onChange={(event) => updateDraft('title', event.target.value)}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? 'title-error' : undefined}
          />
          {errors.title && <p id="title-error" className="mt-1 text-xs text-red-600">{errors.title}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="price" className="mb-1 block text-sm font-medium text-slate-700">
              Price (CAD)
            </label>
            <input
              id="price"
              type="number"
              min={0}
              step="1"
              inputMode="decimal"
              className={INPUT_CLASS}
              value={draft.price}
              onChange={(event) => updateDraft('price', event.target.value)}
              aria-invalid={Boolean(errors.price)}
              aria-describedby={errors.price ? 'price-error' : undefined}
            />
            {errors.price && <p id="price-error" className="mt-1 text-xs text-red-600">{errors.price}</p>}
          </div>
          <div>
            <label htmlFor="condition" className="mb-1 block text-sm font-medium text-slate-700">
              Condition
            </label>
            <select
              id="condition"
              className={INPUT_CLASS}
              value={draft.condition}
              onChange={(event) => updateDraft('condition', event.target.value as ItemCondition)}
            >
              {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="category" className="mb-1 block text-sm font-medium text-slate-700">
              Category
            </label>
            <input
              id="category"
              className={INPUT_CLASS}
              value={draft.category}
              placeholder="e.g. Bikes"
              onChange={(event) => updateDraft('category', event.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="location" className="mb-1 block text-sm font-medium text-slate-700">
            Location
          </label>
          <input
            id="location"
            className={INPUT_CLASS}
            value={draft.location}
            placeholder="e.g. Toronto, ON"
            onChange={(event) => updateDraft('location', event.target.value)}
          />
        </div>

        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            id="description"
            rows={5}
            className={INPUT_CLASS}
            value={draft.description}
            onChange={(event) => updateDraft('description', event.target.value)}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? 'description-error' : undefined}
          />
          {errors.description && <p id="description-error" className="mt-1 text-xs text-red-600">{errors.description}</p>}
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">
            Photos <span className="font-normal text-slate-500">({draft.images.length}/{MAX_IMAGES}, first is the cover)</span>
          </legend>
          <div className="grid grid-cols-5 gap-2">
            {draft.images.map((image, index) => (
              <div key={`${index}-${image.length}`} className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-slate-200">
                <img src={image} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-900/60 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                  {index > 0 && (
                    <button type="button" className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium" onClick={() => handleMakeCover(index)}>
                      Make cover
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-red-600"
                    onClick={() => handleRemoveImage(index)}
                    aria-label={`Remove photo ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {draft.images.length < MAX_IMAGES && (
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600 focus-within:border-indigo-500">
                <span className="text-xl">+</span>
                {isProcessingImages ? 'Processing…' : 'Add photos'}
                <input type="file" accept="image/*" multiple className="sr-only" onChange={handleImagesSelected} disabled={isProcessingImages} />
              </label>
            )}
          </div>
          {errors.images && <p className="mt-1 text-xs text-red-600">{errors.images}</p>}
        </fieldset>

        <fieldset className="rounded-xl bg-slate-50 p-4">
          <legend className="sr-only">Marketplaces</legend>
          <p className="mb-3 text-sm font-medium text-slate-700">Marketplaces</p>
          <div className="flex flex-col gap-3">
            {PLATFORM_IDS.map((platformId) => {
              const postDraft = draft.posts[platformId]
              const isPending = listing?.posts[platformId].status === 'pending'
              return (
                <div key={platformId} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <span className="w-40 text-sm font-medium text-slate-800">{PLATFORMS[platformId].label}</span>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                        checked={draft.publishTo.includes(platformId)}
                        disabled={postDraft.isPosted || isPending}
                        onChange={() => handleTogglePublish(platformId)}
                      />
                      Publish now
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                        checked={postDraft.isPosted}
                        disabled={isPending}
                        onChange={(event) =>
                          updatePostDraft(platformId, {
                            isPosted: event.target.checked,
                            postedDate: postDraft.postedDate || toDateInput(Date.now()),
                          })
                        }
                      />
                      Already posted
                    </label>
                  </div>
                  {postDraft.isPosted && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        type="url"
                        className={INPUT_CLASS}
                        placeholder="Listing URL"
                        aria-label={`${PLATFORMS[platformId].label} listing URL`}
                        value={postDraft.url}
                        onChange={(event) => updatePostDraft(platformId, { url: event.target.value })}
                      />
                      <input
                        type="date"
                        className={INPUT_CLASS}
                        aria-label={`${PLATFORMS[platformId].label} posted date`}
                        value={postDraft.postedDate}
                        max={toDateInput(Date.now())}
                        onChange={(event) => updatePostDraft(platformId, { postedDate: event.target.value })}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit(false)} disabled={isSaving || isProcessingImages}>
            Save
          </Button>
          <Button type="submit" variant="primary" disabled={isSaving || isProcessingImages || draft.publishTo.length === 0}>
            Save & publish{draft.publishTo.length > 0 && ` (${draft.publishTo.length})`}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
