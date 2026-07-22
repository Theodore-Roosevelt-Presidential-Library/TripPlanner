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
  `#092A4D`. Colors come from `data/config.json`. **Brand fonts** are the real
  trlibrary.com faces, loaded via `@font-face` from the Library's own server
  (`www.trlibrary.com/themes/custom/trpl/css/*.woff2`, which sends
  `Access-Control-Allow-Origin: *`, so they load cross-origin on the standalone demo
  too): **Clearface** (serif — titles/body), **Dharma Gothic E** (condensed uppercase —
  display/labels, Oswald kept only as a fallback), **Ginter/Inter** (UI sans). Don't
  redistribute the licensed woff2 into this repo — reference them from trlibrary.com.
  ⚠ **Dharma Gothic E is extremely condensed**, so it reads visually smaller than a
  normal face at the same `px` — its sizes are deliberately bumped up (+weight to 700/800)
  vs. what you'd use for Oswald/Inter (hero display 50px/800, stepper 12.5px/700, buttons
  15px/700, labels 12px/700). If you add a Dharma label, size it a notch larger than it
  "looks like it needs".

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
   subject (`Read` the image). **Preferred licensed image source: the Medora Area CVB
   media library** (`discovermedora.com/media-library`) — "free to use for promotional
   purposes that support the city of Medora; credit Medora Area CVB when possible." It's
   scenic/streetscape-level (great for a shared **3rd Ave** downtown-shop backdrop, town,
   trail-riding), **not** per-storefront. Record any non-obvious image's source in
   `assets/img/PROVENANCE.md` (FB-provided and CVB images are logged there).
4. **Verify with the jsdom harness after any logic/data change.** See §8. The app
   exposes `window.__TRTP` for headless testing. Historically, most "bugs" turned
   out to be bad test inputs — build realistic scenarios (air arrival, a nearby
   airport set, enough days).
5. **Respect the disclaimer.** This is explicitly *not a live booking system*. It
   works from curated data. Keep the "confirm with each venue" messaging intact.
6. **End every change** by: `node --check assets/trip-planner.js`, validate all
   `data/*.json` parse, run the relevant jsdom tests, then `present_files`.
