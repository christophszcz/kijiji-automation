import { provideZonelessChangeDetection } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { PopupComponent } from './popup.component'

bootstrapApplication(PopupComponent, {
  providers: [provideZonelessChangeDetection()],
}).catch((error) => console.error(error))
