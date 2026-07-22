# CLAUDE.md — working guide for this repository

This file orients any Claude (or human) picking up the **Theodore Roosevelt
Presidential Library trip planner**. It captures the architecture, the accumulated
business rules, the conventions to follow, and the "why" behind the design so you
can make changes safely without rediscovering everything. `README.md` is the
user/operator-facing doc; this file is the builder-facing one. When they overlap,
this file has the deeper reasoning.

> **Keep this file in sync.** CLAUDE.md is only useful if it stays true. Whenever you
> change the code, data model, scheduler rules, pipeline, or conventions, **update
> the relevant section of this file in the same change** — add new rules to §6, new
> data fields to §5, new gotchas to §9, and a bullet to the §11 history. Treat an
> out-of-date CLAUDE.md as a bug: if a change makes anything here wrong, fix it here
> too before you finish.

---

## 1. What this is

An **embeddable, single-file, rule-based interactive trip planner** for the TR
Presidential Library in Medora, North Dakota. A guest answers a short wizard
(interests → road-trip stops → months → Medora day → Library → origin → getting
here → dates/pace → lodging) and gets a **dated, hour-by-hour, day-by-day
itinerary** they can print, export to calendar, or share by URL.

- **Live:** `https://trip.labs.trlibrary.com` (GitHub Pages).
- **Repo:** `Theodore-Roosevelt-Presidential-Library/TripPlanner`.
- **Nature:** deterministic, no AI at runtime, no backend, no build step. Everything
  the planner "knows" is curated JSON in `data/`. Editing the planner = editing
  JSON or the one JS file.
- **Aesthetic:** trlibrary.com scrapbook style — terracotta `#E7805D`, navy
  `#092A4D`, Clearface serif. Colors come from `data/config.json`.

---

## 2. Golden rules (read before editing)

1. **No build step, no framework, no runtime dependencies.** `assets/trip-planner.js`
   is a vanilla-JS IIFE. The site is static files served from the repo root. Don't
   introduce bundlers, npm packages for the site, or a framework. (Playwright is
   installed *only in CI*, never committed as a dependency — there is intentionally
   no `package.json`.)
2. **Data-driven.** Prefer changing `data/*.json` over hard-coding. New stops,
   activities, hotels, tours, hours, prices → JSON.
3. **Never hotlink images.** Every `image` field must be a local `assets/img/<md5>.jpg`.
   To add one: set `image` to a remote URL, run `python3 scripts/cache-images.py`
   (downloads, resizes ≤900px, q82, repoints the field). Wikimedia rate-limits
   (HTTP 429) — retry with pauses. Verify the cached file actually shows the right
   subject (`Read` the image).
4. **Verify with the jsdom harness after any logic/data change.** See §8. The app
   exposes `window.__TRTP` for headless testing. Historically, most "bugs" turned
   out to be bad test inputs — build realistic scenarios (air arrival, a nearby
   airport set, enough days).
5. **Respect the disclaimer.** This is explicitly *not a live booking system*. It
   works from curated data. Keep the "confirm with each venue" messaging intact.
6. **End every change** by: `node --check assets/trip-planner.js`, validate all
   `data/*.json` parse, run the relevant jsdom tests, then `present_files`.

---

## 3. File map

```
index.html                     Demo/host page + Pages landing page
CNAME                          trip.labs.trlibrary.com
.gitignore                     ignores CI-generated status/report files + node_modules
assets/
  trip-planner.js              THE ENTIRE EMBED — ~1560 lines: state, steps, scheduler, render, CSS, print, iCal, permalink
  img/<md5>.jpg                130 locally-cached, resized photos
data/                          all curated content (edit these)
  config.json                  brand colors, comfort tiers, travel styles
  origins.json                 15 starting cities: coords, drive times, suggested routes
  airports.json               7 regional airports: coords, driveToMedoraMin/Miles, rental companies
  destinations.json            43 road-trip stops (parks, monuments, battlefields, towns, state parks, Dickinson day-trips)
  lodging.json                 18 lodging: Medora properties (tiered) + nearbyBase towns with hotels
  medora.json                  80 Medora items: see/do, recreation, tours, evening shows, dining, shopping, events
  library.json                 Library general admission + 5 specialty tours (real days/times/prices)
  itineraries.json             curated trips from trlibrary.com/visit/itineraries
  weather.json                 monthly hi/lo/precip + per-season pack/prepare
  events.json                  AUTO-GENERATED (do not hand-edit) — see §7
scripts/
  cache-images.py              download+resize remote images into assets/img, repoint data
  refresh-events.mjs           weekly event scraper (JSON-LD + MEC + Saffire, Playwright, retries, validation, issue-on-failure)
  check-data-freshness.mjs     weekly watchdog: link-rot + Musical season drift + staleness → opens issue
.github/workflows/
  deploy.yml                   publish repo root to Pages on push to main
  refresh-events.yml           weekly (Mon 11:00 UTC) event refresh + issue-on-failure
  check-data.yml               weekly (Mon 11:30 UTC) freshness watchdog + issue-on-drift
```

