import { provideZonelessChangeDetection } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { DashboardComponent } from './dashboard.component'

bootstrapApplication(DashboardComponent, {
  providers: [provideZonelessChangeDetection()],
}).catch((error) => console.error(error))
