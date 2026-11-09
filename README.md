# Frame Dashboard

A family dashboard for a cheap Android photo frame, based on Wes Bos's
[Hacking Smart Photo Frames](https://wesbos.com/hacking-smart-photo-frames) project
([wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard)).

It shows the clock, the weather, your calendars, your YouTube channel's stats and a photo
slideshow. Between 10 pm and 6 am it
switches to a dim night clock.

```
┌──────────────┬────────────────┬─────────────┐
│ Clock + date │ Agenda         │ YouTube     │
├──────────────┤ today, then    │ stats       │
│ Weather now, │ the next days  ├─────────────┤
│ hourly, 5-day│                │ Photo       │
│              │                │ slideshow   │
└──────────────┴────────────────┴─────────────┘
```

There are two halves:

1. **This web app.** A Vite page plus a Cloudflare Worker. The Worker fetches weather and
   calendars and hands the frame plain JSON. You can build and deploy it before the frame arrives.
2. **The frame.** You unlock it, root it, and run a full-screen WebView kiosk app that opens
   your URL. Steps are in [docs/frame-setup.md](docs/frame-setup.md).

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The app is built for 1280×800, which is what most 10.1" frames use.
Other sizes scale to fit. Until you add your own calendars it shows demo events, and the
weather is live.

## Configure

**Location and preferences** live in `vars` in [wrangler.jsonc](wrangler.jsonc): city name,
latitude/longitude, time zone, °C/°F, locale, night-mode hours and how many days of agenda to
show.

**Calendars** are a secret, because anyone with an iCal link can read that calendar:

1. In Google Calendar, open Settings → your calendar → **Secret address in iCal format**.
   iCloud, Outlook and Fastmail have an equivalent "publish/subscribe" `.ics` link.
2. For local dev, copy `.dev.vars.example` to `.dev.vars` and fill in `CALENDARS`:

   ```
   CALENDARS='[{"name":"Family","color":"#e07a5f","url":"https://calendar.google.com/calendar/ical/.../basic.ics"},
               {"name":"Work","color":"#81b29a","url":"https://..."}]'
   ```

3. For production, run `npx wrangler secret put CALENDARS` and paste the same JSON.

Recurring events, exceptions, cancelled occurrences and time zones are handled with
[ical.js](https://github.com/kewisch/ical.js).

**YouTube stats:** the card shows subscribers, total views, video count and your latest
video. Set the channel with `YOUTUBE_HANDLE` in `wrangler.jsonc` (it's `@rishabincloud` now). It
needs a free YouTube Data API key:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (or pick one)
   and enable **YouTube Data API v3** (APIs & Services → Library).
2. Go to APIs & Services → Credentials → **Create credentials → API key**. Under API
   restrictions, limit the key to YouTube Data API v3.
3. Put `YOUTUBE_API_KEY=...` in `.dev.vars` for local dev, and run
   `npx wrangler secret put YOUTUBE_API_KEY` for production.

The Worker refreshes the stats every 30 minutes. Each refresh uses 3 of the 10,000 free daily
quota units. The API rounds subscriber counts to 3 significant figures (45,678 shows as 45.6K),
so small daily changes won't show. Without a key, the card shows a short setup hint.

**Photos:** drop images into `src/photos/` and run:

```bash
npm run photos
```

This shrinks them to 1280px JPEGs (it uses macOS `sips`) and moves the full-size originals to
`photos-originals/`. The frame has about 1 GB of RAM, and a full-size camera photo can crash its
WebView. `npm run deploy` runs this step for you. Photos are bundled into the build, so redeploy
after adding them. Tap the photo to make it full screen, and tap again to go back.

`src/photos/` and `photos-originals/` are git-ignored, so your photos are deployed but never
committed.

## Deploy

```bash
npx wrangler login
```

```bash
npm run deploy
```

This gives you a `https://frame-dashboard.<you>.workers.dev` URL. Old Android trusts the
`*.workers.dev` certificate chain (Let's Encrypt certificates fail on Android 6), which is one
reason to use Workers here.

After each deploy, the frame notices the new version within 10 minutes and reloads itself.

## Built for old WebViews

The frames run Android 6–10 with a WebView as old as Chrome 106. Following the
[notes in Wes's repo](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/building-for-the-frame.md):

- The Vite build targets `chrome106` for JS and `chrome61` for CSS. `npm run check:css` fails
  the build check if 4/8-digit hex colours, `oklch`/`color-mix`, `dvh` or `:has()` get into the
  CSS.
- There are no infinite animations and no CDN assets (fonts are bundled). All API calls go
  through the Worker.
- The clock repaints once a minute, and the agenda only re-renders when something changes.
- Fetches retry with backoff, because Wi-Fi comes up after the kiosk at boot. The last good data
  is cached in `localStorage`. The page also reloads itself at 3:30 am every night.

## Project layout

```
index.html                 page shell
src/client/main.js         clock, weather, agenda, photos, night mode, refresh loop
src/client/styles.css      layout and theme
src/client/weather-icons.js static SVG icons
src/worker/index.js        Worker: /api/dashboard, static assets
src/worker/weather.js      Open-Meteo (no API key)
src/worker/calendar.js     iCal feeds → expanded events
src/worker/youtube.js      YouTube channel stats + thumbnail proxy
src/worker/demo.js         demo events shown until CALENDARS is set
src/photos/                your photos (bundled at build time)
docs/frame-setup.md        unlocking the frame and installing the kiosk
```