---

## 4. The embed (`assets/trip-planner.js`)

One IIFE. Key internals (search by name):

- **`S`** — mutable state object: `step`, `maxStep`, `origin`, `startDate` (ISO),
  `months` (1–12), `days`, `pace` (`relaxed|balanced|packed`), `arrival`
  (`car|air`), `airport`, `diffReturn`, `airportOut`, `rental`, `styles`
  (interests), `tier` (comfort), and `picks` `{route, lodging, medora, library}`
  (arrays of ids).
- **`D`** — loaded data, keyed by filename (`D.medora`, `D.destinations`, …).
  `D.library._all` = admission + tours + options flattened.
- **`STEPS`** — array of step objects `{render(main), canAdvance(), nextLabel}`.
  **`STEP_LABELS`** — the 10 stepper labels: Interests, Road trip, Season, Medora,
  Library, Coming from, Getting here, Dates, Stay, Schedule.
- **`render()`** — rebuilds the whole widget for `S.step`; calls `syncURL()` at the
  end (permalink). **`goto(i)`** — set step + scroll to top. **`toggle(bucket,id)`**
  — add/remove a pick and re-render. **`removePick(id)`** — remove from whichever
  pick bucket holds it (used by the over-capacity Remove buttons).
- **`el(tag, attrs, children)`** — tiny DOM builder used everywhere.
- **`boot()`** — fetches the 10 data files, injects CSS, `defineSteps()`,
  `decodeState(location.hash)`, `render()`.
- **`window.__TRTP`** (test hook) = `{ state:S, build:buildSchedule, data:D,
  recommend:recommendAirports, render, goto, encode:encodeState,
  decode:decodeState, ics:buildICS }`.

### The scheduler — `buildSchedule()` → `layoutDay()`

`buildSchedule()` is the heart. Pipeline:

1. Normalize picks: `normLib`, `normMed`, `normDest`. Library items get `area:"library"`.
2. Split road-trip stops into **near** (`milesFromMedora <= NEAR_MI` = 110) and
   **far**. Near stops fold into the Medora block as **day trips** (`nearLocal`,
   duration = visit + round-trip drive). Far stops become **en-route legs**.
3. Classify far stops **inbound vs outbound** by distance to the entry/exit airport;
   order geographically; each carries an `overnight` gateway city + `visitDays`.
