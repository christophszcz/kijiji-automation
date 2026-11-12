import { Component, HostListener, input, output } from '@angular/core'
import { ButtonComponent } from './button.component'

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [ButtonComponent],
  template: `
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" (click)="handleBackdropClick()">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        class="w-full max-w-2xl rounded-2xl bg-white shadow-2xl"
        (click)="$event.stopPropagation()"
      >
        <div class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id="modal-title" class="text-lg font-semibold text-slate-900">{{ title() }}</h2>
          <app-button variant="ghost" size="sm" ariaLabel="Close dialog" (click)="closed.emit()">✕</app-button>
        </div>
        <ng-content />
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
