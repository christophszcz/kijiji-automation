type Tone = 'info' | 'success' | 'warning'

const TONE_CLASSES: Record<Tone, string> = {
  info: 'bg-indigo-50 text-indigo-800',
  success: 'bg-emerald-50 text-emerald-800',
  warning: 'bg-amber-50 text-amber-800',
}

export interface ImportBanner {
  setStatus: (text: string, tone?: Tone) => void
  remove: () => void
}

export const createImportBanner = (title: string, initialStatus = 'Looking for your ads…'): ImportBanner => {
  const host = document.createElement('div')
  host.style.all = 'initial'
  host.style.position = 'fixed'
  host.style.zIndex = '2147483647'
  host.style.right = '16px'
  host.style.bottom = '16px'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: chrome.runtime.getURL('styles.css') }))

  const status = Object.assign(document.createElement('p'), {
    className: `rounded-md px-3 py-2 text-xs ${TONE_CLASSES.info}`,
    textContent: initialStatus,
  })

  const panel = Object.assign(document.createElement('section'), {
    className: 'w-80 overflow-hidden rounded-xl bg-white font-sans shadow-2xl ring-1 ring-slate-900/10',
  })
  panel.setAttribute('aria-label', 'ListSync import')

  const header = Object.assign(document.createElement('header'), {
    className: 'bg-indigo-600 px-4 py-3 text-white',
  })
  header.append(
    Object.assign(document.createElement('p'), {
      className: 'text-[11px] uppercase tracking-wide text-indigo-100',
      textContent: 'ListSync',
    }),
    Object.assign(document.createElement('p'), {
      className: 'text-sm font-semibold',
      textContent: title,
    }),
  )

  const body = Object.assign(document.createElement('div'), { className: 'p-4' })
  body.append(status)
  panel.append(header, body)
  shadow.append(panel)
  document.documentElement.append(host)

  return {
    setStatus: (text, tone = 'info') => {
      status.textContent = text
      status.className = `rounded-md px-3 py-2 text-xs ${TONE_CLASSES[tone]}`
    },
    remove: () => host.remove(),
  }
}
