import { Component, input } from '@angular/core'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning'
type ButtonSize = 'sm' | 'md'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'text-red-600 hover:bg-red-50',
  warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm',
}

@Component({
  selector: 'app-button',
  standalone: true,
  template: `
    <button
      [attr.type]="type()"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel() || null"
      [attr.aria-current]="ariaCurrent() || null"
      [class]="classes"
    >
      <ng-content />
    </button>
  `,
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('secondary')
  readonly size = input<ButtonSize>('md')
  readonly type = input<'button' | 'submit'>('button')
  readonly disabled = input(false)
  readonly className = input('')
  readonly ariaLabel = input('')
  readonly ariaCurrent = input<string | undefined>(undefined)

  get classes() {
    const sizeClass = this.size() === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm'
    return `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass} ${BUTTON_VARIANTS[this.variant()]} ${this.className()}`
  }
}
