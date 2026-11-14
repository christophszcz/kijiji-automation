import { Component, OnDestroy, OnInit, input, output } from '@angular/core'

@Component({
  selector: 'app-toast',
  standalone: true,
  template: `
    <div
      role="status"
      class="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm text-white shadow-lg sm:bottom-6 sm:left-1/2 sm:right-auto sm:w-auto sm:max-w-md sm:-translate-x-1/2 sm:text-left"
    >
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
