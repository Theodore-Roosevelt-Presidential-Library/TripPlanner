/*!
 * TR Library Trip Planner — a single-file embeddable, rule-based trip builder.
 * Embed with:  <script src="https://<org>.github.io/TripPlanner/assets/trip-planner.js"
 *                      data-container="tr-trip-planner"></script>
 *              <div id="tr-trip-planner"></div>
 *
 * No build step, no dependencies, no API keys. All data lives in ../data/*.json
 * relative to this script and is loaded at runtime. Time-sensitive events are
 * refreshed into data/events.json by a scheduled GitHub Action.
 */
(function () {
  "use strict";

  // ---- Locate this script + derive the base URL for data + config --------
  var THIS = document.currentScript ||
    (function () { var s = document.getElementsByTagName("script"); return s[s.length - 1]; })();
  var BASE = THIS.src.replace(/assets\/trip-planner\.js.*$/, "");
  var CONTAINER_ID = THIS.getAttribute("data-container") || "tr-trip-planner";
  var DATA = BASE + "data/";

  // ---- Small helpers ------------------------------------------------------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function money(n) { return "$".repeat(n); }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }

  // ---- Runtime state ------------------------------------------------------
  var S = {
    step: 0,
    origin: null,        // origin object
    days: null,          // integer
    arrival: null,       // 'car' | 'air'
    airport: null,       // airport code
    rental: null,        // rental company
    styles: [],          // travel style ids
    tier: null,          // comfort tier id
    picks: {             // the itinerary being built (arrays of ids)
      route: [],         // destination ids
      lodging: [],       // lodging ids
      medora: [],        // medora attraction ids
      library: []        // library option ids
    }
  };
  var D = {};            // loaded data
  var STEPS = [];        // step definitions, filled after data loads

  // ---- Styling (scrapbook aesthetic, matches trlibrary.com tokens) --------
  function injectCSS(c) {
    if (document.getElementById("trtp-style")) return;
    var css = `
    @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&display=swap');
    #${CONTAINER_ID}{--tr-primary:${c.primary};--tr-secondary:${c.secondary};--tr-muted:${c.muted};--tr-paper:${c.paper};--tr-ink:${c.ink};
      color:var(--tr-ink);background:var(--tr-paper);border-radius:6px;overflow:hidden;
      font-family:Frutiger,'Helvetica Neue',Arial,sans-serif;line-height:1.5;position:relative;
      box-shadow:0 1px 0 rgba(0,0,0,.04);}
    #${CONTAINER_ID} *{box-sizing:border-box;}
    .trtp-wrap{display:grid;grid-template-columns:1fr 340px;gap:0;min-height:560px;}
    @media(max-width:820px){.trtp-wrap{grid-template-columns:1fr;}}
    .trtp-main{padding:28px 30px 34px;}
    .trtp-side{background:var(--tr-secondary);color:#fff;padding:24px 22px;position:relative;}
    @media(max-width:820px){.trtp-side{order:2;}}
    .trtp-kicker{font-family:Oswald,'Dharma Gothic E',sans-serif;text-transform:uppercase;letter-spacing:.14em;
      font-size:12px;color:var(--tr-primary);font-weight:600;margin:0 0 6px;}
    .trtp-h{font-family:'Clearface',Georgia,serif;font-weight:600;color:var(--tr-secondary);
      font-size:30px;line-height:1.08;margin:0 0 8px;}
    .trtp-h.display{font-family:Oswald,'Dharma Gothic E',sans-serif;text-transform:uppercase;letter-spacing:.02em;
      font-weight:700;font-size:38px;}
    .trtp-sub{font-size:15px;color:#4a4d50;margin:0 0 22px;max-width:56ch;}
    .trtp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px;margin:6px 0 4px;}
    .trtp-grid.wide{grid-template-columns:repeat(auto-fill,minmax(250px,1fr));}
    .trtp-card{background:#fff;border:1px solid #e4ddcd;border-radius:5px;padding:15px 16px;cursor:pointer;
      text-align:left;transition:transform .12s ease,box-shadow .12s ease,border-color .12s;position:relative;font:inherit;color:inherit;}
    .trtp-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(9,42,77,.10);border-color:var(--tr-muted);}
    .trtp-card.sel{border-color:var(--tr-primary);box-shadow:0 0 0 2px var(--tr-primary) inset;}
    .trtp-card .t{font-family:'Clearface',Georgia,serif;font-weight:600;font-size:16px;color:var(--tr-secondary);
      margin:0 0 3px;display:flex;align-items:center;gap:6px;}
    .trtp-card .b{font-size:13px;color:#5c5f62;margin:0;}
    .trtp-card .meta{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:10.5px;
      color:var(--tr-primary);margin-top:8px;font-weight:600;}
    .trtp-card .check{position:absolute;top:10px;right:10px;width:20px;height:20px;border-radius:50%;
      background:var(--tr-primary);color:#fff;display:none;align-items:center;justify-content:center;font-size:12px;}
    .trtp-card.sel .check{display:flex;}
    .trtp-tag{display:inline-block;background:#f0e9d8;border:1px solid #e4ddcd;border-radius:20px;padding:3px 10px;
      font-size:11px;color:#6a5a3f;margin:0 5px 5px 0;font-family:Oswald,sans-serif;letter-spacing:.04em;}
    .trtp-nav{display:flex;justify-content:space-between;align-items:center;margin-top:26px;gap:12px;flex-wrap:wrap;}
    .trtp-btn{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-weight:600;font-size:13px;
      border:none;border-radius:3px;padding:12px 22px;cursor:pointer;transition:filter .12s,transform .12s;}
    .trtp-btn:hover{filter:brightness(1.05);transform:translateY(-1px);}
    .trtp-btn.primary{background:var(--tr-primary);color:#25282a;}
    .trtp-btn.ghost{background:transparent;color:var(--tr-secondary);border:1px solid var(--tr-muted);}
    .trtp-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;}
    .trtp-progress{display:flex;gap:6px;margin-bottom:22px;flex-wrap:wrap;}
    .trtp-dot{height:5px;flex:1;min-width:16px;border-radius:3px;background:#e4ddcd;}
    .trtp-dot.on{background:var(--tr-primary);}
    .trtp-dot.done{background:var(--tr-secondary);}
    .trtp-side h3{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.12em;font-size:13px;
      color:var(--tr-primary);margin:0 0 4px;font-weight:600;}
    .trtp-side .trip-name{font-family:'Clearface',Georgia,serif;font-size:22px;font-weight:600;margin:0 0 14px;color:#fff;}
    .trtp-side .empty{color:#9fb3cc;font-size:13.5px;font-style:italic;}
    .trtp-sec{margin-bottom:16px;}
    .trtp-sec .lbl{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.1em;font-size:10.5px;color:#9fb3cc;margin:0 0 6px;}
    .trtp-item{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;font-size:13.5px;
      padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.14);}
    .trtp-item .x{background:none;border:none;color:#9fb3cc;cursor:pointer;font-size:15px;line-height:1;padding:0 2px;}
    .trtp-item .x:hover{color:#fff;}
    .trtp-side .fact{font-size:13px;color:#cdd8e6;margin:2px 0;}
    .trtp-side .fact b{color:#fff;font-weight:600;}
    .trtp-cta{display:block;text-align:center;background:var(--tr-primary);color:#25282a !important;text-decoration:none;
      font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-weight:600;font-size:13px;
      padding:12px;border-radius:3px;margin-top:16px;}
    .trtp-note{background:#fff;border-left:3px solid var(--tr-primary);padding:10px 14px;font-size:13.5px;color:#5c5f62;
      border-radius:0 4px 4px 0;margin:14px 0;}
    .trtp-loading{padding:60px 30px;text-align:center;color:var(--tr-secondary);font-family:'Clearface',Georgia,serif;font-size:20px;}
    .trtp-sub-h{font-family:'Clearface',Georgia,serif;font-weight:600;font-size:18px;color:var(--tr-secondary);margin:22px 0 8px;}
    .trtp-summary-day{background:#fff;border:1px solid #e4ddcd;border-radius:5px;padding:16px 18px;margin:0 0 12px;}
    .trtp-summary-day h4{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--tr-primary);margin:0 0 8px;font-size:14px;}
    .trtp-summary-day ul{margin:0;padding-left:18px;}
    .trtp-summary-day li{font-size:14px;margin:4px 0;color:var(--tr-ink);}
    .trtp-print{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;}
    @media print{.trtp-side,.trtp-nav,.trtp-progress{display:none !important;}.trtp-wrap{grid-template-columns:1fr;}}
    `;
    document.head.appendChild(el("style", { id: "trtp-style", html: css }));
  }

  // ---- Boot ---------------------------------------------------------------
  function boot() {
    var host = document.getElementById(CONTAINER_ID);
    if (!host) { console.warn("[TRTP] container #" + CONTAINER_ID + " not found"); return; }
    host.innerHTML = '<div class="trtp-loading">Saddling up your trip planner…</div>';
    var files = ["config", "origins", "airports", "destinations", "lodging", "medora", "itineraries", "library", "events"];
    Promise.all(files.map(function (f) {
      return fetch(DATA + f + ".json").then(function (r) { return r.json(); });
    })).then(function (res) {
      files.forEach(function (f, i) { D[f] = res[i]; });
      injectCSS(D.config.brand.colors);
      defineSteps();
      render();
    }).catch(function (err) {
      host.innerHTML = '<div class="trtp-loading">The trip planner could not load its data. Please refresh.</div>';
      console.error("[TRTP] data load failed", err);
    });
  }

  // ---- Derived helpers ----------------------------------------------------
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function airport(code) { var a = D.airports.airports; for (var i = 0; i < a.length; i++) if (a[i].code === code) return a[i]; return null; }
  function matchesStyle(tags) { return !S.styles.length || S.styles.some(function (s) { return tags && tags.indexOf(s) > -1; }); }

  function toggle(bucket, id) {
    var arr = S.picks[bucket];
    var i = arr.indexOf(id);
    if (i > -1) arr.splice(i, 1); else arr.push(id);
    render();
  }
  function isPicked(bucket, id) { return S.picks[bucket].indexOf(id) > -1; }

  function suggestedItinerary() {
    if (!S.origin) return null;
    var list = D.itineraries.itineraries;
    // Prefer an origin-suggested route that fits within the day budget.
    var pool = (S.origin.suggestedItineraries || []).map(function (id) { return byId(list, id); }).filter(Boolean);
    var fit = pool.filter(function (it) { return !S.days || it.days <= S.days + 1; });
    return (fit[0] || pool[0] || null);
  }

  // ---- Render root --------------------------------------------------------
  function render() {
    var host = document.getElementById(CONTAINER_ID);
    var wrap = el("div", { class: "trtp-wrap" });
    var main = el("div", { class: "trtp-main" });

    // progress dots
    var prog = el("div", { class: "trtp-progress" });
    STEPS.forEach(function (_, i) {
      prog.appendChild(el("div", { class: "trtp-dot " + (i === S.step ? "on" : i < S.step ? "done" : "") }));
    });
    main.appendChild(prog);

    STEPS[S.step].render(main);

    // nav
    var nav = el("div", { class: "trtp-nav" });
    var back = el("button", { class: "trtp-btn ghost", onclick: function () { if (S.step > 0) { S.step--; render(); } } }, ["← Back"]);
    if (S.step === 0) back.style.visibility = "hidden";
    var nextOk = STEPS[S.step].canAdvance ? STEPS[S.step].canAdvance() : true;
    var isLast = S.step === STEPS.length - 1;
    var next = el("button", {
      class: "trtp-btn primary", disabled: nextOk ? null : "disabled",
      onclick: function () { if (isLast) { window.print(); } else { S.step++; render(); } }
    }, [isLast ? "Print / Save my trip" : (STEPS[S.step].nextLabel || "Continue →")]);
    nav.appendChild(back); nav.appendChild(next);
    main.appendChild(nav);

    wrap.appendChild(main);
    wrap.appendChild(renderSidebar());
    host.innerHTML = "";
    host.appendChild(wrap);
  }

  // ---- Sidebar: the itinerary being built --------------------------------
  function renderSidebar() {
    var side = el("div", { class: "trtp-side" });
    side.appendChild(el("h3", { text: "Your Trip" }));
    var name = S.days ? (S.days + "-Day Roosevelt Country Trip") : "Roosevelt Country Trip";
    side.appendChild(el("div", { class: "trip-name", text: name }));

    // quick facts
    if (S.origin) {
      var f = el("div", { class: "trtp-sec" });
      f.appendChild(el("div", { class: "fact", html: "<b>From:</b> " + S.origin.label }));
      if (S.arrival) f.appendChild(el("div", { class: "fact", html: "<b>Arriving by:</b> " + (S.arrival === "air" ? "air" : "car") }));
      if (S.airport) f.appendChild(el("div", { class: "fact", html: "<b>Airport:</b> " + S.airport + " – " + airport(S.airport).driveToMedoraMin + " min to Medora" }));
      if (S.rental) f.appendChild(el("div", { class: "fact", html: "<b>Rental:</b> " + S.rental }));
      if (S.tier) f.appendChild(el("div", { class: "fact", html: "<b>Comfort:</b> " + byId(D.config.comfortTiers, S.tier).label }));
      side.appendChild(f);
    }

    var any = false;
    any = renderPickSection(side, "Road-trip stops", "route", D.destinations.destinations) || any;
    any = renderPickSection(side, "Where you'll stay", "lodging", D.lodging.lodging) || any;
    any = renderPickSection(side, "Your Medora day", "medora", D.medora.attractions) || any;
    any = renderPickSection(side, "At the Library", "library", D.library.options) || any;

    if (!any && !S.origin) side.appendChild(el("div", { class: "empty", text: "Answer a few questions and start clicking things you like — they'll collect here into a plan you can print." }));

    side.appendChild(el("a", { class: "trtp-cta", href: D.library.ticketsUrl, target: "_blank", rel: "noopener" }, ["Book your Library visit"]));
    return side;
  }
  function renderPickSection(side, label, bucket, source) {
    var ids = S.picks[bucket];
    if (!ids.length) return false;
    var sec = el("div", { class: "trtp-sec" });
    sec.appendChild(el("div", { class: "lbl", text: label }));
    ids.forEach(function (id) {
      var item = byId(source, id); if (!item) return;
      var row = el("div", { class: "trtp-item" });
      row.appendChild(el("span", { text: item.name }));
      row.appendChild(el("button", { class: "x", title: "Remove", onclick: function () { toggle(bucket, id); } }, ["×"]));
      sec.appendChild(row);
    });
    side.appendChild(sec);
    return true;
  }

  // ---- Reusable card grid -------------------------------------------------
  function cardGrid(main, items, opts) {
    var grid = el("div", { class: "trtp-grid" + (opts.wide ? " wide" : "") });
    items.forEach(function (it) {
      var selected = opts.selected ? opts.selected(it) : false;
      var card = el("button", {
        class: "trtp-card" + (selected ? " sel" : ""), type: "button",
        onclick: function () { opts.onclick(it); }
      }, [
        el("span", { class: "check", html: "✓" }),
        el("div", { class: "t", text: it[opts.title || "name"] }),
        opts.blurb ? el("div", { class: "b", text: (typeof opts.blurb === "function" ? opts.blurb(it) : it[opts.blurb]) }) : null,
        opts.meta ? el("div", { class: "meta", text: opts.meta(it) }) : null
      ]);
      grid.appendChild(card);
    });
    main.appendChild(grid);
    return grid;
  }

  // ---- Step definitions ---------------------------------------------------
  function defineSteps() {
    STEPS = [
      // 0. Welcome + origin
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Plan your visit" }));
          m.appendChild(el("h1", { class: "trtp-h display", text: "Build your Roosevelt Country trip" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "The Library sits in the middle of the best road-trip country in America. Answer a few questions and click what appeals — we'll assemble a plan you can print and book. First: where are you starting from?" }));
          cardGrid(m, D.origins.origins, {
            title: "label", selected: function (o) { return S.origin && S.origin.id === o.id; },
            meta: function (o) { return o.driveHours ? o.driveHours + " hrs · " + o.distanceMiles + " mi" : "Flying in"; },
            onclick: function (o) { S.origin = o; S.airport = o.nearestAirport; if (o.arrival !== "either") S.arrival = o.arrival; render(); }
          });
        },
        canAdvance: function () { return !!S.origin; },
        nextLabel: "Continue →"
      },

      // 1. Days
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Time" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "How many days do you have?" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "A visit works as a day, a weekend, or the anchor of something much bigger. This shapes how far afield we'll suggest you roam." }));
          var opts = [
            { d: 1, label: "A day or less", note: "The Library + the South Unit loop" },
            { d: 3, label: "A weekend (2–3 days)", note: "Medora, properly" },
            { d: 6, label: "About a week (4–7 days)", note: "Add the Black Hills or the River Road" },
            { d: 12, label: "The big one (8+ days)", note: "String together several national parks" }
          ];
          cardGrid(m, opts, {
            title: "label", selected: function (o) { return S.days === o.d; },
            blurb: function (o) { return o.note; },
            onclick: function (o) { S.days = o.d; render(); }
          });
          var sug = suggestedItinerary();
          if (sug) m.appendChild(el("div", { class: "trtp-note", html: "Based on your start and time, a great backbone is <b>" + sug.title + "</b> — " + sug.blurb + " <a href='" + sug.url + "' target='_blank' rel='noopener'>See it ↗</a>" }));
        },
        canAdvance: function () { return !!S.days; }
      },

      // 2. Getting here
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Getting here" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "How will you get to Medora?" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "Medora is closer than most people think. Pick how you're arriving — we'll sort out the airport and rental car if you're flying." }));
          cardGrid(m, [
            { id: "car", name: "Driving", note: S.origin && S.origin.driveHours ? ("About " + S.origin.driveHours + " hours from " + S.origin.label) : "Your own vehicle, all the flexibility" },
            { id: "air", name: "Flying + rental car", note: "Fly into a regional airport, drive the rest" }
          ], {
            selected: function (o) { return S.arrival === o.id; }, blurb: function (o) { return o.note; },
            onclick: function (o) { S.arrival = o.id; render(); }
          });

          if (S.arrival === "air") {
            m.appendChild(el("div", { class: "trtp-sub-h", text: "Choose your airport" }));
            var aps = D.airports.airports.slice().sort(function (a, b) { return a.driveToMedoraMin - b.driveToMedoraMin; });
            cardGrid(m, aps, {
              wide: true, selected: function (a) { return S.airport === a.code; },
              blurb: function (a) { return a.note; },
              meta: function (a) { return a.code + " · " + a.driveToMedoraMin + " min / " + a.driveToMedoraMiles + " mi to Medora"; },
              onclick: function (a) { S.airport = a.code; if (S.rental && airport(a.code).rentalCars.indexOf(S.rental) < 0) S.rental = null; render(); }
            });

            if (S.airport) {
              var ap = airport(S.airport);
              m.appendChild(el("div", { class: "trtp-sub-h", text: "Rental cars at " + ap.code }));
              cardGrid(m, ap.rentalCars.map(function (n) { return { id: n, name: n }; }), {
                selected: function (r) { return S.rental === r.id; },
                blurb: function () { return "Available at " + ap.city; },
                onclick: function (r) { S.rental = r.id; render(); }
              });
              m.appendChild(el("div", { class: "trtp-note", html: "Heads up: rideshare is limited in Medora, so a rental car is the way to explore the Badlands. <a href='" + D.config.brand.directionsUrl + "' target='_blank' rel='noopener'>Full directions ↗</a>" }));
            }
          }
        },
        canAdvance: function () { return S.arrival === "car" || (S.arrival === "air" && !!S.airport); }
      },

      // 3. Travel style
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Your kind of trip" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "What are you here for?" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "Pick anything that sounds like you (choose as many as you want). We'll use it to highlight the best stops for your road trip." }));
          cardGrid(m, D.config.travelStyles, {
            title: "label", selected: function (s) { return S.styles.indexOf(s.id) > -1; },
            onclick: function (s) { var i = S.styles.indexOf(s.id); if (i > -1) S.styles.splice(i, 1); else S.styles.push(s.id); render(); }
          });
        },
        canAdvance: function () { return true; }, nextLabel: "Build my road trip →"
      },

      // 4. Road trip builder
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "The ultimate road trip" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Add stops along the way" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "National parks, monuments, great Western towns and state parks within reach of Medora. Click to add them to your trip — they'll collect in the panel on the right." }));
          var items = D.destinations.destinations.filter(function (d) { return d.id.indexOf("trnp-south") < 0; });
          items = items.filter(function (d) { return matchesStyle(d.tags); });
          items.sort(function (a, b) { return a.milesFromMedora - b.milesFromMedora; });
          var typeLabel = { national_park: "National Park", national_monument: "National Monument", state_park: "State Park", town: "Western Town", cultural: "History & Culture", scenic: "Scenic" };
          cardGrid(m, items, {
            wide: true, selected: function (d) { return isPicked("route", d.id); },
            blurb: function (d) { return d.blurb; },
            meta: function (d) { return typeLabel[d.type] + " · " + (d.milesFromMedora <= 1 ? "in Medora" : d.milesFromMedora + " mi · ~" + d.dwell + "h"); },
            onclick: function (d) { toggle("route", d.id); }
          });
        },
        canAdvance: function () { return true; }
      },

      // 5. Lodging / comfort
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Where you'll stay" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Pick your level of comfort" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "From a tent under the stars to the restored Rough Riders Hotel. Choose a comfort level and we'll show the right stays." }));
          cardGrid(m, D.config.comfortTiers, {
            title: "label", selected: function (t) { return S.tier === t.id; },
            blurb: function (t) { return t.blurb; }, meta: function (t) { return t.priceHint; },
            onclick: function (t) { S.tier = t.id; render(); }
          });
          if (S.tier) {
            var stays = D.lodging.lodging.filter(function (l) { return l.tier === S.tier; });
            m.appendChild(el("div", { class: "trtp-sub-h", text: S.tier === "camp" ? "Camping & RV options" : "Places to stay" }));
            cardGrid(m, stays, {
              wide: true, selected: function (l) { return isPicked("lodging", l.id); },
              blurb: function (l) { return l.blurb; }, meta: function (l) { return l.area; },
              onclick: function (l) { toggle("lodging", l.id); }
            });
          }
        },
        canAdvance: function () { return !!S.tier; }, nextLabel: "Plan my Medora day →"
      },

      // 6. Medora day builder
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Your day in Medora" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Build your Medora day" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "The Badlands that shaped Roosevelt, the Library above them, and a town that still runs on Western hospitality. Click what you want to do, see, eat and shop." }));
          var groups = [
            { key: "attraction", label: "See & do" },
            { key: "evening", label: "Evenings & entertainment" },
            { key: "dining", label: "Where to eat" },
            { key: "shopping", label: "Where to shop" }
          ];
          groups.forEach(function (g) {
            var items = D.medora.attractions.filter(function (a) { return a.category === g.key; });
            if (!items.length) return;
            m.appendChild(el("div", { class: "trtp-sub-h", text: g.label }));
            cardGrid(m, items, {
              wide: g.key !== "shopping" && g.key !== "dining",
              selected: function (a) { return isPicked("medora", a.id); },
              blurb: function (a) { return a.blurb; },
              meta: function (a) { return (a.featured ? "★ Popular · " : "") + "~" + a.dwell + "h"; },
              onclick: function (a) { toggle("medora", a.id); }
            });
          });
          // live events
          var evs = (D.events.events || []);
          if (evs.length) {
            m.appendChild(el("div", { class: "trtp-sub-h", text: "Happening while you're here" }));
            var note = el("div", { class: "trtp-note", html: "" });
            note.innerHTML = evs.map(function (e) {
              return "<div style='margin:2px 0'><b>" + e.title + "</b>" + (e.location ? " — " + e.location : "") + " <a href='" + e.url + "' target='_blank' rel='noopener'>details ↗</a></div>";
            }).join("") + "<div style='margin-top:8px;font-size:12px;opacity:.7'>Events auto-updated from medora.com, the ND Cowboy Hall of Fame, the National Park and the Medora Chamber.</div>";
            m.appendChild(note);
          }
        },
        canAdvance: function () { return true; }, nextLabel: "Book the Library →"
      },

      // 7. Library booking
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "The main event" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Your visit to the Library" }));
          m.appendChild(el("p", { class: "trtp-sub", text: D.library.hoursNote }));
          cardGrid(m, D.library.options, {
            wide: true, selected: function (o) { return isPicked("library", o.id); },
            blurb: function (o) { return o.blurb; },
            onclick: function (o) { toggle("library", o.id); }
          });
          m.appendChild(el("div", { class: "trtp-note", html: "Ready to lock it in? <a href='" + D.library.ticketsUrl + "' target='_blank' rel='noopener'><b>Buy your tickets ↗</b></a> — and book the Medora Musical and Pitchfork Steak Fondue ahead in summer." }));
        },
        canAdvance: function () { return true; }, nextLabel: "See my finished trip →"
      },

      // 8. Summary
      { render: function (m) { renderSummary(m); }, canAdvance: function () { return true; } }
    ];
  }

  // ---- Final summary ------------------------------------------------------
  function renderSummary(m) {
    m.appendChild(el("p", { class: "trtp-kicker", text: "Your itinerary" }));
    m.appendChild(el("h1", { class: "trtp-h display", text: (S.days ? S.days + "-Day " : "") + "Roosevelt Country Trip" }));

    // Getting there
    var day1 = el("div", { class: "trtp-summary-day" });
    day1.appendChild(el("h4", { text: "Getting there" }));
    var gl = el("ul");
    if (S.origin) gl.appendChild(el("li", { html: "Starting from <b>" + S.origin.label + "</b>" + (S.origin.driveHours ? " (about " + S.origin.driveHours + " hours by car)" : "") }));
    if (S.arrival === "air" && S.airport) {
      var ap = airport(S.airport);
      gl.appendChild(el("li", { html: "Fly into <b>" + ap.name + " (" + ap.code + ")</b>, then " + ap.driveToMedoraMin + " min / " + ap.driveToMedoraMiles + " mi to Medora" }));
      if (S.rental) gl.appendChild(el("li", { html: "Rental car with <b>" + S.rental + "</b> at " + ap.code }));
    } else if (S.arrival === "car") {
      gl.appendChild(el("li", { text: "Driving your own vehicle — maximum flexibility for the Badlands" }));
    }
    var sug = suggestedItinerary();
    if (sug) gl.appendChild(el("li", { html: "Suggested route backbone: <b>" + sug.title + "</b> – <a href='" + sug.url + "' target='_blank' rel='noopener'>view it ↗</a>" }));
    day1.appendChild(gl); m.appendChild(day1);

    summaryBlock(m, "Road-trip stops", "route", D.destinations.destinations, "You didn't add road-trip stops — that's fine for a Medora-focused visit.");
    summaryBlock(m, "Where you'll stay", "lodging", D.lodging.lodging, null);
    summaryBlock(m, "Your Medora day", "medora", D.medora.attractions, null);
    summaryBlock(m, "At the Library", "library", D.library.options, null);

    m.appendChild(el("div", { class: "trtp-note", html: "This plan lives on your screen. Use <b>Print / Save my trip</b> below to keep a copy (print to PDF), then head to <a href='" + D.library.ticketsUrl + "' target='_blank' rel='noopener'>trlibrary.com/visit</a> to book." }));
  }
  function summaryBlock(m, label, bucket, source, emptyMsg) {
    var ids = S.picks[bucket];
    if (!ids.length) { if (emptyMsg) { var d0 = el("div", { class: "trtp-summary-day" }); d0.appendChild(el("h4", { text: label })); d0.appendChild(el("p", { text: emptyMsg })); m.appendChild(d0); } return; }
    var d = el("div", { class: "trtp-summary-day" });
    d.appendChild(el("h4", { text: label }));
    var ul = el("ul");
    ids.forEach(function (id) {
      var it = byId(source, id); if (!it) return;
      var line = it.name + (it.blurb ? " — " + it.blurb : "");
      var li = el("li", {});
      li.appendChild(document.createTextNode(line + " "));
      if (it.booking || it.url) li.appendChild(el("a", { href: it.booking || it.url, target: "_blank", rel: "noopener" }, ["book/details ↗"]));
      ul.appendChild(li);
    });
    d.appendChild(ul); m.appendChild(d);
  }

  // ---- Go -----------------------------------------------------------------
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
