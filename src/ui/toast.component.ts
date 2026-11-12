import { Component, OnDestroy, OnInit, input, output } from '@angular/core'

@Component({
  selector: 'app-toast',
  standalone: true,
  template: `
    <div role="status" class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
      {{ message() }}
    </div>
  `,
})
export class ToastComponent implements OnInit, OnDestroy {
  readonly message = input.required<string>()
  readonly dismissed = output<void>()

  private timer: ReturnType<typeof setTimeout> | undefined

  ngOnInit() {
    this.timer = setTimeout(() => this.dismissed.emit(), 4000)
  }

  ngOnDestroy() {
    if (this.timer) clearTimeout(this.timer)
  }
}