7. **Keep it accessible (WCAG 2.1 AA / Section 508).** Every interactive element is a
   real `<button>` (never a click-only `<div>`); toggles carry `aria-pressed`, the
   stepper is a `<nav>` with `aria-current="step"`, the date input has a `<label>`,
   icon-only buttons have `aria-label`. Terracotta text on light uses the darkened
   `--tr-primary-text` (#B04E2F, ≥4.5:1) — the bright `--tr-primary` is for
   backgrounds/borders/on-navy only. `render()` preserves focus (via `data-fk`) so a
   re-render doesn't drop keyboard users; `goto()` moves focus to the step heading.
   Respect `prefers-reduced-motion`. Re-run the axe-core-in-jsdom scan after UI changes.

---

## 3. File map

```
index.html                     Demo/host page + Pages landing page
CNAME                          trip.labs.trlibrary.com
.gitignore                     ignores CI-generated status/report files + node_modules
assets/
  trip-planner.js              THE ENTIRE EMBED — ~1560 lines: state, steps, scheduler, render, CSS, print, iCal, permalink
  img/<md5>.jpg                133 locally-cached, resized photos
data/                          all curated content (edit these)
  config.json                  brand colors, comfort tiers, travel styles
  origins.json                 15 starting cities: coords, drive times, suggested routes
  airports.json               7 regional airports: coords, driveToMedoraMin/Miles, rental companies
  destinations.json            43 road-trip stops (parks, monuments, battlefields, towns, state parks, Dickinson day-trips)
  lodging.json                 20 lodging: Medora properties (tiered) + nearbyBase towns with hotels
  medora.json                  89 Medora items: see/do, recreation, tours, evening shows, dining, shopping, events
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
  pick bucket holds it (used by the over-capacity Remove buttons). **`resetAll()`** —
  a confirm-guarded "↺ Start over" (in the sidebar "Your Trip" header, shown once there's
  any progress) that wipes `S` to defaults and re-renders to step 0; `syncURL()` then
  resets the permalink to `#st=0`. The sidebar also shows a **✎ edit pencil** (`editBtn(step,label)`)
  next to each chosen detail (facts via `factRow`, pick sections via `pickSec(...,step)`)
  that jumps straight to the step that set it — origin→Coming from, dates/pace→Dates,
  airport/rental→Getting here, comfort→Stay, and each pick list→its own step.
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
- **Day-of-week is not Library-specific.** The same `avail.fixed[].days`/`dayOk`
  mechanism drives every item. Non-Library examples with real curated patterns: the
  **Teddy Roosevelt Show** (Mon 6:30pm dinner / Thu & Sat 9am brunch — two `fixed`
  windows), the **Gospel Brunch** (Tue/Wed/Fri/Sun 9am). The "evening show" rules are
  **time-aware** (`isEveningShow`): a show only counts as evening if its `fixed` window
  *that weekday* starts ≥17:00 — so a morning brunch show can share a day with the
  8pm Musical, and genuine time conflicts are still caught by `conflictsFixed`.
- **One evening show per night**; **no evening show on your departure day** (you're
  heading home/to the airport — you can't watch the 8pm Musical then drive 3h home);
  **Pitchfork Steak Fondue only on a Medora Musical day** (it's the pre-show dinner);
  **one breakfast/lunch/dinner per day** (Pitchfork counts as the dinner). Violations →
  `overflow`/notes with a clear reason.
- **Day-of-week availability is enforced.** `avail.fixed[].days` (0=Sun..6=Sat) and
  `avail.days` gate scheduling via `dayOk()`/`fixedWindowFor()` in `canPlace` — a tour
  that skips a weekday is never placed on it (→ overflow with "doesn't run on your
  travel days"). Verified by the stress harness's strict `wrong-weekday` invariant
  (0 across 4,000 dated scenarios). When the stay would collapse to a single day that
  falls on the pick's off-day, the Medora block **extends** (up to the guest's window)
  to include a weekday the pick actually runs, rather than dropping it. Without a set
  date, `fixedWindowFor(av,null)` returns the first window so items stay browsable
  (approximate — the "set a date" nudge covers this).
- **Meals are time-of-day aware.** Breakfast/lunch are assigned to a day with a free
  morning/midday (not one eaten by an arrival flight or long drive-in) so they schedule
  instead of dropping to a note. The `layoutDay` flex sort uses `ordOf()` (not
  `order[...]||2`) so breakfast's sort weight of 0 isn't clobbered to 2.
- **Real origin↔Medora drive times.** `segDrive()` uses each origin's curated
  `driveHours` (origins.json) for the origin↔Medora leg instead of haversine, so far
  drives aren't over-estimated (Chicago reads ~13.5h, not ~18h). `entry/exit.realToMedora`
  carries it; the exit drive uses `driveMinReal` end-to-end so the split decision and the
  rendered drive agree.
- **Library tours + admission co-locate** on one day. Admission = 4.5h (3.5h exhibits
  + 1h grounds); every specialty tour = 1h.
- **ALWAYS prioritize the Library.** General Admission is the anchor of the Library day
  and must never be crowded out. `layoutDay` places admission as a priority flex block
  (sort weight 0.5, right after breakfast) and **folds any same-day specialty tours INTO
  the admission block** ("· includes Badlands Landscape Tour at 11:30 am") instead of
  laying them out as separate fixed anchors — a tour happens *during* your admission
  visit, so it must not split the day and push the 4.5h admission into an "Also consider"
  note (the bug this fixed). If a picked tour genuinely can't run on any open Library day
  of the trip, it goes to `overflow` with a clear reason; admission still schedules.
- **Library seasonal hours + off-season closed days are real and enforced.** The Library
  is **closed Mondays** (spring & fall), **Mon+Tue** (winter), **daily in summer**, plus
  holiday closures — from `trlibrary.com/visit/hours`, curated in `library.json` as
  `hours:[{from:"MM-DD",to:"MM-DD",closed:[wd…],open,close}]` + `closedDates:["MM-DD"…]`.
  `libraryHours(date)` (a `Date`, not a string — that bit me once) returns `{open,close}`,
  `null` (closed), or `undefined` (unknown → fall back to the item's `avail`). `canPlace`
  blocks any `area:"library"` item on a closed date, the Library-day picker prefers open
  days, and `layoutDay` uses these hours for the admission window. Verified against the
  **live event calendar** (`trlibrary.com/calendar?date=YYYY-MM-DD` returns "0 activities"
  on closed days — e.g. Mon Oct 5 2026). Stress harness has a `library-on-closed-day`
  invariant (0 across 4,000 dated scenarios). ⚠ These hours are the one genuinely
  seasonal-with-closed-days schedule in the data — the generic single-`season` + `fixed`
  model can't express it, hence the dedicated `hours[]` tiers.
- **Meal windows** — breakfast before ~10:30, lunch ~12–14:00, dinner from 17:00;
  outside-window items become "Also consider" notes rather than mis-timed rows.
- **Over-capacity UI** — "Make it N days →" (bumps `S.days` to the required number),
  "Switch to Packed", "Edit dates", and per-overflow **Remove** buttons that
  recalculate in real time.
- **Headline & sidebar show the ACTUAL day count** (`sched.days.length`), not the
  day-bucket max the guest picked (S.days can be 12 for "8+ days" while the plan is 5).
- **"Also consider" = picks that didn't fit the timeline.** They're collected on
  `day.considerItems` (id+name) and rendered as **clickable chips** (tap → `removePick`);
  print shows them as text. They're already in the trip — the dine-around panel is where
  you *add* new ones.
- **Curated show/tour times are audited, not assumed.** The seed data shipped several
  wrong showtimes; a July-2026 audit against medora.com corrected them and they are now
  watched (see §7). Key facts: the **Great American Folk Show** is a **4:00 pm** show
  (not evening) and **T.R. – The Strenuous Life** is a **3:30 pm** matinee (not evening) —
  both encoded as afternoon `fixed` windows so `isEveningShow` correctly does NOT let them
  block the 8 pm Musical. **Bully Pulpit Golf** is **April–October** (season `[4,10]`),
  and **trail rides** run **7:30 am–sunset**. When adding/altering any show or tour, verify
  the real days/times/season against its medora.com listing — don't trust an existing value.
- **Full data audit (July 2026) beyond the shows.** Every schedule-bearing item was
  checked against source. Corrections that now live in the data: **festival months** —
  Dakota Nights Astronomy Festival is **August** (was Sept), Fall Fest is **late October
  only** (was Sept–Oct), Wine Walk is **early May only** (was May–June). **Dining
  day/hours** — Little Missouri Saloon is **year-round** (was seasonal), TR's Tavern is
  **3:30 pm–11 pm** daily, L'Amour Bistro is an **all-day** 6:30 am–8 pm spot (was
  dinner-only), and two eateries carry a closed-weekday via `avail.days`: **Theodore's**
  dinner (Sun/Thu/Fri/Sat) and **Uncork'd** (closed Monday). **Far-park seasonal road
  closures** now carry a `season` so they can't be built onto a winter leg:
  **Yellowstone `[5,10]`**, **Grand Teton `[5,10]`**, **Glacier `[6,10]`** (Going-to-the-
  Sun Rd), **Fort Lincoln `[5,9]`** (seasonal Custer House tours). Note: **Wind Cave and
  Jewel Cave stay year-round** — their tours run all winter, so don't "helpfully" add a
  caves=summer season. Shops close ~19:00 (not 18:00). When touching any of these, verify
  against the source — don't trust a seed value.
- **Time zones are surfaced.** Medora is on **Mountain Time**, and the Mountain/Central
  line runs just east of town, so guests cross it driving in (Dickinson/Bismarck/
  Williston/Fargo = Central; Rapid City/Billings/Denver = Mountain). Every location
  carries a `tz` (`MT|CT|PT`) — `origins.json`, `airports.json`, `destinations.json`;
  Medora itself is the `"MT"` constant in `buildSchedule`. The scheduler walks the
  ordered days by node tz and drops a "⏰ …set your clocks back/forward N hour(s)" note
  on the day the line is crossed (inbound and outbound), plus a trip-level `sched.tz.summary`
  rendered as a `.trtp-tz` callout on the schedule step and in the print facts. Special
  case: **TRNP's North Unit is in the Central zone** (NPS-documented) while the South Unit
  is Mountain — flagged when the North Unit is in the plan. iCal stays **floating-local**
  (no TZID) so exported wall-clock times read correctly across the line.
- **Daylight Saving Time is surfaced too** (same gain/lose framing). If a dated trip
  straddles a US DST change — **spring-forward** (2nd Sunday of March → lose an hour,
  clocks forward) or **fall-back** (1st Sunday of November → gain an hour, clocks back),
  computed per the day's year in `buildSchedule` (`nthSunday`/`dstOn`) — the crossing day
  gets a "🕑 Daylight Saving Time begins/ends today…" note and the `tz.summary` gains a
  matching line. ~1.5% of random dated trips hit one.
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
  doesn't touch: **link-rot** (every booking/info URL resolves), **show/tour schedule
  drift**, and **staleness**. It **never edits data** — it opens an issue for a human.
  This is the deliberate line: automation watches hours/seasons and flags drift; a
  person confirms and updates, keeping the "not a live booking system" promise honest.
  - **Schedule drift** (`checkSchedules` over `MONITORED_SCHEDULES`) re-fetches each
    monitored show/tour's medora.com listing and compares the **advertised season** to
    the curated `avail.season` (a readable mismatch is the only *hard* flag). It also
    scrapes the page's **advertised showtimes** (`extractShowTimes`) and prints them in
    the report so a human can eyeball them against the curated `avail.fixed` day/time
    windows every week — this is how a changed *time* (like the Folk Show moving, or the
    Strenuous Life being a 3:30 pm not an evening show) gets caught, since times are too
    noisy to auto-diff. `extractSeasonMonthsLoose` handles month-only ranges ("June -
    September"). Fetch/parse failures stay silent (keep-calm-on-outage) so a site outage
    never spams an issue. To monitor a new show/tour, add `{id,url,label}` to
    `MONITORED_SCHEDULES`. All extractors + `checkSchedules` (via an injectable fetcher)
    are exported and unit-tested.

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
19. **Launch-readiness pass**: accessibility (axe-clean, contrast, focus, ARIA — see
    golden rule 7), real-browser/mobile responsive tweaks, **GA4** analytics (optional
    `data-ga` on the script tag; anonymous funnel/action events via `track()`), Open
    Graph/Twitter meta on the host page, real per-origin drive times, morning-aware meal
    assignment (+ fixed a breakfast sort-weight bug), and no-evening-show-on-departure.
20. **Actual-day headline** + **clickable "Also consider" chips**; **time-aware evening
    rule** (`isEveningShow`) so morning/afternoon shows coexist with the 8 pm Musical.
21. **Schedule accuracy audit + watchdog**: audited every show/tour against medora.com
    and corrected real seed errors — the **Folk Show** (4 pm, was tagged evening 5–9),
    **T.R. – The Strenuous Life** (3:30 pm matinee, was evening), **Bully Pulpit** golf
    (April–Oct, was May), **trail rides** (7:30 am–sunset), plus verified TR Show/Gospel
    Brunch day patterns. Extended `check-data-freshness.mjs` with per-show `checkSchedules`
    (season-drift hard flag + advertised-showtime surfacing) over `MONITORED_SCHEDULES`,
    unit-tested and live-verified against the real site. 4,000-scenario harness: 0 new
    violations.
22. **Full data audit (all categories)**: parallel-researched every remaining
    schedule-bearing item against source — festivals (real 2026 dates → month fixes),
    Medora dining (year-round vs seasonal, closed-weekdays via `avail.days`, real hours),
    shops/recreation (close ~19:00, per-attraction hours), and far-park **seasonal road
    closures** (Yellowstone/Grand Teton/Glacier/Fort Lincoln now carry a `season`). ~45
    curated corrections applied programmatically; 4,000-scenario harness still clean (the
    lone flag is the pre-existing §9 season-rollover edge, now on Grand Teton). See §6.
23. **Medora CVB (discovermedora.com) integration.** (a) **Images** — the CVB **media
    library** is a licensed source ("free for promotional use, credit Medora Area CVB");
    pulled the **3rd Ave streetscape** to replace the generic placeholder shared by 9 shops
    and the **Little Missouri Saloon** exterior; two FB-provided dining photos (Bread+Butter,
    Farmhouse Cafe) cached earlier the same day. All logged in `assets/img/PROVENANCE.md`.
    (b) **Gap scan** — added **9 Medora items** (Billings County Courthouse Museum [Sat/Sun],
    Escape Medora, Dakota Cyclery, De Mores Memorial Park, West River Wagon Rides, Badlands
    Shooting Gallery, The White House, Lilly & Zella's, Bully Pulpit Pro Shop → 89 total) and
    **2 lodging** (AmericInn, Amble Inn → 20 total). (c) **Events source** — evaluated
    discovermedora.com/events as a 6th refresh source and **declined**: the `events` CPT
    isn't in the WP REST API and pages expose only a *publish* date, not the event date
    (would inject wrong dates); its big events already come through medora.com. 4,000-
    scenario harness after additions: only the pre-existing season-rollover edge. Some new
    items (Shooting Gallery, The White House) have approximate hours — flagged for the
    watchdog era, verify before launch.
24. **Library prioritization + real seasonal hours.** A reported itinerary (Oct, fall)
    dropped **General Admission** to "Also consider" because its 4.5h block couldn't fit
    around a same-day specialty tour on a day the Library is actually **closed** (Mondays
    in fall). Fixes: (a) `library.json` now carries the real `hours[]`/`closedDates` from
    trlibrary.com/visit/hours; `libraryHours(date)` gates `canPlace` so no Library item
    lands on a closed day, and the Library-day picker prefers open days; (b) `layoutDay`
    makes admission the priority anchor and **folds same-day tours into it** rather than
    letting them split the day. Result for the repro: admission schedules on the open
    Sunday, Monday is Library-free, and the Badlands Tour (runs Mon/Wed–Sat, only Monday
    falls in-block) overflows with a clear "Library closed that day" reason. Confirmed
    against the **live event calendar** (0 activities on Mon Oct 5 2026). Harness: new
    `library-on-closed-day` invariant, 0 across 4,000 dated scenarios.
25. **Time zones + brand fonts.** (a) **Time zones** — added a `tz` field to every
    location and a crossing detector in `buildSchedule`: Medora is Mountain, the MT/CT
    line is just east of town, so guests get clocks-forward/back notes on the crossing
    day + a `sched.tz.summary` callout (`.trtp-tz`) and print line; the North Unit's
    Central-zone quirk is called out. (b) **Fonts** — the embed now loads the real
    trlibrary.com brand faces (Clearface / Dharma Gothic E / Ginter-Inter) via `@font-face`
    from the Library's own server (confirmed `ACAO:*`, so cross-origin works), replacing
    the Oswald/Frutiger stand-ins; print + host page aligned. 3,000-scenario smoke: all
    build with a tz summary, 0 exceptions.

For the fine-grained record, see the git log and `README.md`.
