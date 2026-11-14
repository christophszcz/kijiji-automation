import { Component, HostListener, input, output } from '@angular/core'
import { ButtonComponent } from './button.component'

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [ButtonComponent],
  template: `
    <div class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/50 p-0 sm:items-start sm:p-8" (click)="handleBackdropClick()">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        class="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:mt-0 sm:max-h-[calc(100dvh-4rem)] sm:rounded-2xl"
        (click)="$event.stopPropagation()"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <h2 id="modal-title" class="pr-2 text-base font-semibold text-slate-900 sm:text-lg">{{ title() }}</h2>
          <app-button variant="ghost" size="sm" ariaLabel="Close dialog" (click)="closed.emit()">✕</app-button>
        </div>
        <div class="min-h-0 overflow-y-auto overscroll-contain">
          <ng-content />
        </div>
      </div>
    </div>
  `,
})
export class ModalComponent {
  readonly title = input.required<string>()
  readonly closed = output<void>()

  @HostListener('document:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') this.closed.emit()
  }

  handleBackdropClick() {
    this.closed.emit()
  }
}
