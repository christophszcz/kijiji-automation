import { PLATFORMS } from '../shared/constants'
import { formatPrice } from '../shared/format'
import type { JobContext } from '../shared/types'

export type FieldKey = 'title' | 'price' | 'description' | 'photos'
export type FieldState = 'waiting' | 'done' | 'skipped'
export type StatusTone = 'info' | 'success' | 'warning'

export interface BannerCallbacks {
  onMarkPosted: (url?: string) => void
  onCancel: () => void
}

export interface Banner {
  setStatus: (text: string, tone?: StatusTone) => void
  setFieldState: (key: FieldKey, state: FieldState) => void
  setAction: (label: string, onClick: () => void) => void
  showSuccess: (text: string) => void
}

type Child = Node | string | null | undefined | false | ''

interface ElementProps {
  className?: string
  textContent?: string
  ariaLabel?: string
  type?: string
  href?: string
  target?: string
  rel?: string
  placeholder?: string
  onclick?: () => void
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: ElementProps = {}, ...children: Child[]) => {
  const element = Object.assign(document.createElement(tag), props)
  element.append(...children.filter((child): child is Node | string => Boolean(child)))
  return element
}

const TONE_CLASSES: Record<StatusTone, string> = {
  info: 'bg-indigo-50 text-indigo-800',
  success: 'bg-emerald-50 text-emerald-800',
  warning: 'bg-amber-50 text-amber-800',
}

const FIELD_STATE_ICONS: Record<FieldState, string> = { waiting: '…', done: '✓', skipped: '–' }

const FIELD_LABELS: Record<FieldKey, string> = {
  title: 'Title',
  price: 'Price',
  description: 'Description',
  photos: 'Photos',
}

const BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'

export const createBanner = ({ job, listing }: JobContext, hint: string, callbacks: BannerCallbacks): Banner => {
  const host = h('div')
  host.style.all = 'initial'
  host.style.position = 'fixed'
  host.style.zIndex = '2147483647'
  host.style.right = '16px'
  host.style.bottom = '16px'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.append(h('link', { rel: 'stylesheet', href: chrome.runtime.getURL('styles.css') }))

  const platform = PLATFORMS[job.platform]
  const status = h('p', { className: `rounded-md px-3 py-2 text-xs ${TONE_CLASSES.info}`, textContent: 'Looking for the form…' })
  const fieldStates = new Map<FieldKey, HTMLSpanElement>()

  const createFieldRow = (key: FieldKey, copyValue?: string) => {
    const icon = h('span', { className: 'w-4 text-center font-bold text-slate-400', textContent: FIELD_STATE_ICONS.waiting })
    fieldStates.set(key, icon)
    const handleCopy = () => void navigator.clipboard.writeText(copyValue ?? '')
    return h(
      'li',
      { className: 'flex items-center gap-2 py-1' },
      icon,
      h('span', { className: 'flex-1 text-slate-700', textContent: FIELD_LABELS[key] }),
      copyValue !== undefined &&
        h('button', {
          type: 'button',
          className: 'rounded px-2 py-0.5 text-[11px] text-indigo-700 hover:bg-indigo-50 cursor-pointer',
          textContent: 'Copy',
          ariaLabel: `Copy ${FIELD_LABELS[key].toLowerCase()}`,
          onclick: handleCopy,
        }),
    )
  }

  const urlInput = h('input', {
    type: 'url',
    placeholder: 'Listing URL (optional)',
    ariaLabel: 'Listing URL',
    className: 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none',
  })

  const handleMarkPosted = () => callbacks.onMarkPosted(urlInput.value.trim() || undefined)
  const handleCancel = () => {
    callbacks.onCancel()
    host.remove()
  }

  const extraAction = h('div', { className: 'hidden' })
  const body = h(
    'div',
    { className: 'flex flex-col gap-3 p-4' },
    status,
    h(
      'ul',
      { className: 'text-xs' },
      createFieldRow('title', listing.title),
      createFieldRow('price', String(listing.price)),
      createFieldRow('description', listing.description),
      createFieldRow('photos'),
    ),
    listing.location && h('p', { className: 'text-xs text-slate-600', textContent: `Location: ${listing.location}` }),
    listing.category && h('p', { className: 'text-xs text-slate-600', textContent: `Category: ${listing.category}` }),
    h('p', { className: 'text-xs text-slate-500', textContent: hint }),
    extraAction,
    urlInput,
    h(
      'div',
      { className: 'flex justify-end gap-2' },
      h('button', { type: 'button', className: `${BUTTON_CLASS} text-slate-600 hover:bg-slate-100`, textContent: 'Cancel', onclick: handleCancel }),
      h('button', { type: 'button', className: `${BUTTON_CLASS} bg-indigo-600 text-white hover:bg-indigo-700`, textContent: 'Mark as posted', onclick: handleMarkPosted }),
    ),
  )

  const toggleButton = h('button', {
    type: 'button',
    className: 'rounded px-2 text-lg leading-none text-white/80 hover:text-white cursor-pointer',
    textContent: '–',
    ariaLabel: 'Minimize ListSync panel',
  })
  const handleToggle = () => {
    const isHidden = body.classList.toggle('hidden')
    toggleButton.textContent = isHidden ? '+' : '–'
    toggleButton.ariaLabel = isHidden ? 'Expand ListSync panel' : 'Minimize ListSync panel'
  }
  toggleButton.onclick = handleToggle

  const panel = h(
    'section',
    { className: 'w-80 overflow-hidden rounded-xl bg-white font-sans shadow-2xl ring-1 ring-slate-900/10', ariaLabel: 'ListSync assistant' },
    h(
      'header',
      { className: 'flex items-center justify-between gap-2 bg-indigo-600 px-4 py-3 text-white' },
      h(
        'div',
        { className: 'min-w-0' },
        h('p', { className: 'text-[11px] uppercase tracking-wide text-indigo-100', textContent: `ListSync · ${job.type === 'refresh' ? 'Refreshing on' : 'Posting to'} ${platform.shortLabel}` }),
        h('p', { className: 'truncate text-sm font-semibold', textContent: `${listing.title} · ${formatPrice(listing.price)}` }),
      ),
      toggleButton,
    ),
    body,
  )
  shadow.append(panel)
  document.documentElement.append(host)

  return {
    setStatus: (text, tone = 'info') => {
      status.textContent = text
      status.className = `rounded-md px-3 py-2 text-xs ${TONE_CLASSES[tone]}`
    },
    setFieldState: (key, state) => {
      const icon = fieldStates.get(key)
      if (!icon) return
      icon.textContent = FIELD_STATE_ICONS[state]
      icon.className = `w-4 text-center font-bold ${state === 'done' ? 'text-emerald-600' : 'text-slate-400'}`
    },
    setAction: (label, onClick) => {
      extraAction.className = ''
      extraAction.replaceChildren(
        h('button', { type: 'button', className: `${BUTTON_CLASS} w-full bg-amber-500 text-white hover:bg-amber-600`, textContent: label, onclick: onClick }),
      )
    },
    showSuccess: (text) => {
      body.replaceChildren(h('p', { className: `rounded-md px-3 py-2 text-xs ${TONE_CLASSES.success}`, textContent: text }))
      setTimeout(() => host.remove(), 6000)
    },
  }
}
