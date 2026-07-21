# TR Library Trip Planner

An embeddable, interactive trip planner for the Theodore Roosevelt Presidential
Library website. Guests answer a few questions and click what appeals — origin,
days, how they're getting here, road-trip stops, lodging comfort, their Medora
day, and their Library visit — and the planner assembles an itinerary they can
print and book.

**Live:** https://trip.labs.trlibrary.com
**Hosting:** GitHub Pages (static). No server, no API keys, no per-query cost.

---

## Embed it (one div + one script)

Paste these two lines into a Full-HTML / Custom-HTML block anywhere on the
Drupal site:

```html
<div id="tr-trip-planner"></div>
<script src="https://trip.labs.trlibrary.com/assets/trip-planner.js" data-container="tr-trip-planner"></script>
```

The script finds the `<div>` by the id in `data-container`, injects its own
styles (scoped to that container, using the trlibrary.com color + type tokens),
loads its data, and renders the planner. You can place the `<div>` and `<script>`
independently; change `data-container` if you need a different id.

---

## How it works

It's a **rule-based wizard** — deterministic, no AI, nothing to hallucinate.
Everything the planner "knows" lives in plain JSON in [`data/`](./data). Editing
the trip planner = editing JSON. No rebuild step.

```
TripPlanner/
├── index.html                 Demo/host page (also the Pages landing page)
├── CNAME                       Custom domain: trip.labs.trlibrary.com
├── assets/
│   └── trip-planner.js         The entire embed — UI, logic, styling (self-contained)
├── data/                       All content the planner uses (edit these)
│   ├── config.json             Brand colors, comfort tiers, travel styles
│   ├── origins.json            Starting cities + drive times + suggested routes
│   ├── airports.json           Regional airports + rental-car companies at each
│   ├── destinations.json       Road-trip stops: parks, monuments, towns, state parks
│   ├── lodging.json            Hotels + camping/RV by comfort tier
│   ├── medora.json             The Medora day: see/do, dining, shopping, evenings
│   ├── itineraries.json        The curated trips from /visit/itineraries
│   ├── library.json            Library visit + booking options
│   └── events.json             AUTO-GENERATED — do not hand-edit (see below)
├── scripts/
│   └── refresh-events.mjs       Pulls live events into data/events.json
└── .github/workflows/
    ├── deploy.yml               Publishes the site to Pages on every push
    └── refresh-events.yml       Runs the event refresh daily, commits changes
```

### The guest flow

A clickable step header runs across the top — guests can jump back to any
visited step to change answers, no Back-button hunting.

The flow leads with what the guest wants to see, then handles logistics:

1. **What do you want to see & do?** → interests that surface the best stops
2. **Build your road trip** → national parks, monuments, towns, state parks (regional stops become day trips)
3. **Your Medora day** → see/do, eat, shop, evenings + live events
4. **The Library** → general admission + the five specialty tours (each with its real days/times/price)
5. **Where are you coming from?** → starting point, drive time
6. **Getting here** → car, or fly in; suggests the best airport **based on the stops picked**, supports flying into one airport and **out of another**, with rental companies filtered to those serving **both**
7. **Dates & pace** → arrival date (enables day-of-week availability) + days + relaxed/balanced/packed
8. **Comfort level** → camping/RV → premium; the full Medora lodging list by tier + season
9. **Day-by-day schedule** → a dated, hour-by-hour plan → Print / save

The schedule includes **getting-to-Medora travel**: the drive from the origin
(or flight arrival + airport-to-Medora drive) is built into day 1, and the
return drive/flight into the last day, so the plan reflects real travel time.

Selections collect in the right-hand panel the whole way through.

### Scheduling & availability

The final step runs a heuristic scheduler that turns the guest's picks into a
dated, timed itinerary:

- **Time-anchored** items (Library tours, the Medora Musical, Pitchfork Fondue)
  are placed at their actual start times, only on days of the week they run.
- **Flexible** activities fill the day around those anchors within opening
  hours, up to the chosen pace budget (relaxed ≈ 6h, balanced ≈ 8h, packed ≈ 10h/day).
- **Regional stops** (Devils Tower, Mount Rushmore, etc.) become their own day
  trips with drive-time rows there and back.
- **Season and weekday** are checked against the arrival date; anything that
  can't run on the chosen dates is moved to a clearly-labeled "check
  availability / didn't fit" list with the reason.

Availability lives in each item's `avail` block in the data files:
`season: [openMonth, closeMonth]`, `open`/`close` daily window, and
`fixed: [{ days:[0=Sun..6=Sat], start, end }]` for time-anchored departures.

### Printer-friendly output

**Print / save itinerary** opens a purpose-built print page (its own window and
stylesheet — not a raw browser dump of the widget) with the dated schedule, a
booking link and **phone number** for every planned stop, the lodging list, and
a "Reservations to make" checklist. Guests print it or save as PDF.

---

## Editing content

Everything is curated JSON — safe for non-developers to edit. Each file has a
`note` field at the top explaining its shape. A few common edits:

- **Add a road-trip stop:** add an object to `data/destinations.json`
  (`type`, `milesFromMedora`, `dwell`, `tags`, `blurb`, `url`).
- **Add a hotel or campground:** add to `data/lodging.json` with the right
  `tier` (`camp` / `value` / `comfort` / `premium`).
- **Add a Medora activity, restaurant or shop:** add to `data/medora.json`
  with a `category` (`attraction` / `dining` / `shopping` / `evening` / `library`).
- **Change colors/type or comfort tiers:** `data/config.json`.

After editing, commit to `main` — Pages redeploys automatically (usually < 1 min).

---

## The events pipeline (GitHub Actions)

`data/events.json` is **auto-generated** — don't hand-edit it. A scheduled Action
(`refresh-events.yml`, daily) runs `scripts/refresh-events.mjs`, which:

1. Fetches each source page: **medora.com/events**, the **ND Cowboy Hall of Fame**,
   the **National Park (NPS) calendar**, and the **Medora Chamber**.
2. Extracts schema.org `Event` data (JSON-LD) from each.
3. Keeps current/upcoming events (out to ~13 months) and writes `events.json`.
4. If a source changes or is temporarily down, the previous events for that
   source are **preserved** — one broken scrape never empties the planner.
5. Commits the file if it changed; the deploy workflow republishes.

Run it on demand from the **Actions → Refresh events → Run workflow** button, or
locally with `node scripts/refresh-events.mjs`.

To harden a specific source (some calendars don't publish JSON-LD), add a
site-specific branch in `parseSource()`. The JSON-LD path already handles any
source with standard Event markup.

---

## One-time GitHub setup

1. **Settings → Pages →** Source = *GitHub Actions*.
2. **Settings → Pages →** Custom domain = `trip.labs.trlibrary.com` (the `CNAME`
   file is already committed); the DNS `CNAME` record should point at
   `theodore-roosevelt-presidential-library.github.io`. Enable *Enforce HTTPS*.
3. **Settings → Actions → General →** Workflow permissions = *Read and write*
   (so the event refresh can commit).

---

## Design notes

The planner mirrors the trlibrary.com look: badlands terracotta (`#E7805D`),
deep navy (`#092A4D`), a warm paper background, Clearface-style serif headings
and Oswald (a close, freely-hosted stand-in for the site's Dharma Gothic display
face). Styles are scoped to the embed container so they won't leak into or
inherit unexpectedly from the host page.
