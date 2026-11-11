# ListSync – Kijiji & Facebook Marketplace manager

Chrome extension (Manifest V3, TypeScript, React, Tailwind) for sellers who list on Kijiji and Facebook Marketplace.

- **Sync existing ads** – click **Sync my ads** to pull active listings from your Kijiji My Ads page (`/my/ads.json`) and Facebook Marketplace selling page into the dashboard.
- **Create once, post everywhere** – write a listing in the dashboard, then publish. ListSync opens each marketplace's "post ad" page and autofills title, price, description and photos. You pick the category and click Post; ListSync detects when the ad is live and saves its URL.
- **Stale reminders** – listings older than _N_ days (default 7) are flagged, counted on the toolbar badge, and trigger a desktop notification (at most once per listing per day, with a snooze option).
- **One-click refresh** – Facebook: finds the listing on your selling page and clicks "Renew". Kijiji: saves a full copy of the ad (title, price, description, photos), opens Kijiji’s edit-ad page and copies every form field and text box, deletes the old ad, then reposts that exact copy automatically in a background tab. ListSync restores the saved fields, photos and location, clicks "Post Your Ad", and closes the tab once Kijiji confirms. If anything fails, the tab comes to the front and you get a notification.
- **Dashboard** – every listing with per-marketplace status, age, links, filters (stale / live / drafts) and search. Already-posted ads can be imported with "Already posted" in the listing form.

## Install

```bash
npm install
npm run build      # outputs ./dist
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select `dist/`.

`npm run dev` rebuilds on change (reload the extension afterwards). `npm run typecheck` runs TypeScript.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/background/` | Service worker: publish/refresh jobs, stale-check alarm, badge, notifications |
| `src/content/` | Marketplace content scripts: form autofill, live-ad detection, on-page assistant panel |
| `src/dashboard/` | Full-page dashboard (listings, create/edit form, settings) |
| `src/popup/` | Toolbar popup with stats and quick refresh |
| `src/shared/` | Types, storage, staleness logic, messaging |

## Limitations

- Marketplace pages change often. Autofill finds fields by label text plus a few known selectors; if a field isn't found, the assistant panel has **Copy** buttons and a **Mark as posted** fallback.
- Category, condition and location pickers on the marketplaces are left to you, and ListSync never submits a form on its own.
- Data is stored locally in `chrome.storage.local`; photos are resized to max 1600px JPEG.
