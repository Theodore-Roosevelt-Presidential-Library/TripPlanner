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
2. **Build your road trip** → 43 regional stops — national parks, monuments, battlefields, towns, state parks (regional stops become day trips), ordered by relationship to the Library (its Medora home anchors the trip, so proximity = how easily a stop pairs with a Library visit) lifted by a `popularity` score, so the closest and best-loved stops lead and carry a "★ Popular" tag
3. **Which months?** → the guest picks the month(s) they're considering; the next step is filtered to what's actually open then (the Musical, trail rides and many shops are summer-only)
4. **Your Medora day** → a deep catalog (60+ items) grouped into See & do, Outdoors & recreation, Guided tours & rides, Shows & evenings, Where to eat, Where to shop, and Festivals & special events — all season-filtered
5. **The Library** → general admission + the five specialty tours (each with its real days/times/price)
6. **Where are you coming from?** → starting point, drive time
7. **Getting here** → car, or fly in; **recommends the best fly-in/fly-out airports** for the chosen stops — proposing an open-jaw (into one airport, out of another) when it beats a round-trip and a rental serves both — with a one-click "Use these airports" and full manual override
8. **Dates & pace** → arrival date (enables day-of-week availability) + days + relaxed/balanced/packed
9. **Comfort level** → camping/RV → premium; the full Medora lodging list by tier + season
10. **Day-by-day schedule** → a dated, hour-by-hour plan → Print / save

The months step also feeds the scheduler: with no exact date set, seasonal
availability is still checked against the months being considered, so a
summer-only show won't land on a December plan.

### Efficient routing & a contiguous Medora stay

The scheduler routes the trip, it doesn't just drive to Medora and back each
day. Stops within ~110 miles fold into the Medora block as day trips; anything
farther becomes an **en-route leg** on the way in from (or out to) the airport,
ordered by geography, with an **overnight in a suggested gateway city** (e.g.
Yellowstone → Cody, Devils Tower → Sundance, Mount Rushmore → Keystone). The
time in Medora is kept as **one contiguous block** so the guest books a single
Medora hotel.

The schedule leads with a **"Where to book"** panel: how many nights in each
town and the check-in/out dates — the Medora nights and range front and center,
plus the gateway-city nights for each far leg.

Lodging only offers **Medora** stays to pick (far legs show the city to book,
not specific hotels). Because Medora fills up and gets pricey in summer, the
step also surfaces **nearby drive-in bases** — Belfield, Dickinson, Beach (ND)
and Glendive (MT) — flagged in summer; choosing one bases the Medora days there
with a short drive in, and the booking panel updates accordingly. A base town
and in-Medora stays are **mutually exclusive** (one base only), and picking a
base reveals **real hotels in that town** (with search links). Gateway cities
and drive-in bases live in `data/destinations.json` (`overnight`, `visitDays`)
and `data/lodging.json` (`nearbyBase`, `hotels`).

### Timing & scheduling guardrails

The scheduler won't build an impossible day. It never double-books overlapping
times, allows **only one evening show per night** (you can't do the Medora
Musical and the Teddy Roosevelt Show at once — the Pitchfork Fondue is treated
as the pre-show dinner, so it still pairs with the Musical), and flags the
overflow with a clear reason. **Library specialty tours + admission are grouped
onto a single day** so a guest doing several tours does them together. Each stop
shows **how long to spend there** (a `~1h 30m` pill) in both the schedule and
the printout.

**Meals respect real hours and meal windows.** A dining spot is only placed
inside its actual opening hours (a breakfast cafe that closes at 1 pm never
lands at 9 pm) and within a sensible meal window — breakfast in the morning,
lunch midday, dinner from 5 pm. There's **one breakfast, one lunch and one
dinner per day** (the Pitchfork Steak Fondue *is* your dinner, so nothing else
dinner-ish shares its night), which also spreads multiple dining picks across
days. Anything that can't fit its window becomes an **"Also consider"** note on
that day rather than being jammed in at a time the place is closed.

### Fix-it-here over-capacity controls

