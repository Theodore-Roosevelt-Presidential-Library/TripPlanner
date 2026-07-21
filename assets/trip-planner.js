/*!
 * TR Library Trip Planner — single-file embeddable, rule-based day-by-day trip builder.
 * Embed:  <div id="tr-trip-planner"></div>
 *         <script src="https://trip.labs.trlibrary.com/assets/trip-planner.js"
 *                 data-container="tr-trip-planner"></script>
 * Static hosting, no API keys. Data lives in ../data/*.json relative to this script.
 */
(function () {
  "use strict";

  var THIS = document.currentScript ||
    (function () { var s = document.getElementsByTagName("script"); return s[s.length - 1]; })();
  var BASE = THIS.src.replace(/assets\/trip-planner\.js.*$/, "");
  var CONTAINER_ID = THIS.getAttribute("data-container") || "tr-trip-planner";
  var DATA = BASE + "data/";

  // ---- helpers ------------------------------------------------------------
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
  function byId(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i]; return null; }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function hmToMin(s) { var p = s.split(":"); return (+p[0]) * 60 + (+p[1]); }
  function minToLabel(m) { var h = Math.floor(m / 60), mm = m % 60; var ap = h >= 12 ? "PM" : "AM"; var h12 = ((h + 11) % 12) + 1; return h12 + ":" + pad2(mm) + " " + ap; }
  function durLabel(m) { var h = Math.floor(m / 60), mm = m % 60; return (h ? h + "h" : "") + (mm ? " " + mm + "m" : (h ? "" : "0m")); }
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DOWLONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---- state --------------------------------------------------------------
  var PACE = { relaxed: 360, balanced: 480, packed: 600 };
  var S = {
    step: 0,
    maxStep: 0,
    origin: null,
    startDate: null,   // "YYYY-MM-DD"
    days: null,
    pace: "balanced",
    arrival: null,     // 'car' | 'air'
    airport: null,     // fly-in code
    diffReturn: false,
    airportOut: null,  // fly-out code
    rental: null,
    styles: [],
    tier: null,
    picks: { route: [], lodging: [], medora: [], library: [] }
  };
  var D = {};
  var STEPS = [];
  var STEP_LABELS = ["Start", "Dates", "Getting here", "Interests", "Road trip", "Stay", "Medora", "Library", "Schedule"];

  // ---- styling ------------------------------------------------------------
  function injectCSS(c) {
    if (document.getElementById("trtp-style")) return;
    var css = `
    @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&display=swap');
    #${CONTAINER_ID}{--tr-primary:${c.primary};--tr-secondary:${c.secondary};--tr-muted:${c.muted};--tr-paper:${c.paper};--tr-ink:${c.ink};
      color:var(--tr-ink);background:var(--tr-paper);border-radius:6px;overflow:hidden;
      font-family:Frutiger,'Helvetica Neue',Arial,sans-serif;line-height:1.5;position:relative;box-shadow:0 1px 0 rgba(0,0,0,.04);}
    #${CONTAINER_ID} *{box-sizing:border-box;}
    .trtp-steps{display:flex;flex-wrap:wrap;gap:2px;background:var(--tr-secondary);padding:10px 14px;}
    .trtp-step{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.06em;font-size:11px;font-weight:600;
      color:#9fb3cc;background:transparent;border:none;padding:6px 9px;border-radius:3px;cursor:pointer;white-space:nowrap;}
    .trtp-step:hover{color:#fff;}
    .trtp-step .n{display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:50%;background:#2a486b;margin-right:5px;font-size:10px;}
    .trtp-step.on{color:#25282a;background:var(--tr-primary);}
    .trtp-step.on .n{background:rgba(0,0,0,.18);color:#fff;}
    .trtp-step.done{color:#fff;}
    .trtp-step.done .n{background:var(--tr-primary);color:#25282a;}
    .trtp-step:disabled{opacity:.5;cursor:not-allowed;}
    .trtp-wrap{display:grid;grid-template-columns:1fr 340px;gap:0;min-height:520px;}
    @media(max-width:820px){.trtp-wrap{grid-template-columns:1fr;}}
    .trtp-main{padding:26px 30px 34px;}
    .trtp-side{background:var(--tr-secondary);color:#fff;padding:22px 22px;}
    @media(max-width:820px){.trtp-side{order:2;}}
    .trtp-kicker{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.14em;font-size:12px;color:var(--tr-primary);font-weight:600;margin:0 0 6px;}
    .trtp-h{font-family:'Clearface',Georgia,serif;font-weight:600;color:var(--tr-secondary);font-size:29px;line-height:1.08;margin:0 0 8px;}
    .trtp-h.display{font-family:Oswald,'Dharma Gothic E',sans-serif;text-transform:uppercase;letter-spacing:.02em;font-weight:700;font-size:36px;}
    .trtp-sub{font-size:15px;color:#4a4d50;margin:0 0 20px;max-width:58ch;}
    .trtp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:13px;margin:6px 0 4px;}
    .trtp-grid.wide{grid-template-columns:repeat(auto-fill,minmax(255px,1fr));}
    .trtp-card{background:#fff;border:1px solid #e4ddcd;border-radius:5px;padding:14px 15px;cursor:pointer;text-align:left;
      transition:transform .12s,box-shadow .12s,border-color .12s;position:relative;font:inherit;color:inherit;}
    .trtp-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(9,42,77,.10);border-color:var(--tr-muted);}
    .trtp-card.sel{border-color:var(--tr-primary);box-shadow:0 0 0 2px var(--tr-primary) inset;}
    .trtp-card.dis{opacity:.5;}
    .trtp-card .t{font-family:'Clearface',Georgia,serif;font-weight:600;font-size:16px;color:var(--tr-secondary);margin:0 0 3px;}
    .trtp-card .b{font-size:13px;color:#5c5f62;margin:0;}
    .trtp-card .meta{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.07em;font-size:10.5px;color:var(--tr-primary);margin-top:8px;font-weight:600;}
    .trtp-card .check{position:absolute;top:9px;right:9px;width:20px;height:20px;border-radius:50%;background:var(--tr-primary);color:#fff;display:none;align-items:center;justify-content:center;font-size:12px;}
    .trtp-card.sel .check{display:flex;}
    .trtp-nav{display:flex;justify-content:space-between;align-items:center;margin-top:24px;gap:12px;flex-wrap:wrap;}
    .trtp-btn{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-weight:600;font-size:13px;border:none;border-radius:3px;padding:12px 22px;cursor:pointer;transition:filter .12s,transform .12s;}
    .trtp-btn:hover{filter:brightness(1.05);transform:translateY(-1px);}
    .trtp-btn.primary{background:var(--tr-primary);color:#25282a;}
    .trtp-btn.ghost{background:transparent;color:var(--tr-secondary);border:1px solid var(--tr-muted);}
    .trtp-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;}
    .trtp-side h3{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.12em;font-size:13px;color:var(--tr-primary);margin:0 0 4px;font-weight:600;}
    .trtp-side .trip-name{font-family:'Clearface',Georgia,serif;font-size:21px;font-weight:600;margin:0 0 14px;color:#fff;}
    .trtp-side .empty{color:#9fb3cc;font-size:13.5px;font-style:italic;}
    .trtp-sec{margin-bottom:15px;}
    .trtp-sec .lbl{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.1em;font-size:10.5px;color:#9fb3cc;margin:0 0 6px;}
    .trtp-item{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;font-size:13.5px;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.14);}
    .trtp-item .x{background:none;border:none;color:#9fb3cc;cursor:pointer;font-size:15px;line-height:1;padding:0 2px;}
    .trtp-item .x:hover{color:#fff;}
    .trtp-side .fact{font-size:13px;color:#cdd8e6;margin:2px 0;}
    .trtp-side .fact b{color:#fff;font-weight:600;}
    .trtp-cta{display:block;text-align:center;background:var(--tr-primary);color:#25282a !important;text-decoration:none;font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-weight:600;font-size:13px;padding:12px;border-radius:3px;margin-top:16px;}
    .trtp-note{background:#fff;border-left:3px solid var(--tr-primary);padding:10px 14px;font-size:13.5px;color:#5c5f62;border-radius:0 4px 4px 0;margin:14px 0;}
    .trtp-warn{background:#fff4ef;border-left:3px solid var(--tr-primary);padding:10px 14px;font-size:13px;color:#8a4a2f;border-radius:0 4px 4px 0;margin:12px 0;}
    .trtp-loading{padding:60px 30px;text-align:center;color:var(--tr-secondary);font-family:'Clearface',Georgia,serif;font-size:20px;}
    .trtp-sub-h{font-family:'Clearface',Georgia,serif;font-weight:600;font-size:18px;color:var(--tr-secondary);margin:22px 0 8px;}
    .trtp-field{display:flex;flex-direction:column;gap:6px;margin:4px 0 8px;max-width:280px;}
    .trtp-field label{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:var(--tr-secondary);font-weight:600;}
    .trtp-field input{font:inherit;padding:10px 12px;border:1px solid #d8cfb9;border-radius:4px;background:#fff;}
    .trtp-day{background:#fff;border:1px solid #e4ddcd;border-radius:6px;padding:0;margin:0 0 14px;overflow:hidden;}
    .trtp-day-head{background:var(--tr-secondary);color:#fff;padding:11px 16px;display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;}
    .trtp-day-head .dt{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-size:14px;}
    .trtp-day-head .sd{font-size:12px;color:#9fb3cc;}
    .trtp-row{display:flex;gap:12px;padding:11px 16px;border-bottom:1px solid #f0ead9;}
    .trtp-row:last-child{border-bottom:none;}
    .trtp-row .tm{font-family:Oswald,sans-serif;font-weight:600;font-size:12.5px;color:var(--tr-primary);min-width:74px;white-space:nowrap;padding-top:1px;}
    .trtp-row .bd{flex:1;}
    .trtp-row .bd .nm{font-family:'Clearface',Georgia,serif;font-weight:600;color:var(--tr-secondary);font-size:15px;}
    .trtp-row .bd .ds{font-size:12.5px;color:#6c6f72;margin-top:1px;}
    .trtp-row .bd .bk{font-size:12px;margin-top:3px;}
    .trtp-row .bd .bk a{color:var(--tr-primary);text-decoration:none;font-weight:600;}
    .trtp-row.drive{background:#faf6ee;}
    .trtp-row.drive .nm{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.05em;font-size:12.5px;color:#8a7a5f;}
    .trtp-seg{display:inline-flex;border:1px solid #d8cfb9;border-radius:4px;overflow:hidden;margin:2px 0 6px;}
    .trtp-seg button{font:inherit;font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.05em;font-size:12px;font-weight:600;padding:8px 14px;border:none;background:#fff;color:var(--tr-secondary);cursor:pointer;border-right:1px solid #e4ddcd;}
    .trtp-seg button:last-child{border-right:none;}
    .trtp-seg button.on{background:var(--tr-primary);color:#25282a;}
    @media print{.trtp-side,.trtp-nav,.trtp-steps{display:none !important;}.trtp-wrap{grid-template-columns:1fr;}}
    `;
    document.head.appendChild(el("style", { id: "trtp-style", html: css }));
  }

  // ---- boot ---------------------------------------------------------------
  function boot() {
    var host = document.getElementById(CONTAINER_ID);
    if (!host) { console.warn("[TRTP] container #" + CONTAINER_ID + " not found"); return; }
    host.innerHTML = '<div class="trtp-loading">Saddling up your trip planner…</div>';
    var files = ["config", "origins", "airports", "destinations", "lodging", "medora", "itineraries", "library", "events"];
    Promise.all(files.map(function (f) { return fetch(DATA + f + ".json").then(function (r) { return r.json(); }); }))
      .then(function (res) {
        files.forEach(function (f, i) { D[f] = res[i]; });
        D.library._all = [D.library.generalAdmission].concat(D.library.tours || [], D.library.options || []);
        injectCSS(D.config.brand.colors);
        defineSteps();
        render();
      })
      .catch(function (err) {
        host.innerHTML = '<div class="trtp-loading">The trip planner could not load its data. Please refresh.</div>';
        console.error("[TRTP] data load failed", err);
      });
  }

  // ---- lookups ------------------------------------------------------------
  function airport(code) { var a = D.airports.airports; for (var i = 0; i < a.length; i++) if (a[i].code === code) return a[i]; return null; }
  function libItem(id) { return byId(D.library._all, id); }
  function matchesStyle(tags) { return !S.styles.length || S.styles.some(function (s) { return tags && tags.indexOf(s) > -1; }); }
  function toggle(bucket, id) { var a = S.picks[bucket]; var i = a.indexOf(id); if (i > -1) a.splice(i, 1); else a.push(id); render(); }
  function isPicked(bucket, id) { return S.picks[bucket].indexOf(id) > -1; }
  function rentalOptions() {
    if (!S.airport) return [];
    var inList = airport(S.airport).rentalCars;
    if (S.diffReturn && S.airportOut) { var out = airport(S.airportOut).rentalCars; return inList.filter(function (r) { return out.indexOf(r) > -1; }); }
    return inList;
  }
  function suggestedItinerary() {
    if (!S.origin) return null;
    var list = D.itineraries.itineraries;
    var pool = (S.origin.suggestedItineraries || []).map(function (id) { return byId(list, id); }).filter(Boolean);
    var fit = pool.filter(function (it) { return !S.days || it.days <= S.days + 1; });
    return fit[0] || pool[0] || null;
  }
  function dateForDay(i) {
    if (!S.startDate) return null;
    var p = S.startDate.split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + i); return d;
  }

  // ---- render root --------------------------------------------------------
  function goto(i) { S.step = i; if (i > S.maxStep) S.maxStep = i; render(); }
  function render() {
    var host = document.getElementById(CONTAINER_ID);
    var root = el("div", {});
    root.appendChild(renderStepper());
    var wrap = el("div", { class: "trtp-wrap" });
    var main = el("div", { class: "trtp-main" });
    STEPS[S.step].render(main);
    var nav = el("div", { class: "trtp-nav" });
    var back = el("button", { class: "trtp-btn ghost", onclick: function () { if (S.step > 0) goto(S.step - 1); } }, ["← Back"]);
    if (S.step === 0) back.style.visibility = "hidden";
    var isLast = S.step === STEPS.length - 1;
    var ok = STEPS[S.step].canAdvance ? STEPS[S.step].canAdvance() : true;
    var next = el("button", {
      class: "trtp-btn primary", disabled: ok ? null : "disabled",
      onclick: function () { if (isLast) openPrintable(); else goto(S.step + 1); }
    }, [isLast ? "Print / save itinerary" : (STEPS[S.step].nextLabel || "Continue →")]);
    nav.appendChild(back); nav.appendChild(next);
    main.appendChild(nav);
    wrap.appendChild(main);
    wrap.appendChild(renderSidebar());
    root.appendChild(wrap);
    host.innerHTML = ""; host.appendChild(root);
  }
  function renderStepper() {
    var bar = el("div", { class: "trtp-steps" });
    STEP_LABELS.forEach(function (lbl, i) {
      var cls = "trtp-step" + (i === S.step ? " on" : (i < S.step || i <= S.maxStep ? " done" : ""));
      bar.appendChild(el("button", {
        class: cls, disabled: i <= S.maxStep || i === S.step ? null : "disabled",
        onclick: function () { if (i <= S.maxStep) goto(i); }
      }, [el("span", { class: "n", text: "" + (i + 1) }), lbl]));
    });
    return bar;
  }

  // ---- sidebar ------------------------------------------------------------
  function renderSidebar() {
    var side = el("div", { class: "trtp-side" });
    side.appendChild(el("h3", { text: "Your Trip" }));
    side.appendChild(el("div", { class: "trip-name", text: (S.days ? S.days + "-Day " : "") + "Roosevelt Country Trip" }));
    if (S.origin) {
      var f = el("div", { class: "trtp-sec" });
      f.appendChild(el("div", { class: "fact", html: "<b>From:</b> " + S.origin.label }));
      if (S.startDate) { var d0 = dateForDay(0); f.appendChild(el("div", { class: "fact", html: "<b>Arriving:</b> " + DOW[d0.getDay()] + " " + MON[d0.getMonth()] + " " + d0.getDate() })); }
      if (S.arrival === "air" && S.airport) f.appendChild(el("div", { class: "fact", html: "<b>Fly in:</b> " + S.airport + (S.diffReturn && S.airportOut ? " · <b>out:</b> " + S.airportOut : "") }));
      if (S.rental) f.appendChild(el("div", { class: "fact", html: "<b>Rental:</b> " + S.rental }));
      if (S.tier) f.appendChild(el("div", { class: "fact", html: "<b>Comfort:</b> " + byId(D.config.comfortTiers, S.tier).label + " · <b>Pace:</b> " + S.pace }));
      side.appendChild(f);
    }
    var any = false;
    any = pickSec(side, "Road-trip stops", "route", D.destinations.destinations) || any;
    any = pickSec(side, "Where you'll stay", "lodging", D.lodging.lodging) || any;
    any = pickSec(side, "Your Medora day", "medora", D.medora.attractions) || any;
    any = pickSec(side, "At the Library", "library", D.library._all) || any;
    if (!any && !S.origin) side.appendChild(el("div", { class: "empty", text: "Answer a few questions and click what you like — it collects here into a day-by-day plan you can print." }));
    side.appendChild(el("a", { class: "trtp-cta", href: D.library.ticketsUrl, target: "_blank", rel: "noopener" }, ["Book your Library visit"]));
    return side;
  }
  function pickSec(side, label, bucket, source) {
    var ids = S.picks[bucket]; if (!ids.length) return false;
    var sec = el("div", { class: "trtp-sec" });
    sec.appendChild(el("div", { class: "lbl", text: label }));
    ids.forEach(function (id) {
      var it = byId(source, id); if (!it) return;
      var row = el("div", { class: "trtp-item" });
      row.appendChild(el("span", { text: it.name }));
      row.appendChild(el("button", { class: "x", title: "Remove", onclick: function () { toggle(bucket, id); } }, ["×"]));
      sec.appendChild(row);
    });
    side.appendChild(sec); return true;
  }

  // ---- card grid ----------------------------------------------------------
  function cardGrid(main, items, opts) {
    var grid = el("div", { class: "trtp-grid" + (opts.wide ? " wide" : "") });
    items.forEach(function (it) {
      var sel = opts.selected ? opts.selected(it) : false;
      var dis = opts.disabled ? opts.disabled(it) : false;
      grid.appendChild(el("button", {
        class: "trtp-card" + (sel ? " sel" : "") + (dis ? " dis" : ""), type: "button",
        onclick: function () { opts.onclick(it); }
      }, [
        el("span", { class: "check", html: "✓" }),
        el("div", { class: "t", text: it[opts.title || "name"] }),
        opts.blurb ? el("div", { class: "b", text: (typeof opts.blurb === "function" ? opts.blurb(it) : it[opts.blurb]) }) : null,
        opts.meta ? el("div", { class: "meta", text: opts.meta(it) }) : null
      ]));
    });
    main.appendChild(grid);
  }

  // ---- steps --------------------------------------------------------------
  function defineSteps() {
    STEPS = [
      // 0 Origin
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Plan your visit" }));
          m.appendChild(el("h1", { class: "trtp-h display", text: "Build your Roosevelt Country trip" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "The Library sits in the middle of the best road-trip country in America. Answer a few questions and click what appeals — we'll assemble a dated, hour-by-hour plan you can print and book. First: where are you starting from?" }));
          cardGrid(m, D.origins.origins, {
            title: "label", selected: function (o) { return S.origin && S.origin.id === o.id; },
            meta: function (o) { return o.driveHours ? o.driveHours + " hrs · " + o.distanceMiles + " mi" : "Flying in"; },
            onclick: function (o) { S.origin = o; S.airport = o.nearestAirport; if (o.arrival !== "either") S.arrival = o.arrival; render(); }
          });
        },
        canAdvance: function () { return !!S.origin; }
      },

      // 1 Dates + days + pace
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "When & how long" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Your dates and pace" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "Tell us when you're arriving and how many days you have. An arrival date lets us line up tours and shows on the exact days they actually run." }));
          var fld = el("div", { class: "trtp-field" });
          fld.appendChild(el("label", { text: "Arrival date (optional, but recommended)" }));
          fld.appendChild(el("input", { type: "date", value: S.startDate || "", onchange: function (e) { S.startDate = e.target.value || null; render(); } }));
          m.appendChild(fld);
          m.appendChild(el("div", { class: "trtp-sub-h", text: "How many days do you have?" }));
          var opts = [
            { d: 1, label: "A day or less", note: "The Library + the South Unit loop" },
            { d: 3, label: "A weekend (2–3 days)", note: "Medora, properly" },
            { d: 6, label: "About a week (4–7 days)", note: "Add the Black Hills or River Road" },
            { d: 12, label: "The big one (8+ days)", note: "Several national parks" }
          ];
          cardGrid(m, opts, { title: "label", selected: function (o) { return S.days === o.d; }, blurb: function (o) { return o.note; }, onclick: function (o) { S.days = o.d; render(); } });
          m.appendChild(el("div", { class: "trtp-sub-h", text: "What's your pace?" }));
          var seg = el("div", { class: "trtp-seg" });
          [["relaxed", "Relaxed"], ["balanced", "Balanced"], ["packed", "Packed"]].forEach(function (p) {
            seg.appendChild(el("button", { class: S.pace === p[0] ? "on" : "", onclick: function () { S.pace = p[0]; render(); } }, [p[1]]));
          });
          m.appendChild(seg);
          m.appendChild(el("div", { class: "trtp-note", text: S.pace === "relaxed" ? "Relaxed: about 6 hours of activity a day, with room to breathe." : S.pace === "packed" ? "Packed: up to 10 hours a day — see as much as possible." : "Balanced: about 8 hours of activity a day." }));
          var sug = suggestedItinerary();
          if (sug) m.appendChild(el("div", { class: "trtp-note", html: "A great backbone for your trip: <b>" + sug.title + "</b> — " + sug.blurb + " <a href='" + sug.url + "' target='_blank' rel='noopener'>See it ↗</a>" }));
        },
        canAdvance: function () { return !!S.days; }
      },

      // 2 Getting here
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Getting here" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "How will you get to Medora?" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "Medora is closer than most people think. Driving, or flying into a regional airport and renting a car — including flying into one airport and out of another." }));
          cardGrid(m, [
            { id: "car", name: "Driving", note: S.origin && S.origin.driveHours ? ("About " + S.origin.driveHours + " hours from " + S.origin.label) : "Your own vehicle, all the flexibility" },
            { id: "air", name: "Flying + rental car", note: "Fly into a regional airport, drive the rest" }
          ], { selected: function (o) { return S.arrival === o.id; }, blurb: function (o) { return o.note; }, onclick: function (o) { S.arrival = o.id; render(); } });

          if (S.arrival === "air") {
            var aps = D.airports.airports.slice().sort(function (a, b) { return a.driveToMedoraMin - b.driveToMedoraMin; });
            m.appendChild(el("div", { class: "trtp-sub-h", text: "Fly into" }));
            cardGrid(m, aps, {
              wide: true, selected: function (a) { return S.airport === a.code; },
              blurb: function (a) { return a.note; },
              meta: function (a) { return a.code + " · " + a.driveToMedoraMin + " min / " + a.driveToMedoraMiles + " mi to Medora"; },
              onclick: function (a) { S.airport = a.code; if (S.rental && rentalOptions().indexOf(S.rental) < 0) S.rental = null; render(); }
            });

            m.appendChild(el("div", { class: "trtp-sub-h", text: "Departure airport" }));
            cardGrid(m, [{ id: "same", name: "Fly out of the same airport" }, { id: "diff", name: "Fly out of a different airport" }], {
              selected: function (o) { return (o.id === "diff") === S.diffReturn; },
              onclick: function (o) { S.diffReturn = (o.id === "diff"); if (!S.diffReturn) S.airportOut = null; if (S.rental && rentalOptions().indexOf(S.rental) < 0) S.rental = null; render(); }
            });
            if (S.diffReturn) {
              cardGrid(m, aps, {
                wide: true, selected: function (a) { return S.airportOut === a.code; },
                blurb: function (a) { return a.note; },
                meta: function (a) { return a.code + " · " + a.driveToMedoraMin + " min to Medora"; },
                onclick: function (a) { S.airportOut = a.code; if (S.rental && rentalOptions().indexOf(S.rental) < 0) S.rental = null; render(); }
              });
            }

            if (S.airport && (!S.diffReturn || S.airportOut)) {
              var opts = rentalOptions();
              m.appendChild(el("div", { class: "trtp-sub-h", text: S.diffReturn ? "Rental cars serving both " + S.airport + " and " + S.airportOut : "Rental cars at " + S.airport }));
              if (!opts.length) {
                m.appendChild(el("div", { class: "trtp-warn", text: "No single rental company serves both of those airports. For a one-way rental, pick the same airport for return, or choose two airports that share a company." }));
              } else {
                cardGrid(m, opts.map(function (n) { return { id: n, name: n }; }), {
                  selected: function (r) { return S.rental === r.id; },
                  blurb: function () { return S.diffReturn ? "One-way rental (pick-up + drop-off)" : "Available at " + airport(S.airport).city; },
                  onclick: function (r) { S.rental = r.id; render(); }
                });
                if (S.diffReturn) m.appendChild(el("div", { class: "trtp-note", text: "One-way rentals usually carry a drop-off fee — confirm when you book." }));
              }
              m.appendChild(el("div", { class: "trtp-note", html: "Heads up: rideshare is limited in Medora, so a rental car is the way to explore the Badlands. <a href='" + D.config.brand.directionsUrl + "' target='_blank' rel='noopener'>Full directions ↗</a>" }));
            }
          }
        },
        canAdvance: function () { return S.arrival === "car" || (S.arrival === "air" && !!S.airport && (!S.diffReturn || !!S.airportOut)); }
      },

      // 3 Interests
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Your kind of trip" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "What are you here for?" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "Pick anything that sounds like you. We'll use it to surface the best stops for your road trip (you can still add anything)." }));
          cardGrid(m, D.config.travelStyles, {
            title: "label", selected: function (s) { return S.styles.indexOf(s.id) > -1; },
            onclick: function (s) { var i = S.styles.indexOf(s.id); if (i > -1) S.styles.splice(i, 1); else S.styles.push(s.id); render(); }
          });
        },
        canAdvance: function () { return true; }, nextLabel: "Build my road trip →"
      },

      // 4 Road trip
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "The ultimate road trip" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Add stops along the way" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "National parks, monuments, great Western towns and state parks within reach of Medora. Regional stops become their own day trips in your schedule." }));
          var items = D.destinations.destinations.filter(function (d) { return matchesStyle(d.tags); }).sort(function (a, b) { return a.milesFromMedora - b.milesFromMedora; });
          var tl = { national_park: "National Park", national_monument: "National Monument", state_park: "State Park", town: "Western Town", cultural: "History & Culture", scenic: "Scenic" };
          cardGrid(m, items, {
            wide: true, selected: function (d) { return isPicked("route", d.id); },
            blurb: function (d) { return d.blurb; },
            meta: function (d) { return tl[d.type] + " · " + (d.milesFromMedora <= 1 ? "in Medora" : d.milesFromMedora + " mi · ~" + Math.round(d.duration / 60) + "h"); },
            onclick: function (d) { toggle("route", d.id); }
          });
        },
        canAdvance: function () { return true; }
      },

      // 5 Lodging
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Where you'll stay" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Pick your level of comfort" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "From a tent under the stars to the restored Rough Riders Hotel. Choose a comfort level and we'll show the right stays." }));
          cardGrid(m, D.config.comfortTiers, {
            title: "label", selected: function (t) { return S.tier === t.id; }, blurb: function (t) { return t.blurb; }, meta: function (t) { return t.priceHint; },
            onclick: function (t) { S.tier = t.id; render(); }
          });
          if (S.tier) {
            var stays = D.lodging.lodging.filter(function (l) { return l.tier === S.tier; });
            m.appendChild(el("div", { class: "trtp-sub-h", text: S.tier === "camp" ? "Camping & RV options" : "Places to stay" }));
            cardGrid(m, stays, {
              wide: true, selected: function (l) { return isPicked("lodging", l.id); },
              blurb: function (l) { return l.blurb; },
              meta: function (l) { return l.area + (l.season ? " · " + MON[l.season[0] - 1] + "–" + MON[l.season[1] - 1] : " · year-round") + (l.priceHint ? " · " + l.priceHint : ""); },
              onclick: function (l) { toggle("lodging", l.id); }
            });
          }
        },
        canAdvance: function () { return !!S.tier; }, nextLabel: "Plan my Medora day →"
      },

      // 6 Medora day
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Your day in Medora" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Build your Medora day" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "The Badlands that shaped Roosevelt and a town that still runs on Western hospitality. Click what you want to do, see, eat and watch — we'll slot each into your schedule at the right time." }));
          var groups = [{ key: "attraction", label: "See & do" }, { key: "evening", label: "Evenings & entertainment" }, { key: "dining", label: "Where to eat" }, { key: "shopping", label: "Where to shop" }];
          groups.forEach(function (g) {
            var items = D.medora.attractions.filter(function (a) { return a.category === g.key; });
            if (!items.length) return;
            m.appendChild(el("div", { class: "trtp-sub-h", text: g.label }));
            cardGrid(m, items, {
              wide: g.key === "attraction" || g.key === "evening",
              selected: function (a) { return isPicked("medora", a.id); },
              blurb: function (a) { return a.blurb; },
              meta: function (a) { return availMeta(a); },
              onclick: function (a) { toggle("medora", a.id); }
            });
          });
          var evs = D.events.events || [];
          if (evs.length) {
            m.appendChild(el("div", { class: "trtp-sub-h", text: "Happening while you're here" }));
            var note = el("div", { class: "trtp-note" });
            note.innerHTML = evs.map(function (e) { return "<div style='margin:2px 0'><b>" + e.title + "</b>" + (e.location ? " — " + e.location : "") + " <a href='" + e.url + "' target='_blank' rel='noopener'>details ↗</a></div>"; }).join("") + "<div style='margin-top:8px;font-size:12px;opacity:.7'>Auto-updated from medora.com, the ND Cowboy Hall of Fame, the National Park and the Medora Chamber.</div>";
            m.appendChild(note);
          }
        },
        canAdvance: function () { return true; }, nextLabel: "Choose your Library visit →"
      },

      // 7 Library
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "The main event" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Your visit to the Library" }));
          m.appendChild(el("p", { class: "trtp-sub", text: D.library.hoursNote + " Start with general admission, then add a specialty tour or two — each runs on set days and times, and we'll place them in your schedule accordingly." }));
          m.appendChild(el("div", { class: "trtp-sub-h", text: "Admission" }));
          cardGrid(m, [D.library.generalAdmission], {
            wide: true, selected: function (o) { return isPicked("library", o.id); }, blurb: function (o) { return o.blurb; },
            meta: function () { return "Self-guided · ~2.5h · Free timed entry"; }, onclick: function (o) { toggle("library", o.id); }
          });
          m.appendChild(el("div", { class: "trtp-sub-h", text: "Specialty tours" }));
          cardGrid(m, D.library.tours, {
            wide: true, selected: function (o) { return isPicked("library", o.id); }, blurb: function (o) { return o.blurb; },
            meta: function (o) { return tourMeta(o); }, onclick: function (o) { toggle("library", o.id); }
          });
          m.appendChild(el("div", { class: "trtp-note", html: "Book ahead: <a href='" + D.library.ticketsUrl + "' target='_blank' rel='noopener'><b>General admission ↗</b></a> · <a href='" + D.library.toursUrl + "' target='_blank' rel='noopener'>all tours ↗</a>. Reserve the Medora Musical and Pitchfork Steak Fondue early in summer, too." }));
        },
        canAdvance: function () { return true; }, nextLabel: "See my day-by-day schedule →"
      },

      // 8 Schedule
      { render: function (m) { renderSchedule(m); }, canAdvance: function () { return true; } }
    ];
  }

  function availMeta(a) {
    var parts = [];
    if (a.featured) parts.push("★ Popular");
    if (a.avail && a.avail.fixed) parts.push(fixedShort(a.avail.fixed));
    else if (a.avail && a.avail.open) parts.push(a.duration ? "~" + Math.round(a.duration / 60 * 10) / 10 + "h" : "");
    if (a.avail && a.avail.season) parts.push(MON[a.avail.season[0] - 1] + "–" + MON[a.avail.season[1] - 1]);
    return parts.filter(Boolean).join(" · ");
  }
  function tourMeta(o) {
    var parts = [];
    if (o.avail && o.avail.fixed) parts.push(fixedShort(o.avail.fixed));
    parts.push(o.duration + " min");
    parts.push(o.price ? "$" + o.price : (o.priceLabel || "Included"));
    return parts.join(" · ");
  }
  function fixedShort(fixed) {
    return fixed.map(function (w) {
      var days = w.days.length === 7 ? "Daily" : w.days.map(function (d) { return DOW[d]; }).join("/");
      return days + " " + minToLabel(hmToMin(w.start));
    }).join("; ");
  }

  // ---- SCHEDULER ----------------------------------------------------------
  // Normalize a pick into a schedulable object.
  function normLib(o) { return { id: o.id, name: o.name, duration: o.duration || 0, avail: o.avail || {}, phone: o.phone, booking: o.booking, area: "library", where: "Theodore Roosevelt Presidential Library", price: o.price, priceLabel: o.priceLabel, kind: o.kind }; }
  function normMed(a) { return { id: a.id, name: a.name, duration: a.duration || 60, avail: a.avail || {}, phone: a.phone, booking: a.booking || a.url, area: "medora", where: "Medora", category: a.category, meal: a.meal, kind: a.category }; }
  function normDest(d) { return { id: d.id, name: d.name, duration: d.duration || 180, avail: d.avail || {}, phone: d.phone, booking: d.booking || d.url, area: d.milesFromMedora > 15 ? "regional" : "medora", miles: d.milesFromMedora, kind: "destination" }; }

  function seasonOk(av, month) { if (!av || !av.season || month == null) return true; return month >= av.season[0] && month <= av.season[1]; }
  function fixedWindowFor(av, wd) { if (!av || !av.fixed) return null; if (wd == null) return av.fixed[0]; for (var i = 0; i < av.fixed.length; i++) if (av.fixed[i].days.indexOf(wd) > -1) return av.fixed[i]; return null; }
  function dayOk(av, wd) { if (!av) return true; if (av.fixed) return fixedWindowFor(av, wd) != null; if (av.days && wd != null) return av.days.indexOf(wd) > -1; return true; }

  function buildSchedule() {
    var lib = S.picks.library.map(function (id) { return normLib(libItem(id)); }).filter(function (x) { return x.duration > 0 || x.kind === "tour" || x.kind === "admission"; });
    var med = S.picks.medora.map(function (id) { return normMed(byId(D.medora.attractions, id)); });
    var dest = S.picks.route.map(function (id) { return normDest(byId(D.destinations.destinations, id)); });
    var regional = dest.filter(function (d) { return d.area === "regional"; }).sort(function (a, b) { return a.miles - b.miles; });
    var local = lib.concat(med, dest.filter(function (d) { return d.area === "medora"; }));

    var N = Math.max(S.days || 0, regional.length + (local.length ? 1 : 0), 1);
    var days = [];
    for (var i = 0; i < N; i++) { var dt = dateForDay(i); days.push({ index: i, date: dt, wd: dt ? dt.getDay() : null, month: dt ? dt.getMonth() + 1 : null, regional: null, items: [], entries: [], notes: [] }); }

    // Assign regional excursions to later days first, leaving day 0 for the Library/local core.
    var regDayOrder = days.slice().sort(function (a, b) { return (a.index === 0 ? 1 : 0) - (b.index === 0 ? 1 : 0) || a.index - b.index; });
    var overflow = [];
    regional.forEach(function (r) {
      var day = null;
      for (var j = 0; j < regDayOrder.length; j++) { if (!regDayOrder[j].regional) { day = regDayOrder[j]; break; } }
      if (!day) { overflow.push({ item: r, reason: "not enough days for this drive" }); return; }
      if (!seasonOk(r.avail, day.month)) day.notes.push(r.name + " may be seasonal — check before you go.");
      day.regional = r;
    });

    // Local days = days without a regional excursion (fall back to day 0 if all taken).
    var localDays = days.filter(function (d) { return !d.regional; });
    if (!localDays.length) localDays = [days[0]];

    // Assign local items to local days (season + weekday aware, budget-limited).
    var budget = PACE[S.pace] || 480;
    localDays.forEach(function (d) { d.used = 0; });
    // anchored (fixed-time) first so they claim the right weekday
    local.sort(function (a, b) { var af = a.avail.fixed ? 0 : 1, bf = b.avail.fixed ? 0 : 1; return af - bf || (b.duration - a.duration); });
    local.forEach(function (it) {
      var best = null;
      for (var j = 0; j < localDays.length; j++) {
        var d = localDays[j];
        if (!seasonOk(it.avail, d.month)) continue;
        if (!dayOk(it.avail, d.wd)) continue;
        if (it.avail.fixed && conflictsFixed(d, it)) continue;
        if (d.used + it.duration > budget + 60) continue;
        if (!best || d.used < best.used) best = d;
      }
      if (best) { best.items.push(it); best.used += it.duration; }
      else overflow.push({ item: it, reason: reasonUnfit(it, localDays) });
    });

    days.forEach(function (d) { layoutDay(d); });
    return { days: days, overflow: overflow };
  }
  function conflictsFixed(day, it) {
    var w = fixedWindowFor(it.avail, day.wd); if (!w) return true;
    var s = hmToMin(w.start), e = hmToMin(w.end);
    return day.items.some(function (o) { if (!o.avail.fixed) return false; var ow = fixedWindowFor(o.avail, day.wd); if (!ow) return false; return hmToMin(ow.start) < e && hmToMin(ow.end) > s; });
  }
  function reasonUnfit(it, localDays) {
    if (it.avail.season && !localDays.some(function (d) { return seasonOk(it.avail, d.month); })) return "closed on your dates (seasonal)";
    if (it.avail.fixed && !localDays.some(function (d) { return dayOk(it.avail, d.wd); })) return "doesn't run on your travel days";
    return "no room left in your days at this pace";
  }
  function layoutDay(day) {
    var entries = [];
    if (day.regional) {
      var r = day.regional, driveH = Math.max(1, Math.round(r.miles / 60));
      var start = 8 * 60;
      entries.push({ start: start, dur: driveH * 60, drive: true, name: "Drive to " + r.name.replace(/ \(.*\)/, ""), ds: "~" + driveH + "h each way from Medora" });
      var vs = start + driveH * 60;
      entries.push({ start: vs, dur: r.duration, name: r.name, ds: "Explore (~" + Math.round(r.duration / 60) + "h)", booking: r.booking, phone: r.phone });
      entries.push({ start: vs + r.duration, dur: driveH * 60, drive: true, name: "Drive back to Medora", ds: "~" + driveH + "h" });
      day.entries = entries; return;
    }
    // anchored items
    var anchors = day.items.filter(function (i) { return i.avail.fixed; }).map(function (i) { var w = fixedWindowFor(i.avail, day.wd); return { it: i, start: hmToMin(w.start), end: hmToMin(w.end) }; }).sort(function (a, b) { return a.start - b.start; });
    var flex = day.items.filter(function (i) { return !i.avail.fixed; });
    // order flex: breakfast, big attractions, lunch, others, dinner
    var order = { breakfast: 0, attraction: 1, destination: 1, lunch: 2, admission: 1, shopping: 3, dinner: 5 };
    flex.sort(function (a, b) { return (order[a.meal || a.kind] || 2) - (order[b.meal || b.kind] || 2); });
    var cursor = 9 * 60;
    var ai = 0;
    function placeFlexUntil(limit) {
      while (flex.length && cursor + flex[0].duration <= limit) {
        var it = flex.shift();
        var open = it.avail.open ? hmToMin(it.avail.open) : cursor;
        if (it.meal === "lunch" && cursor < 12 * 60) cursor = 12 * 60;
        if (it.meal === "dinner" && cursor < 17 * 60) cursor = 17 * 60;
        if (cursor < open) cursor = open;
        if (cursor + it.duration > limit) { flex.unshift(it); break; }
        entries.push({ start: cursor, dur: it.duration, name: it.name, ds: descFor(it), booking: it.booking, phone: it.phone });
        cursor += it.duration + 15;
      }
    }
    for (; ai < anchors.length; ai++) {
      placeFlexUntil(anchors[ai].start);
      var a = anchors[ai];
      entries.push({ start: a.start, dur: a.end - a.start, name: a.it.name, ds: descFor(a.it) + " · reserved time", booking: a.it.booking, phone: a.it.phone, anchor: true });
      cursor = Math.max(cursor, a.end + 15);
    }
    placeFlexUntil(22 * 60);
    flex.forEach(function (it) { day.notes.push("Also consider: " + it.name); });
    day.entries = entries.sort(function (a, b) { return a.start - b.start; });
  }
  function descFor(it) {
    if (it.kind === "tour") return "Library specialty tour" + (it.price ? " · $" + it.price : " · included");
    if (it.kind === "admission") return "Self-guided galleries & grounds";
    if (it.category === "dining") return "Meal · Medora";
    if (it.category === "evening") return "Evening · book ahead";
    if (it.category === "shopping") return "Shopping · downtown Medora";
    if (it.area === "regional") return "Day trip · " + it.miles + " mi";
    return it.where || "Medora";
  }

  // ---- schedule step render ----------------------------------------------
  function renderSchedule(m) {
    var sched = buildSchedule();
    m.appendChild(el("p", { class: "trtp-kicker", text: "Your itinerary" }));
    m.appendChild(el("h1", { class: "trtp-h display", text: (S.days ? S.days + "-Day " : "") + "Roosevelt Country Trip" }));
    m.appendChild(el("p", { class: "trtp-sub", text: "Here's your day-by-day plan, timed around what's actually open and running. Adjust the pace, jump back to any step to change picks, then print a clean copy with booking numbers." }));
    var seg = el("div", { class: "trtp-seg" });
    [["relaxed", "Relaxed"], ["balanced", "Balanced"], ["packed", "Packed"]].forEach(function (p) { seg.appendChild(el("button", { class: S.pace === p[0] ? "on" : "", onclick: function () { S.pace = p[0]; render(); } }, [p[1]])); });
    m.appendChild(seg);

    if (!hasAnyPick()) m.appendChild(el("div", { class: "trtp-note", text: "You haven't added anything yet. Jump back to Road trip, Medora or Library and click what appeals — it'll lay out here by day and time." }));

    sched.days.forEach(function (day) {
      var card = el("div", { class: "trtp-day" });
      var head = el("div", { class: "trtp-day-head" });
      var title = "Day " + (day.index + 1);
      var sub = day.regional ? "Day trip" : "In & around Medora";
      if (day.date) title += " · " + DOWLONG[day.date.getDay()] + ", " + MON[day.date.getMonth()] + " " + day.date.getDate();
      head.appendChild(el("span", { class: "dt", text: title }));
      head.appendChild(el("span", { class: "sd", text: sub }));
      card.appendChild(head);
      if (!day.entries.length) card.appendChild(el("div", { class: "trtp-row" }, [el("div", { class: "bd" }, [el("div", { class: "ds", text: "Open day — add stops from earlier steps, or leave it free to explore." })])]));
      day.entries.forEach(function (e) {
        var row = el("div", { class: "trtp-row" + (e.drive ? " drive" : "") });
        row.appendChild(el("div", { class: "tm", text: minToLabel(e.start) }));
        var bd = el("div", { class: "bd" });
        bd.appendChild(el("div", { class: "nm", text: e.name }));
        if (e.ds) bd.appendChild(el("div", { class: "ds", text: e.ds }));
        if (e.booking || e.phone) {
          var bk = el("div", { class: "bk" });
          if (e.booking) bk.appendChild(el("a", { href: e.booking, target: "_blank", rel: "noopener" }, ["Book / info ↗"]));
          if (e.booking && e.phone) bk.appendChild(document.createTextNode("  ·  "));
          if (e.phone) bk.appendChild(el("span", { text: e.phone }));
          bd.appendChild(bk);
        }
        row.appendChild(bd);
        card.appendChild(row);
      });
      day.notes.forEach(function (n) { card.appendChild(el("div", { class: "trtp-row" }, [el("div", { class: "bd" }, [el("div", { class: "ds", text: n })])])); });
      m.appendChild(card);
    });

    if (sched.overflow.length) {
      var w = el("div", { class: "trtp-warn" });
      w.innerHTML = "<b>Couldn't fit these into your dates</b> — availability or time ran short:<br>" + sched.overflow.map(function (o) { return "• " + o.item.name + " — " + o.reason; }).join("<br>");
      m.appendChild(w);
    }
    m.appendChild(el("div", { class: "trtp-note", html: "The <b>Print / save itinerary</b> button opens a clean, printer-friendly page with every stop, its booking link and phone number — ready to print or save as PDF." }));
  }
  function hasAnyPick() { return S.picks.route.length || S.picks.medora.length || S.picks.library.length; }

  // ---- printable ----------------------------------------------------------
  function openPrintable() {
    var sched = buildSchedule();
    var c = D.config.brand.colors;
    var w = window.open("", "_blank");
    if (!w) { alert("Please allow pop-ups to open your printable itinerary."); return; }
    var rows = "";
    function esc(s) { return (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

    // header facts
    var facts = [];
    if (S.origin) facts.push("Starting from " + esc(S.origin.label) + (S.origin.driveHours ? " (~" + S.origin.driveHours + "h drive)" : ""));
    if (S.arrival === "air" && S.airport) { var a = airport(S.airport); facts.push("Fly into " + esc(a.name) + " (" + a.code + ")" + (S.diffReturn && S.airportOut ? "; fly out of " + esc(airport(S.airportOut).name) + " (" + S.airportOut + ")" : "")); if (S.rental) facts.push("Rental car: " + esc(S.rental) + (S.diffReturn ? " (one-way)" : "")); }
    else if (S.arrival === "car") facts.push("Driving your own vehicle");
    if (S.tier) facts.push("Comfort level: " + esc(byId(D.config.comfortTiers, S.tier).label) + " · Pace: " + esc(S.pace));

    var lodging = S.picks.lodging.map(function (id) { return byId(D.lodging.lodging, id); });
    var lodgingHtml = lodging.length ? "<h2>Where you're staying</h2><ul>" + lodging.map(function (l) { return "<li><b>" + esc(l.name) + "</b> — " + esc(l.area) + (l.phone ? " · " + esc(l.phone) : "") + " · <a href='" + l.booking + "'>book</a></li>"; }).join("") + "</ul>" : "";

    sched.days.forEach(function (day) {
      var title = "Day " + (day.index + 1) + (day.date ? " — " + DOWLONG[day.date.getDay()] + ", " + MON[day.date.getMonth()] + " " + day.date.getDate() : "");
      rows += "<div class='day'><h3>" + esc(title) + " <span class='sub'>" + (day.regional ? "Day trip" : "In &amp; around Medora") + "</span></h3><table>";
      if (!day.entries.length) rows += "<tr><td colspan=2 class='free'>Open day — explore at your own pace.</td></tr>";
      day.entries.forEach(function (e) {
        var book = "";
        if (e.booking) book += "<a href='" + e.booking + "'>" + esc(e.booking) + "</a>";
        if (e.phone) book += (book ? " · " : "") + esc(e.phone);
        rows += "<tr><td class='tm'>" + minToLabel(e.start) + "</td><td><span class='nm'>" + esc(e.name) + "</span>" + (e.ds ? "<span class='ds'>" + esc(e.ds) + "</span>" : "") + (book ? "<span class='bk'>" + book + "</span>" : "") + "</td></tr>";
      });
      day.notes.forEach(function (n) { rows += "<tr><td></td><td class='ds'>" + esc(n) + "</td></tr>"; });
      rows += "</table></div>";
    });

    var overflow = sched.overflow.length ? "<div class='warn'><b>Check availability / didn't fit:</b><ul>" + sched.overflow.map(function (o) { return "<li>" + esc(o.item.name) + " — " + esc(o.reason) + "</li>"; }).join("") + "</ul></div>" : "";

    // reservations checklist (things that need booking)
    var toBook = [];
    S.picks.library.forEach(function (id) { var o = libItem(id); toBook.push([o.name, o.booking, o.phone]); });
    S.picks.medora.map(function (id) { return byId(D.medora.attractions, id); }).filter(function (a) { return a.category === "evening" || a.booking; }).forEach(function (a) { toBook.push([a.name, a.booking || a.url, a.phone]); });
    var bookHtml = toBook.length ? "<h2>Reservations to make</h2><table class='book'>" + toBook.map(function (t) { return "<tr><td>" + esc(t[0]) + "</td><td>" + (t[1] ? "<a href='" + t[1] + "'>book online</a>" : "") + "</td><td>" + esc(t[2] || "") + "</td></tr>"; }).join("") + "</table>" : "";

    var html = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Your Roosevelt Country Trip</title>" +
      "<style>" +
      "@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&display=swap');" +
      "body{font-family:Georgia,serif;color:#25282a;max-width:760px;margin:24px auto;padding:0 22px;line-height:1.5;}" +
      "h1{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.02em;color:" + c.secondary + ";font-size:30px;margin:0 0 4px;}" +
      ".facts{font-size:13.5px;color:#4a4d50;margin:0 0 18px;padding:0 0 14px;border-bottom:2px solid " + c.primary + ";}" +
      ".facts div{margin:2px 0;}" +
      "h2{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.05em;font-size:16px;color:" + c.primary + ";margin:22px 0 6px;}" +
      ".day{margin:0 0 12px;break-inside:avoid;}" +
      ".day h3{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.04em;font-size:15px;background:" + c.secondary + ";color:#fff;padding:7px 11px;margin:0;border-radius:4px 4px 0 0;}" +
      ".day h3 .sub{float:right;font-size:11px;color:#9fb3cc;font-weight:400;}" +
      "table{width:100%;border-collapse:collapse;}" +
      ".day table{border:1px solid #e4ddcd;border-top:none;}" +
      ".day td{padding:7px 11px;border-bottom:1px solid #f0ead9;vertical-align:top;}" +
      ".tm{font-family:Oswald,sans-serif;font-weight:600;font-size:12px;color:" + c.primary + ";white-space:nowrap;width:80px;}" +
      ".nm{display:block;font-weight:bold;color:" + c.secondary + ";}" +
      ".ds{display:block;font-size:12px;color:#6c6f72;font-family:Arial,sans-serif;}" +
      ".bk{display:block;font-size:11.5px;font-family:Arial,sans-serif;margin-top:2px;}" +
      ".bk a{color:" + c.primary + ";}" +
      ".free{color:#6c6f72;font-style:italic;}" +
      ".book td{border-bottom:1px solid #eee;padding:5px 8px;font-size:13px;font-family:Arial,sans-serif;}" +
      ".warn{background:#fff4ef;border-left:3px solid " + c.primary + ";padding:8px 12px;font-size:13px;margin:16px 0;}" +
      ".foot{margin-top:22px;font-size:12px;color:#8a8d90;font-family:Arial,sans-serif;border-top:1px solid #e4ddcd;padding-top:10px;}" +
      ".pbtn{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.06em;background:" + c.primary + ";color:#25282a;border:none;padding:11px 20px;border-radius:3px;font-size:13px;font-weight:600;cursor:pointer;}" +
      "@media print{.noprint{display:none;}body{margin:0;}}" +
      "</style></head><body>" +
      "<div class='noprint' style='text-align:right;margin-bottom:10px'><button class='pbtn' onclick='window.print()'>Print / Save as PDF</button></div>" +
      "<h1>" + (S.days ? S.days + "-Day " : "") + "Roosevelt Country Trip</h1>" +
      "<div class='facts'>" + facts.map(function (f) { return "<div>" + f + "</div>"; }).join("") + "</div>" +
      lodgingHtml + "<h2>Day by day</h2>" + rows + overflow + bookHtml +
      "<div class='foot'>Planned with the Theodore Roosevelt Presidential Library trip planner · trlibrary.com/visit · Times and availability are estimates — please confirm when you book.</div>" +
      "</body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ---- go -----------------------------------------------------------------
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // expose for tests
  if (typeof window !== "undefined") window.__TRTP = { state: S, build: buildSchedule, data: D };
})();
