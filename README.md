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

1. **Where are you starting?** → drive time + a suggested backbone itinerary
2. **How many days?** → scopes how far afield we suggest roaming
3. **Getting here** → car, or fly into a regional airport + pick a rental company
4. **What are you here for?** → travel styles that filter the road-trip stops
5. **Build your road trip** → click national parks, monuments, towns, state parks
6. **Comfort level** → camping/RV → premium; shows matching stays
7. **Your Medora day** → see/do, eat, shop, evenings + live events
8. **The Library** → admission/tour/café options + a direct booking link
9. **Finished trip** → a clean summary they can Print / Save to PDF

Selections collect in the right-hand panel the whole way through, so the
itinerary builds up visibly as they click.

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
