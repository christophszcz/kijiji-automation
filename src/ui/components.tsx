import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { PLATFORMS } from '../shared/constants'
import type { PlatformId, PostStatus } from '../shared/types'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'text-red-600 hover:bg-red-50',
  warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
}

export const Button = ({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }: ButtonProps) => (
  <button
    type={type}
    className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm'} ${BUTTON_VARIANTS[variant]} ${className}`}
    {...props}
  />
)

export const PlatformBadge = ({ platform }: { platform: PlatformId }) => (
  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${PLATFORMS[platform].badgeClassName}`}>
    {PLATFORMS[platform].shortLabel}
  </span>
)

const STATUS_STYLES: Record<PostStatus, { label: string; className: string }> = {
  not_posted: { label: 'Not posted', className: 'bg-slate-100 text-slate-600' },
  pending: { label: 'In progress…', className: 'bg-indigo-100 text-indigo-700 animate-pulse' },
  posted: { label: 'Live', className: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
}

export const StatusPill = ({ status, isStale = false }: { status: PostStatus; isStale?: boolean }) => {
  const style = isStale ? { label: 'Stale', className: 'bg-amber-100 text-amber-800' } : STATUS_STYLES[status]
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>{style.label}</span>
}

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export const Modal = ({ title, onClose, children }: ModalProps) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id="modal-title" className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const Toast = ({ message, onDismiss }: { message: string; onDismiss: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  return (
    <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
      {message}
    </div>
  )
}
