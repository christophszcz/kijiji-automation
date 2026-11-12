import { Component, effect, input, output, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { CONDITION_LABELS, MAX_IMAGES, PLATFORM_IDS, PLATFORMS } from '../shared/constants'
import { resizeImage } from '../shared/images'
import { createEmptyPosts, mapPosts } from '../shared/listing'
import type { ItemCondition, Listing, PlatformId } from '../shared/types'
import { ButtonComponent } from '../ui/button.component'
import { ModalComponent } from '../ui/modal.component'

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
    const nextPostedAt = isDateUnchanged && post.postedAt ? post.postedAt : fromDateInput(postDraft.postedDate)
    return {
      ...post,
      status: 'posted',
      url: postDraft.url.trim() || undefined,
      originalPostedAt: post.originalPostedAt ?? nextPostedAt,
      postedAt: nextPostedAt,
      views: post.views,
      searchPage: post.searchPage,
      lastRefreshedAt: post.lastRefreshedAt,
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

@Component({
  selector: 'app-listing-form',
  standalone: true,
  imports: [FormsModule, ButtonComponent, ModalComponent],
  templateUrl: './listing-form.component.html',
})
export class ListingFormComponent {
  readonly listing = input<Listing | null>(null)
  readonly saved = output<ListingFormResult>()
  readonly closed = output<void>()

  readonly draft = signal(createDraft(null))
  readonly errors = signal<DraftErrors>({})
  readonly isSaving = signal(false)
  readonly isProcessingImages = signal(false)

  readonly platformIds = PLATFORM_IDS
  readonly platforms = PLATFORMS
  readonly conditionEntries = Object.entries(CONDITION_LABELS) as [ItemCondition, string][]
  readonly maxImages = MAX_IMAGES
  readonly inputClass = INPUT_CLASS
  readonly today = toDateInput(Date.now())

  constructor() {
    effect(() => {
      this.draft.set(createDraft(this.listing()))
      this.errors.set({})
    })
  }

  updateDraft<K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) {
    this.draft.update((current) => ({ ...current, [key]: value }))
  }

  updatePostDraft(platform: PlatformId, patch: Partial<PostDraft>) {
    this.draft.update((current) => ({
      ...current,
      posts: { ...current.posts, [platform]: { ...current.posts[platform], ...patch } },
      publishTo: patch.isPosted ? current.publishTo.filter((id) => id !== platform) : current.publishTo,
    }))
  }

  handleTogglePublish(platform: PlatformId) {
    const current = this.draft()
    this.updateDraft(
      'publishTo',
      current.publishTo.includes(platform) ? current.publishTo.filter((id) => id !== platform) : [...current.publishTo, platform],
    )
  }

  async handleImagesSelected(event: Event) {
    const input = event.target as HTMLInputElement
    const files = [...(input.files ?? [])].slice(0, MAX_IMAGES - this.draft().images.length)
    input.value = ''
    if (files.length === 0) return
    this.isProcessingImages.set(true)
    try {
      const resized = await Promise.all(files.map(resizeImage))
      this.draft.update((current) => ({ ...current, images: [...current.images, ...resized].slice(0, MAX_IMAGES) }))
      this.errors.update((current) => ({ ...current, images: undefined }))
    } catch {
      this.errors.update((current) => ({ ...current, images: 'One of the images could not be read' }))
    } finally {
      this.isProcessingImages.set(false)
    }
  }

  handleRemoveImage(index: number) {
    this.updateDraft(
      'images',
      this.draft().images.filter((_, i) => i !== index),
    )
  }

  handleMakeCover(index: number) {
    const images = this.draft().images
    this.updateDraft('images', [images[index], ...images.filter((_, i) => i !== index)])
  }

  async submit(shouldPublish: boolean) {
    const nextErrors = validateDraft(this.draft())
    this.errors.set(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    this.isSaving.set(true)
    try {
      this.saved.emit({ listing: draftToListing(this.draft(), this.listing()), publishTo: shouldPublish ? this.draft().publishTo : [] })
    } finally {
      this.isSaving.set(false)
    }
  }

  handleSubmit(event: Event) {
    event.preventDefault()
    void this.submit(this.draft().publishTo.length > 0)
  }
}