When your picks need more days than you've set, the over-capacity banner offers
**one-click fixes right there**: a **"Make it N days →"** button that bumps you
to the number of days the plan actually needs and re-lays it instantly, a
**Switch to Packed pace** button, and an **Edit dates** shortcut. The
"couldn't fit these" list gives every trimmed item a **Remove** button that
drops it and **recalculates in real time** — no bouncing back through the
wizard. When you have days to spare, a link offers to **tighten** to the days
you need.

### Shareable permalink

The entire wizard state — origin, airports, dates, days, pace, comfort, months
and every pick — lives in the **URL hash**, so any plan can be bookmarked or
shared. The **browser address bar updates automatically** as you go (via
`replaceState`, so it doesn't spam history) — so copying the URL straight from
the address bar works just as well as the **"Copy shareable link"** button on
the schedule step. Opening any such link restores the whole plan.

### Calendar export (.ics)

Once a real arrival date is set, the schedule step shows an **"Add to calendar
(.ics)"** button that downloads a standard iCalendar file — one event per
scheduled stop, ready to import into Apple Calendar, Google Calendar or Outlook.
Times are written as **floating local time** (no timezone), so each event shows
at its local clock time even on a trip that crosses into Mountain Time. The
button only appears with a date set, since undated events would be meaningless.

### Not a live booking system

Availability, showtimes and hours change, and the planner works from curated
data — not live inventory. A **prominent disclaimer** on the schedule step and
in the printout makes this explicit: it's a guide, and guests should **confirm
dates, times and hours directly with each location** before finalizing plans or
traveling. Every calendar event carries the same reminder in its notes.

If no arrival date is set, the schedule shows a prominent flag explaining that
tour/show availability is only exact with a date, and offers a **recommended
date** (the first Saturday of the chosen month) to apply in one click — which
re-lays the itinerary **in place on the schedule step** rather than jumping back
through the wizard.

Activity durations aim to be realistic: the **Library** is budgeted at 3.5 hours
for the exhibits plus an hour for the grounds and Boardwalk, and every
**specialty tour** runs an hour. Durations live in each item's `duration` field
(minutes) so they're easy to tune as real visit times are confirmed.

### Rental cars

Not every company has a counter at every airport, and people don't realize a
one-way (fly into one airport, out of another) needs a company at **both**. The
rental step now shows every relevant company but **greys out the ones that would
strand your car**, explains why, and **flags your current pick** if it stops
being valid. And there's genuinely **no rideshare or taxi in Medora** — the
copy says so plainly; a rental car is essential.

### Directions & addresses

Every scheduled stop carries an **address** and a **Directions** link (Google
Maps) in both the on-screen schedule and the printout, so guests can route by
GPS. Big multi-entrance parks point at the **right entrance** — e.g. Yellowstone
resolves to its **East Entrance** (the one you reach from Cody), not the park
centroid. **Every Medora item now has an address** (real street where known,
e.g. L'Amour Bistro at 215 4th St; otherwise "<name>, Medora, ND 58645"), and
**NPS trail stops carry their trailhead coordinates** (`gps: true` + `lat`/`lng`)
so "Directions" drops you at the trailhead — not the park centroid or a visitor
center. Addresses live in each item's `address` field; when an item is marked
`gps: true`, the link prefers its exact coordinates over the street address.

### How many days you'll need

The Dates step estimates the days your current picks actually require (the same
routing math the schedule uses) and compares it to what you've set — telling you
to add days if you're over, or that you have room to add more if you're under.

### Fitting the day budget

The schedule respects the number of days the guest set. If the picks need more
days than that, it **trims the farthest stops** (and, if needed, shrinks the
Medora block), then shows an **over-capacity banner** explaining what didn't fit
and how to fix it — add days, drop specific far stops, trim Medora activities,
or switch to a Packed pace. Change the day count and the plan re-fits
immediately. If there's spare capacity, it nudges the guest to add more.

Advancing, going back, or jumping via the stepper **scrolls the widget back to
the top**, and the weather block keys off the **actual trip dates** when set
(the month[s] the trip spans, labeled with the date range) rather than a broad
month range.

The schedule includes **getting-to-Medora travel**: the drive from the origin
(or flight arrival + airport-to-Medora drive) is built into day 1, and the
return drive/flight into the last day, so the plan reflects real travel time.
Flight arrivals build in **90 minutes to deplane, collect luggage and pick up
the rental car** before the drive begins, and the return drive reminds the
guest to arrive ~2 hours early for the flight.

**Drive-time estimates** are deliberately generous so nobody feels rushed. Road
distance is estimated from coordinates (with a straight-line→road correction),
converted to time at a blended ~53 mph door-to-door speed (below the limit, to
cover towns, grades and a stop), and rounded to the nearest 15 minutes with a
small buffer. They're calibrated against known drives — Dickinson→Devils Tower
(~3h50) shows about 4h, Dickinson→Medora (~40m) shows ~45m.

There's also a **departure-airport sanity check**: when a trip ends in Medora
with no outbound stops, the plan won't send the guest on a needless multi-hour
drive to a distant fly-out airport (e.g. a Medora-ending trip departing from
Billings 5h away). If the chosen return airport is more than ~90 minutes farther
from Medora than the nearest one, the schedule reroutes the departure to the
nearest airport and surfaces a flag explaining the switch — the guest can still
override it on the Getting-here step.

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

### Weather & packing

The schedule (and printout) includes a **typical weather & what-to-pack** block
tailored to the guest's month(s): average high/low and conditions for each
selected month, plus a season-specific packing list and "prepare for" notes
(summer sun and pop-up thunderstorms, cold nights at the outdoor Musical, muddy
spring trails, icy winter roads and off-season closures). A one-line teaser also
appears on the Season step. Climate norms live in `data/weather.json`.

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

## Dine around & shop local

The Medora catalog includes the independent restaurants and shops from the
Chamber / VisitMedora directory — Medora Uncork'd (wine bar), Hidden Springs
Java, L'Amour Bistro (in the old Cowboy Cafe space), Bread + Butter, Hatlee +
Brae, plus shops like Medora Boot & Western Wear, JQ Clothing, Bar Diamond Bar
Gallery, Chasing Horses, Chateau Nuts and Rushmore Mountain Taffy. The generic
"Downtown Medora Shops" catch-all was removed in favor of the real businesses.

The finished schedule has a **"Dine around & shop local"** panel: unpicked,
in-season restaurants and shops as one-tap chips that add straight into the plan
— nudging guests to try a different spot each meal and browse the shops.

Image note: a few small independents publish photos only on Facebook (not
fetchable server-side), so they share a real Medora main-street photo; the
marquee spots (Joe Ferris, Uncork'd, L'Amour, Boot & Western Wear, Chateau Nuts)
have their own real photos, and a few use their brand logos.

## Dickinson support

Dickinson (40 minutes east, and one of the drive-in base towns) is a first-class
part of the planner. Twelve real Dickinson attractions — the Dickinson Museum
Center / Badlands dinosaur hall, Dakota Dinosaur Museum, Ukrainian Cultural
Institute, Theodore Roosevelt Center at DSU, Patterson Lake, Crooked Crane Trail,
West River Community Center, Heart River Golf, Phat Fish Brewing, Fluffy Fields
Winery and more — are selectable on the Road-trip step (they're ≤110 mi, so they
fold into the Medora block as day trips), each with a cached photo. A note there
points to **VisitDickinson**, and choosing Dickinson as your base surfaces its
hotels plus links to VisitDickinson's things-to-do and events pages.
VisitDickinson events feed the "Happening while you're here" section and the
calendar-links list. (VisitDickinson's calendar is JavaScript-rendered with no
feed, so the auto-refresh keeps a curated seed for it — pulling it live would
need a headless browser in the Action; noted in `scripts/refresh-events.mjs`.)

## The data pipeline (GitHub Actions)

Two scheduled Actions keep the time-sensitive data honest. Both run **weekly**
(Monday mornings) and are resilient by design — a broken source never breaks the
site, and problems are never silent.

### 1. Event refresh — `refresh-events.yml` → `scripts/refresh-events.mjs`

`data/events.json` is **auto-generated** — don't hand-edit it. Each week the
Action:

1. Fetches each source: **medora.com/calendar** (Modern Events Calendar),
   the **ND Cowboy Hall of Fame**, the **NPS calendar**, the **Medora Chamber**,
   and **VisitDickinson**.
2. Parses events per source — schema.org `Event` (JSON-LD) where available, plus
   **site-specific parsers** for the Medora MEC calendar and the Saffire
   (VisitDickinson) layout. The two JavaScript-rendered sources are rendered with
   **Playwright (headless Chromium)** in CI so they pull live; if Playwright is
   unavailable it falls back to a static fetch.
3. **Retries with backoff** on 429/5xx/timeouts, **validates** every event
   (real calendar dates, non-empty titles) and drops junk, keeps current/upcoming
   events (out to ~13 months), and writes `events.json`.
4. If a source errors or yields nothing, its **previous events are preserved** —
   one broken scrape never empties the planner — and the run is flagged.
5. Commits the file if it changed; the deploy workflow republishes.
6. **Fails loudly:** if any source needed attention, the Action opens (or updates)
   a GitHub issue titled *"⚠ Event refresh needs attention"* with a per-source
   summary, so a silently-rotting scraper gets noticed.

### 2. Freshness watchdog — `check-data.yml` → `scripts/check-data-freshness.mjs`

The refresher only touches *events*. The curated data it doesn't touch (hours,
show seasons, booking links) is watched separately. Each week this job:

- **Link-rot:** requests every booking/info URL in the data and reports any that
  no longer return a live page.
- **Season drift:** reads the Medora Musical's advertised season from medora.com
  and flags it if the months no longer match `data/medora.json` (these change
  every year — the Musical, Pitchfork Fondue and TR Show `season`/`fixed` blocks).
- **Staleness:** flags if `events.json` hasn't refreshed in over three weeks.

It **never edits data** — it writes `data/freshness-report.md` and, if anything
looks off, opens/updates an issue for a human to confirm and update. This is the
deliberate line: automation *watches* the hours/seasons and tells us when to
look, but a person makes the change, keeping the "not a live booking system"
promise honest.

Run either on demand from **Actions → Run workflow**, or locally with
`node scripts/refresh-events.mjs` / `node scripts/check-data-freshness.mjs`.
The pure parser/validation helpers are exported and unit-tested.

---

## One-time GitHub setup

1. **Settings → Pages →** Source = *GitHub Actions*.
2. **Settings → Pages →** Custom domain = `trip.labs.trlibrary.com` (the `CNAME`
   file is already committed); the DNS `CNAME` record should point at
   `theodore-roosevelt-presidential-library.github.io`. Enable *Enforce HTTPS*.
3. **Settings → Actions → General →** Workflow permissions = *Read and write*
   (so the event refresh can commit and the watchdogs can open issues).

---

## Images

Every activity card shows a photo so guests can see what they're committing to;
the photo also appears as a thumbnail in the schedule and the printed itinerary.

Photos are **cached locally** in `assets/img/` and served from our own domain —
we never hotlink other sites' servers. Each item's `image` field is a local path
(e.g. `assets/img/<hash>.jpg`); the embed resolves it against the script's origin
so it works when embedded on trlibrary.com.

Sources are a mix of the official sites (medora.com for lodging/dining/activities,
the NPS for park trails, the Library's own gallery for tours) and **Wikimedia
Commons / Wikipedia** lead images for parks, monuments and towns (chosen to be
iconic and unique per place). **Every item has an image** (112/112). A few small
downtown shops with no available photo share a downtown-Medora image, and a
couple of same-place items (the two NPS campgrounds, the two Painted Canyon
entries) share one photo by design.

To add or refresh a photo: set an item's `image` to a remote URL, then run

    python3 scripts/cache-images.py    # downloads, resizes, repoints to local

**Attribution note:** the Wikimedia/Commons photos are freely licensed but most
carry a CC-BY / CC-BY-SA requirement to credit the photographer. Before public
launch, add a credits page (or per-image `credit` field) listing the source and
license for the Commons images. The official medora.com / NPS / Library images
are used to promote those partners.

## Design notes

The planner mirrors the trlibrary.com look: badlands terracotta (`#E7805D`),
deep navy (`#092A4D`), a warm paper background, Clearface-style serif headings
and Oswald (a close, freely-hosted stand-in for the site's Dharma Gothic display
face). Styles are scoped to the embed container so they won't leak into or
inherit unexpectedly from the host page.