4. **`medoraDays`** = enough days for the local load at the chosen pace, **plus one
   day per "big" near day-trip** (a day-trip ≥60% of the daily budget gets its own
   day so it isn't crammed onto a travel-heavy arrival/departure day).
5. **Capacity**: if `legDays + medoraDays > S.days`, trim the farthest stops first,
   then shrink the Medora block (min 1), and record what was cut (`capacity`,
   `overflow`).
6. Build the ordered plan: inbound legs → contiguous Medora block → outbound legs.
7. **Assign** local items to Medora days via `canPlace(day,item)` (season, weekday,
   fixed-time conflicts, one evening show/night, one meal/slot/day, pitchfork rule,
   day budget). Library items are **co-located on one day**. Leftovers → `overflow`
   with a human reason.
8. **Routing pass** sets drive distances between the entry airport, legs, Medora,
   and the exit airport. Includes the **departure-airport sanity reroute** (see §6).
9. **`layoutDay(day)`** turns assigned items into timed `entries`: flight arrival
   buffer, drive-in, fixed-time **anchors** placed at their real times, **flexible**
   items filling around them inside opening hours + meal windows. Anything that
   can't fit its window becomes an "Also consider" note.

Result shape: `{ days:[{index,date,kind,entries,notes,...}], overflow, booking,
capacity, exitNote, medoraDays, medoraBase }`.

### Other surfaces

- **Permalink**: `encodeState()`/`decodeState()` serialize `S` to the URL hash;
  `syncURL()` writes it via `history.replaceState` on every render (so the browser
  address bar itself is a shareable link). `shareURL()` + a "Copy shareable link"
  button on the schedule step.
- **iCal**: `buildICS(sched)` → `downloadICS()`. One VEVENT per scheduled entry,
  **floating local time** (no TZID — correct for a trip that crosses into Mountain
  Time). Button only shown when `S.startDate` is set.
- **Print**: `openPrintable()` writes a standalone print window (own stylesheet),
  with the disclaimer banner, booking table, day-by-day, weather, and a
  reservations checklist.

---

## 5. Data model — key semantics

Most fields are self-explanatory; the load-bearing ones:

- **`avail`** drives scheduling:
  - `season: [openMonth, closeMonth]` — seasonal availability (month granularity).
  - `open`/`close` — daily hours `"HH:MM"`; **enforced** in `layoutDay` (a place is
    never scheduled outside these).
  - `fixed: [{ days:[0=Sun..6=Sat], start, end }]` — time-anchored departures
    (Library tours, Musical, Pitchfork). These become fixed anchors.
- **`meal`** (`breakfast|lunch|dinner`) — meal window enforcement (breakfast morning,
  lunch midday, dinner from 5pm) and the one-per-slot-per-day rule.
- **`milesFromMedora`** + `NEAR_MI` (110) decide near-day-trip vs far-leg.
- **`overnight: {city, search}`** + **`visitDays`** — for far stops: gateway city to
  sleep in and how many days it needs.
- **`popularity`** (1–5, destinations) — combines with distance for the road-trip
  sort: `relScore = milesFromMedora * (1 - 0.08*(popularity-1))`; ≥4 shows "★ Popular".
- **`gps: true`** + `lat`/`lng` — NPS trailheads route Directions to exact coords
  instead of the street address.
- **`address`** — every Medora item and stop has one; used for on-screen display,
  print, Google Maps links (`mapsUrl`), and the ICS `LOCATION`.
- Lodging: `nearbyBase:true` marks drive-in base towns (Belfield/Dickinson/Beach/
  Glendive) with per-town `quality` and `hotels[]`; a base town and in-Medora stays
  are mutually exclusive.

---

## 6. Accumulated scheduler rules (the "business logic")

These were added incrementally from user feedback. Preserve them:

- **Contiguous Medora stay** — the Medora days are one block; far stops are strung on
  the way in/out with **gateway-city overnights** (Yellowstone→Cody, Devils
  Tower→Sundance, Rushmore→Keystone, etc.). Guests book one Medora hotel.
- **Airport recommendation** (`recommendAirports`) — a cost model over airport pairs;
  proposes an **open-jaw** (fly into one, out of another) only if it saves >120 mi
  and a rental serves both. One-click apply + manual override.
- **Departure-airport sanity reroute** — if a trip ends in Medora with no outbound
  stops and the chosen fly-out airport is >90 min farther than the nearest, reroute
  departure to the nearest airport and surface an `exitNote` (fixes the "drive 5h to
  Billings to fly home" nonsense).
- **Drive times** — `haversine()` already multiplies straight-line by **1.15** for
  road distance. `driveMin()` then converts to time at **53 mph** blended, +5 min
  buffer, rounded to nearest 15 — deliberately generous (never rushed). ⚠ Don't
  double-apply circuity; that bug once produced 4h45 for a 3h50 drive. Flight
  arrivals add a **90-min** deplane/luggage/rental buffer.
- **One evening show per night**; **Pitchfork Steak Fondue only on a Medora Musical
  day** (it's the pre-show dinner); **one breakfast/lunch/dinner per day** (Pitchfork
  counts as the dinner). Violations → `overflow`/notes with a clear reason.
- **Library tours + admission co-locate** on one day. Admission = 4.5h (3.5h exhibits
  + 1h grounds); every specialty tour = 1h.
- **Meal windows** — breakfast before ~10:30, lunch ~12–14:00, dinner from 17:00;
  outside-window items become "Also consider" notes rather than mis-timed rows.
- **Over-capacity UI** — "Make it N days →" (bumps `S.days` to the required number),
  "Switch to Packed", "Edit dates", and per-overflow **Remove** buttons that
  recalculate in real time.
- **Weather/packing** keyed to the selected months (or the exact trip dates when set).
- **Far stops are season-filtered** in `buildSchedule` (out-of-season → overflow with
  "closed on your dates (seasonal)") so a seasonal en-route stop can't be built into a
  winter leg. (Near stops are season-checked via `canPlace`.)
- **Nothing is scheduled at an impossible time.** Leg-day visits respect the stop's
  open/close and never spill past ~22:00 — if a long drive-in means you'd arrive after
  hours, the visit becomes a "settle in, explore in the morning" note instead of a
  midnight row. A fixed-time anchor whose start has already passed because you're still
  arriving (long drive-in) is skipped to a note, never overlapped onto the drive.
- **Every activity `entry` carries its `id`** (leg/flex/anchor) — used for de-dup,
  traceability, and the stress harness's id-based invariant checks.
- **Multi-day drive split (general, per-segment).** The plan is built by a **segment
  walk** (`connect()`): entry → inbound legs → Medora → outbound legs → exit. ANY
  single drive longer than a day (`> DAY_DRIVE`=600 min) becomes dedicated **`transit`
  days** (`kind:"transit"`, each ≤ `DAY_DRIVE`, "overnight en route"), and the node
  after transit arrives with **no drive-in** (no giant row). Drive-ins are stored as
  `_driveMin` (minutes) on the first day of each node; transit days carry `seg`/
  `towards`/`arriveHome`. **Anti-cram:** a 1-day Medora block that also carries the
  drive home dedicates its arrival to a transit day (`forceArr`), and the **exit** gets
  its own day when `lastDayContent + driveHome > 13h` of daytime (`DAY_SPAN`), so
  arrival + departure never stack past midnight. Transit days count toward
  `requiredDays` (`transitEstimate`, leg-independent) and can't be trimmed. Verified by
  the stress harness (§8): 4,000 fuzz scenarios → 0 midnight rows (down from ~250).

---

## 7. The data pipeline (weekly GitHub Actions)

Two resilient weekly jobs (Monday mornings). See README §"The data pipeline" for the
operator view; the design intent:

- **`refresh-events.mjs`** pulls `events.json`. Per-source parsers: JSON-LD (default),
  **MEC** (medora.com/calendar), **Saffire** (VisitDickinson). JS-rendered sources
  render with **Playwright** in CI, static fetch fallback. **Retry/backoff**,
  **validation** (real calendar dates), **keep-previous on any failure** (a broken
  scrape never empties the calendar), and it **opens a GitHub issue** when a source
  errors/yields nothing. Pure helpers are exported and unit-tested.
- **`check-data-freshness.mjs`** is a watchdog for the *curated* data the refresher
  doesn't touch: **link-rot** (every booking/info URL resolves), **season drift**
  (Musical season on medora.com still matches `medora.json`), **staleness**. It
  **never edits data** — it opens an issue for a human. This is the deliberate line:
  automation watches hours/seasons and flags drift; a person confirms and updates,
  keeping the "not a live booking system" promise honest.

Both write generated files (`data/refresh-status.json`, `data/freshness-report.md`)
that are `.gitignore`d. Committing `events.json` and opening issues needs
**Actions → General → Workflow permissions = Read and write**. ⚠ If that radio is
greyed out, the **org** has locked the default to read-only — fix it at
**Organization → Settings → Actions → General** (per-workflow `permissions:` blocks
generally can't exceed an org-locked read-only default; you'd otherwise hit
`403: Resource not accessible by integration`, and Pages deploys may fail too).
The fallback is running the workflows with a fine-grained PAT/App-token secret
instead of the default `GITHUB_TOKEN`.

⚠ The MEC/Saffire DOM parsers are best-effort against live layouts that couldn't be
tested offline. If a layout doesn't match, they yield nothing → seed preserved →
issue opened. Tune selectors after the first real Monday run (or a manual dispatch).

---

## 8. Testing (no framework — jsdom + node)

There is no test runner committed. Verification is ad-hoc but rigorous:

- `node --check assets/trip-planner.js` and `JSON.parse` every `data/*.json`.
- **jsdom harness pattern** (used all over this project): load `trip-planner.js`
  into a JSDOM window, mock `fetch` to read local files, mock `scrollTo/print/open`
  and `navigator.clipboard`, set `document.currentScript`, then drive via
  `window.__TRTP` (set `state`, call `build()`/`render()`) or click through the DOM.
  Assert on the returned schedule or rendered DOM. Install jsdom in the sandbox with
  `npm i jsdom` under `HOME=/tmp`-style scratch; it's never a repo dependency.
- **Script unit tests**: `refresh-events.mjs` and `check-data-freshness.mjs` export
  their pure functions (`collectJsonLd`, `parseMec`, `parseSaffire`, `validateEvents`,
  `validDate`, `upcoming`, `isStale`, `extractSeasonMonths`, …) plus `main`; test by
  importing and mocking `globalThis.fetch`. The offline-resilience test simulates a
  total outage and asserts events are preserved + a warn status is emitted.
- **Realistic inputs matter.** A far origin + few picks legitimately collapses to a
  short plan; don't mistake that for a bug (see §9).
- **Invariant stress harness.** A throwaway jsdom harness (kept in scratch, not
  committed) generates thousands of seeded-random scenarios and asserts invariants that
  must hold for *every* itinerary: nothing scheduled outside its open hours/season, no
  two entries overlap, **conservation of picks** (every pick is scheduled, in overflow
  with a reason, or a note — never silently dropped), one meal/slot & one evening show
  per day, Pitchfork only with the Musical, drive times positive 15-min multiples, no
  NaN/exceptions, dates in order, booking sanity. Map entries→items by `entry.id`.
  Reproduce any failure via its seed. This found four real bug classes at once
  (season-blind legs, impossible anchor overlaps on long-drive days, past-midnight leg
  visits, out-of-season far stops) that the targeted tests had missed — rerun it after
  any scheduler change.

---

## 9. Known limitations & gotchas

- **Long drives are split per-segment** (see §6) — the general fix landed, so the
  stress harness finds **no midnight/stacking rows** across 4,000 fuzz scenarios
  (Chicago, Seattle, Winnipeg + Yellowstone + Grand Teton, far origins + scattered far
  parks all lay out cleanly). Only remaining edge: the **season-rollover** below.
- **Season rollover edge (~1 in 4000).** The far-stop season filter uses the trip's
  *start* month; a trip that begins in-season but a far stop's leg lands a day or two
  into the next, out-of-season month isn't caught (e.g. start Sep 28, leg on Oct 1 for
  a May–Sep stop). Negligible and the stop is barely out of season; documented, not
  fixed (fixing needs per-leg-date season checks — risk not worth it).
- **Drive-time estimate.** haversine×1.15 over-estimates long east–west US drives
  (Chicago→Medora reads ~18h vs ~13h), so far trips use a day or two more transit days
  than strictly needed. Generous by design; per-corridor real mileages would tighten it.
- **Season rollover edge.** The far-stop season filter uses the trip's *start* month;
  a trip that begins in-season but a far stop's leg lands a day or two into the next,
  out-of-season month is not caught (≈1 in 3000 fuzz scenarios). Negligible; noted.
- **Meal assignment vs layout.** `canPlace` assigns meals to days by budget, but
  doesn't know a day's morning is consumed by a drive — so a breakfast can land as
  an "Also consider" note even when another day had a free morning. Correct-but-not
  optimal; a morning-aware assignment is a future improvement.
- **JS-rendered event sources** need Playwright; the parsers are unverified against
  live DOM (see §7).
- **Image attribution.** Wikimedia photos may need attribution before a formal public
  launch. A few small independents publish only on Facebook (unfetchable
  server-side) and share a real Medora street photo.
- **Drive-time overshoot.** On legs where straight-line distance overshoots the real
  road (e.g. Devils Tower→Medora reads ~3h45 vs ~3h10 actual), the estimate runs a
  bit long — intentional ("never rushed"), tunable per-corridor with real mileages.
- **Distances are approximate.** `milesFromMedora` are hand-entered road-ish miles;
  leg drives use haversine×1.15. Good enough for planning, not routing.

---

## 10. How to extend (common tasks)

- **Add a road-trip stop** → append to `data/destinations.json` with `id, name, type,
  lat, lng, milesFromMedora, dwell, corridor, tags, blurb, url, duration, phone,
  avail, image (remote URL), address, popularity` and, if `>110mi`, `overnight` +
  `visitDays`. Run `cache-images.py`. Verify routing (near=day-trip, far=leg) via jsdom.
- **Add a Medora item** → `data/medora.json`; set `category`, `duration`, `avail`
  (season/open/close/fixed), `meal` if dining, `address`, `image`. Dining items must
  have real `open`/`close`.
- **Add/adjust a Library tour** → `data/library.json`; `duration` and each `fixed`
  window should agree (the schedule shows the fixed window length for anchors).
- **Tune activity durations** → each item's `duration` (minutes). Library = 270 for
  admission, 60 per tour, by user decree.
- **Add an event source** → `SOURCES` in `refresh-events.mjs` with a `strategy`
  (`jsonld|mec|saffire`) and `render:true` if JS-heavy; add a parser branch if it's
  a new CMS. Keep the keep-previous-on-failure contract.
- **Change brand/colors/tiers** → `data/config.json`.

After any change: `node --check`, validate JSON, run jsdom tests, `present_files`.

---

## 11. History (what was built, in order)

The project grew through many feedback rounds. Rough chronology of themes (each was
verified before moving on):

1. Core embed + data model + day-by-day scheduler + printable output.
2. Reordered flow to **interests-first**; added real travel time.
3. Photos for everything, then **cached locally** (no hotlinking); iconic
   Wikimedia images.
4. **"Which months"** season step + season filtering.
5. Efficient routing rewrite: **contiguous Medora stay**, gateway cities, nearby
   drive-in bases; booking (nights/dates) panel.
6. **Airport recommendation** engine (open-jaw), then departure-airport reroute.
7. Weather/packing; date-relative weather; scroll-to-top; day-budget capacity guidance.
8. **Dickinson** integration (12 day-trip stops + events).
9. Salt + Scoria rename; smart day-count on Dates; comfort-aware town hotels.
10. Addresses everywhere + trailhead GPS; comprehensive Medora dining/shops;
    "dine around" chips.
11. Rental-car guidance (grey out invalid, no-rideshare); timing guardrails
    (one evening show, Pitchfork↔Musical).
12. Stop ordering by Library-relationship + **popularity**; fixed duplicate images;
    date-recommend stays on schedule step; **Library durations**; **drive-time**
    recalibration + travel buffers.
13. Dining **open-hours** enforcement + meal windows; **one meal/slot/day**;
    over-capacity **inline remove + recalc + day links**; **shareable URL permalink**;
    **iCal export**; not-real-time **disclaimer**.
14. Added 9 missing **NPS/state-park/major** stops (Makoshika, Fort Union, Little
    Bighorn, Pompeys Pillar, Minuteman Missile, Jewel Cave, Crazy Horse, Bighorn
    Canyon, Lewis & Clark/Fort Mandan); big-day-trip `medoraDays` fix.
15. **Hardened data pipeline**: weekly cadence, MEC/Saffire parsers, Playwright,
    retries, validation, issue-on-failure, and the freshness/link-rot watchdog.
16. **Documentation**: this CLAUDE.md builder's guide + README pointer.
17. **Invariant stress test** (thousands of seeded scenarios): found & fixed four
    scheduler bug classes — season-blind legs, anchor/drive overlaps, past-midnight leg
    visits, out-of-season far stops; added `id` to entries.
18. **Multi-day drive split**: first the origin↔Medora case, then a **general
    per-segment rewrite** (segment walk + transit days + anti-cram exit). Stress harness
    now: 4,000 fuzz scenarios → 1 violation (a negligible season-rollover edge, §9).

For the fine-grained record, see the git log and `README.md`.
