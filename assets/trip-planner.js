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
  // Resolve local image paths (e.g. "assets/img/x.jpg") against the script's own
  // origin so cached photos load correctly even when embedded on another site.
  function imgURL(src) { return src && !/^https?:\/\//.test(src) ? BASE + src : src; }

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
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
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
    months: [],        // months being considered (1-12) — filters activities by season
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
  var STEP_LABELS = ["Interests", "Road trip", "Season", "Medora", "Library", "Coming from", "Getting here", "Dates", "Stay", "Schedule"];

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
    .trtp-card.has-img{padding-top:0;overflow:hidden;}
    .trtp-card .cimg{display:block;width:calc(100% + 30px)!important;max-width:none!important;height:140px;object-fit:cover;margin:-14px -15px 12px -15px;background:#e9e2d2;border-bottom:1px solid #e4ddcd;}
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
    .trtp-overcap{background:#fff4ef;border:1px solid var(--tr-primary);border-left:4px solid var(--tr-primary);border-radius:0 6px 6px 0;padding:13px 16px;font-size:13.5px;color:#8a4a2f;margin:0 0 16px;}
    .trtp-overcap b{color:#6f3115;}
    .trtp-overcap li{margin:3px 0;}
    .trtp-loading{padding:60px 30px;text-align:center;color:var(--tr-secondary);font-family:'Clearface',Georgia,serif;font-size:20px;}
    .trtp-sub-h{font-family:'Clearface',Georgia,serif;font-weight:600;font-size:18px;color:var(--tr-secondary);margin:22px 0 8px;}
    .trtp-field{display:flex;flex-direction:column;gap:6px;margin:4px 0 8px;max-width:280px;}
    .trtp-field label{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:var(--tr-secondary);font-weight:600;}
    .trtp-field input{font:inherit;padding:10px 12px;border:1px solid #d8cfb9;border-radius:4px;background:#fff;}
    .trtp-weather{background:#fff;border:1px solid #e4ddcd;border-radius:6px;padding:15px 18px;margin:16px 0;}
    .trtp-weather h4{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:13px;color:var(--tr-primary);margin:0 0 12px;font-weight:600;}
    .trtp-weather .wmonths{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}
    .trtp-weather .wmo{flex:1;min-width:120px;background:var(--tr-paper);border:1px solid #e4ddcd;border-radius:5px;padding:9px 11px;}
    .trtp-weather .wm{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--tr-secondary);font-weight:600;}
    .trtp-weather .wt{font-family:'Clearface',Georgia,serif;font-size:18px;color:var(--tr-primary);font-weight:600;margin:1px 0;}
    .trtp-weather .wc{font-size:11.5px;color:#6c6f72;line-height:1.35;}
    .trtp-weather .wcols{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
    @media(max-width:560px){.trtp-weather .wcols{grid-template-columns:1fr;}}
    .trtp-weather .wlbl{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:11.5px;color:var(--tr-secondary);font-weight:600;margin-bottom:4px;}
    .trtp-weather .wlist{margin:0;padding-left:17px;}
    .trtp-weather .wlist li{font-size:13px;color:#4a4d50;margin:3px 0;line-height:1.4;}
    .trtp-weather .wnote{font-size:12px;color:#8a8d90;margin-top:10px;font-style:italic;}
    .trtp-rec{background:#092a4d;color:#fff;border-radius:6px;padding:15px 18px;margin:4px 0 16px;}
    .trtp-rec .rt{font-family:'Clearface',Georgia,serif;font-weight:600;font-size:18px;color:#fff;}
    .trtp-rec .rr{font-size:13.5px;color:#cdd8e6;margin-top:3px;}
    .trtp-booking{background:#fff;border:1px solid #e4ddcd;border-left:4px solid var(--tr-primary);border-radius:0 6px 6px 0;padding:14px 18px;margin:0 0 18px;}
    .trtp-booking h4{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:13px;color:var(--tr-primary);margin:0 0 10px;font-weight:600;}
    .trtp-book-row{padding:8px 0;border-bottom:1px dashed #e4ddcd;}
    .trtp-book-row:last-child{border-bottom:none;}
    .trtp-book-row .bcity{font-family:'Clearface',Georgia,serif;font-weight:600;font-size:16px;color:var(--tr-secondary);}
    .trtp-book-row .bdet{font-family:Oswald,sans-serif;letter-spacing:.04em;font-size:12.5px;color:var(--tr-primary);margin-top:1px;}
    .trtp-book-row .bwhy{font-size:12.5px;color:#6c6f72;margin-top:2px;}
    .trtp-day{background:#fff;border:1px solid #e4ddcd;border-radius:6px;padding:0;margin:0 0 14px;overflow:hidden;}
    .trtp-day-head{background:var(--tr-secondary);color:#fff;padding:11px 16px;display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;}
    .trtp-day-head .dt{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-size:14px;}
    .trtp-day-head .sd{font-size:12px;color:#9fb3cc;}
    .trtp-row{display:flex;gap:12px;padding:11px 16px;border-bottom:1px solid #f0ead9;}
    .trtp-row:last-child{border-bottom:none;}
    .trtp-row .tm{font-family:Oswald,sans-serif;font-weight:600;font-size:12.5px;color:var(--tr-primary);min-width:74px;white-space:nowrap;padding-top:1px;}
    .trtp-row .rthumb{width:60px;height:46px;object-fit:cover;border-radius:4px;flex:0 0 auto;background:#e9e2d2;}
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
    .trtp-months{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 8px;}
    .trtp-chip{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.05em;font-size:13px;font-weight:600;
      padding:9px 16px;border:1px solid #d8cfb9;border-radius:20px;background:#fff;color:var(--tr-secondary);cursor:pointer;transition:all .12s;}
    .trtp-chip:hover{border-color:var(--tr-muted);transform:translateY(-1px);}
    .trtp-chip.on{background:var(--tr-primary);border-color:var(--tr-primary);color:#25282a;}
    @media print{.trtp-side,.trtp-nav,.trtp-steps{display:none !important;}.trtp-wrap{grid-template-columns:1fr;}}
    `;
    document.head.appendChild(el("style", { id: "trtp-style", html: css }));
  }

  // ---- boot ---------------------------------------------------------------
  function boot() {
    var host = document.getElementById(CONTAINER_ID);
    if (!host) { console.warn("[TRTP] container #" + CONTAINER_ID + " not found"); return; }
    host.innerHTML = '<div class="trtp-loading">Saddling up your trip planner…</div>';
    var files = ["config", "origins", "airports", "destinations", "lodging", "medora", "itineraries", "library", "events", "weather"];
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
  // Browse filter: is this item open in any of the months the guest is considering?
  function monthsBrowseOk(avail) {
    if (!S.months.length) return true;
    if (!avail || !avail.season) return true;
    return S.months.some(function (m) { return m >= avail.season[0] && m <= avail.season[1]; });
  }

  // ---- weather & packing --------------------------------------------------
  // Months the trip actually touches. Exact dates win (span start..start+days),
  // so we don't show a broad 3-month range once real dates are chosen.
  function tripMonths() {
    if (S.startDate) {
      var p = S.startDate.split("-"), start = new Date(+p[0], +p[1] - 1, +p[2]);
      var days = S.days || 1, set = {};
      for (var i = 0; i < days; i++) { var d = new Date(start.getTime()); d.setDate(d.getDate() + i); set[d.getMonth() + 1] = 1; }
      return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    }
    if (S.months.length) return S.months.slice().sort(function (a, b) { return a - b; });
    return [];
  }
  function tripDateRangeLabel() {
    if (!S.startDate) return null;
    var p = S.startDate.split("-"), start = new Date(+p[0], +p[1] - 1, +p[2]);
    var end = new Date(start.getTime()); end.setDate(end.getDate() + Math.max(0, (S.days || 1) - 1));
    return fmtD(start) + (S.days > 1 ? " – " + fmtD(end) : "");
  }
  function seasonOfMonth(m) { if (m >= 6 && m <= 8) return "summer"; if (m === 4 || m === 5) return "spring"; if (m === 9 || m === 10) return "fall"; return "winter"; }
  function weatherInfo() {
    var W = D.weather, ms = tripMonths();
    if (!ms.length) return null;
    var rows = ms.map(function (m) { return W.months[m - 1]; });
    var seasons = uniq(ms.map(seasonOfMonth));
    var pack = [], prepare = [];
    seasons.forEach(function (s) {
      (W.seasons[s].pack || []).forEach(function (p) { if (pack.indexOf(p) < 0) pack.push(p); });
      (W.seasons[s].prepare || []).forEach(function (p) { if (prepare.indexOf(p) < 0) prepare.push(p); });
    });
    return { rows: rows, seasons: seasons.map(function (s) { return W.seasons[s].label; }), pack: pack, prepare: prepare };
  }
  function renderWeather(m) {
    var w = weatherInfo();
    var box = el("div", { class: "trtp-weather" });
    var rangeLabel = tripDateRangeLabel();
    box.appendChild(el("h4", { text: "Typical weather & what to pack" + (rangeLabel ? " · " + rangeLabel : "") }));
    if (!w) { box.appendChild(el("div", { class: "wnote", html: "Pick the month(s) you're considering on the <b>Season</b> step and we'll show typical Badlands weather and a tailored packing list." })); m.appendChild(box); return; }
    var strip = el("div", { class: "wmonths" });
    w.rows.forEach(function (r) {
      strip.appendChild(el("div", { class: "wmo" }, [
        el("div", { class: "wm", text: MON[r.m - 1] }),
        el("div", { class: "wt", html: r.hi + "&deg; / " + r.lo + "&deg;F" }),
        el("div", { class: "wc", text: r.note })
      ]));
    });
    box.appendChild(strip);
    var cols = el("div", { class: "wcols" });
    var packCol = el("div", {}); packCol.appendChild(el("div", { class: "wlbl", text: "Pack" }));
    var pl = el("ul", { class: "wlist" }); w.pack.forEach(function (p) { pl.appendChild(el("li", { text: p })); }); packCol.appendChild(pl);
    var prepCol = el("div", {}); prepCol.appendChild(el("div", { class: "wlbl", text: "Prepare for" }));
    var rl = el("ul", { class: "wlist" }); w.prepare.forEach(function (p) { rl.appendChild(el("li", { text: p })); }); prepCol.appendChild(rl);
    cols.appendChild(packCol); cols.appendChild(prepCol);
    box.appendChild(cols);
    box.appendChild(el("div", { class: "wnote", text: "Typical averages for planning — check a forecast close to your trip." }));
    m.appendChild(box);
  }
  function toggle(bucket, id) { var a = S.picks[bucket]; var i = a.indexOf(id); if (i > -1) a.splice(i, 1); else a.push(id); render(); }
  // Lodging is a base decision: a nearby drive-in town and in-Medora stays are
  // mutually exclusive, and only one base town can be chosen at a time.
  function toggleLodging(id) {
    var l = byId(D.lodging.lodging, id), arr = S.picks.lodging, i = arr.indexOf(id);
    if (i > -1) { arr.splice(i, 1); render(); return; }
    if (l.nearbyBase) { S.picks.lodging = [id]; }             // one base, replaces any Medora/base pick
    else { S.picks.lodging = arr.filter(function (x) { var o = byId(D.lodging.lodging, x); return o && !o.nearbyBase; }); S.picks.lodging.push(id); }
    render();
  }
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
  function goto(i) { S.step = i; if (i > S.maxStep) S.maxStep = i; render(); scrollToTop(); }
  function scrollToTop() {
    var host = document.getElementById(CONTAINER_ID);
    if (!host) return;
    try {
      var top = host.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop || 0);
      window.scrollTo({ top: Math.max(0, top - 12), behavior: "smooth" });
    } catch (e) { if (host.scrollIntoView) host.scrollIntoView(); }
  }
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
      var img = null;
      if (it.image) {
        img = el("img", { class: "cimg", src: imgURL(it.image), alt: it[opts.title || "name"], loading: "lazy" });
        // hide gracefully if the photo fails to load
        img.addEventListener("error", function () { if (img.parentNode) img.parentNode.removeChild(img); });
      }
      grid.appendChild(el("button", {
        class: "trtp-card" + (img ? " has-img" : "") + (sel ? " sel" : "") + (dis ? " dis" : ""), type: "button",
        onclick: function () { opts.onclick(it); }
      }, [
        img,
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
      // 0 Interests (lead)
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Plan your visit" }));
          m.appendChild(el("h1", { class: "trtp-h display", text: "What do you want to see and do?" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "The Library sits in the middle of the best road-trip country in America. Start with what draws you — we'll surface the best stops, then sort out how you get here and lay it all into a dated, hour-by-hour plan you can print and book. Pick anything that sounds like you." }));
          cardGrid(m, D.config.travelStyles, {
            title: "label", selected: function (s) { return S.styles.indexOf(s.id) > -1; },
            onclick: function (s) { var i = S.styles.indexOf(s.id); if (i > -1) S.styles.splice(i, 1); else S.styles.push(s.id); render(); }
          });
        },
        canAdvance: function () { return true; }, nextLabel: "Build my road trip →"
      },

      // 1 Road trip
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "The ultimate road trip" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Add stops you want to see" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "National parks, monuments, great Western towns and state parks within reach of Medora. Pick the ones you want — regional stops become their own day trips in your schedule." }));
          var items = D.destinations.destinations.filter(function (d) { return matchesStyle(d.tags); }).sort(function (a, b) { return a.milesFromMedora - b.milesFromMedora; });
          var tl = { national_park: "National Park", national_monument: "National Monument", state_park: "State Park", town: "Western Town", cultural: "History & Culture", scenic: "Scenic" };
          cardGrid(m, items, {
            wide: true, selected: function (d) { return isPicked("route", d.id); },
            blurb: function (d) { return d.blurb; },
            meta: function (d) { return tl[d.type] + " · " + (d.milesFromMedora <= 1 ? "in Medora" : d.milesFromMedora + " mi · ~" + Math.round(d.duration / 60) + "h"); },
            onclick: function (d) { toggle("route", d.id); }
          });
        },
        canAdvance: function () { return true; }, nextLabel: "Plan my Medora day →"
      },

      // 2 Season / months
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Time of year" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Which months are you considering?" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "Medora is seasonal — the Musical, trail rides, tours and many shops run summer only, while the Badlands and the Library are open far wider. Pick the month(s) you might visit and we'll show only what's actually running. Not sure yet? Skip it and we'll show everything." }));
          var chips = el("div", { class: "trtp-months" });
          for (var i = 1; i <= 12; i++) (function (mo) {
            chips.appendChild(el("button", {
              class: "trtp-chip" + (S.months.indexOf(mo) > -1 ? " on" : ""), type: "button",
              onclick: function () { var k = S.months.indexOf(mo); if (k > -1) S.months.splice(k, 1); else S.months.push(mo); render(); }
            }, [MON[mo - 1]]));
          })(i);
          m.appendChild(chips);
          if (S.months.length) {
            var openCount = D.medora.attractions.filter(function (a) { return monthsBrowseOk(a.avail); }).length;
            var seasonalHidden = D.medora.attractions.length - openCount;
            m.appendChild(el("div", { class: "trtp-note", text: "Showing what's open in " + S.months.slice().sort(function (a, b) { return a - b; }).map(function (x) { return MON[x - 1]; }).join(", ") + "." + (seasonalHidden > 0 ? " " + seasonalHidden + " seasonal option(s) will be hidden on the next step." : "") }));
            var wi = weatherInfo();
            if (wi) m.appendChild(el("div", { class: "trtp-note", html: "<b>Typical weather:</b> " + wi.rows.map(function (r) { return MON[r.m - 1] + " " + r.hi + "&deg;/" + r.lo + "&deg;F"; }).join(", ") + ". You'll get a full packing list with your finished plan." }));
          }
        },
        canAdvance: function () { return true; }, nextLabel: "Build my Medora day →"
      },

      // 3 Medora day
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Your day in Medora" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Build your Medora day" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "The Badlands that shaped Roosevelt and a town that still runs on Western hospitality. Click what you want to do, see, eat and watch — we'll slot each into your schedule at the right time." }));
          if (S.months.length) m.appendChild(el("div", { class: "trtp-note", html: "Filtered to what's open in <b>" + S.months.slice().sort(function (a, b) { return a - b; }).map(function (x) { return MON[x - 1]; }).join(", ") + "</b>. <a href='#' onclick='return false' style='color:var(--tr-primary)'>Change months on the Season step ↑</a>" }));
          var groups = [{ key: "attraction", label: "See & do" }, { key: "recreation", label: "Outdoors & recreation" }, { key: "tour", label: "Guided tours & rides" }, { key: "evening", label: "Shows & evenings" }, { key: "dining", label: "Where to eat" }, { key: "shopping", label: "Where to shop" }, { key: "event", label: "Festivals & special events" }];
          groups.forEach(function (g) {
            var items = D.medora.attractions.filter(function (a) { return a.category === g.key && monthsBrowseOk(a.avail); });
            if (!items.length) return;
            m.appendChild(el("div", { class: "trtp-sub-h", text: g.label }));
            cardGrid(m, items, {
              wide: g.key === "attraction" || g.key === "evening" || g.key === "tour" || g.key === "event" || g.key === "recreation",
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

      // 3 Library
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
        canAdvance: function () { return true; }, nextLabel: "Where are you coming from? →"
      },

      // 4 Coming from (origin)
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Getting you here" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Where are you coming from?" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "Now the logistics. Tell us your starting point and we'll work out the best way in — and build the drive (or flight plus airport drive) right into your schedule." }));
          cardGrid(m, D.origins.origins, {
            title: "label", selected: function (o) { return S.origin && S.origin.id === o.id; },
            meta: function (o) { return o.driveHours ? o.driveHours + " hrs · " + o.distanceMiles + " mi" : "Flying in"; },
            onclick: function (o) { S.origin = o; if (!S.airport) S.airport = o.nearestAirport; if (o.arrival !== "either" && !S.arrival) S.arrival = o.arrival; render(); }
          });
        },
        canAdvance: function () { return !!S.origin; }
      },

      // 5 Getting here
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Getting here" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "How will you get to Medora?" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "Medora is closer than most people think. Driving, or flying into a regional airport and renting a car — including flying into one airport and out of another when that saves backtracking." }));
          var rec = recommendAirports();
          // Recommendation banner with a one-click apply (fully overridable below)
          var recBox = el("div", { class: "trtp-rec" });
          var recTitle = rec.open ? ("Fly into " + rec.entry.code + ", out of " + rec.exit.code) : ("Fly in & out of " + rec.entry.code);
          recBox.appendChild(el("div", { class: "rt", text: "Our airport pick: " + recTitle }));
          recBox.appendChild(el("div", { class: "rr", text: rec.reason + "." + (rec.open ? " One-way rental with " + rec.shared[0] + "." : "") }));
          recBox.appendChild(el("button", {
            class: "trtp-btn primary", style: "margin-top:10px;padding:9px 16px;font-size:12px",
            onclick: function () {
              S.arrival = "air"; S.airport = rec.entry.code; S.diffReturn = rec.open; S.airportOut = rec.open ? rec.exit.code : null;
              var opts = rentalOptions(); if (rec.open && rec.shared) S.rental = rec.shared[0]; else if (S.rental && opts.indexOf(S.rental) < 0) S.rental = null;
              render();
            }
          }, ["Use these airports"]));
          m.appendChild(recBox);

          cardGrid(m, [
            { id: "car", name: "Driving", note: S.origin && S.origin.driveHours ? ("About " + S.origin.driveHours + " hours from " + S.origin.label) : "Your own vehicle, all the flexibility" },
            { id: "air", name: "Flying + rental car", note: "Fly into a regional airport, drive the rest" }
          ], {
            selected: function (o) { return S.arrival === o.id; }, blurb: function (o) { return o.note; },
            onclick: function (o) {
              S.arrival = o.id;
              // Choosing "Flying" for the first time pre-fills our recommendation (still overridable)
              if (o.id === "air" && !S.airport) { S.airport = rec.entry.code; S.diffReturn = rec.open; S.airportOut = rec.open ? rec.exit.code : null; if (rec.open && rec.shared) S.rental = rec.shared[0]; }
              render();
            }
          });

          if (S.arrival === "air") {
            var aps = D.airports.airports.slice().sort(function (a, b) { return a.driveToMedoraMin - b.driveToMedoraMin; });
            m.appendChild(el("div", { class: "trtp-sub-h", text: "Fly into" }));
            cardGrid(m, aps, {
              wide: true, selected: function (a) { return S.airport === a.code; },
              blurb: function (a) { return a.note; },
              meta: function (a) { return a.code + " · " + a.driveToMedoraMin + " min / " + a.driveToMedoraMiles + " mi to Medora" + (rec.entry.code === a.code ? " · ★ recommended in" : ""); },
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
                meta: function (a) { return a.code + " · " + a.driveToMedoraMin + " min to Medora" + (rec.open && rec.exit.code === a.code ? " · ★ recommended out" : ""); },
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

      // 6 Dates + days + pace
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "When & how long" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Your dates and pace" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "Tell us when you're arriving and how many days you have. An arrival date lets us line up tours and shows on the exact days they actually run, and time your drive." }));
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
        canAdvance: function () { return !!S.days; }, nextLabel: "Pick where you'll stay →"
      },

      // 7 Lodging
      {
        render: function (m) {
          m.appendChild(el("p", { class: "trtp-kicker", text: "Where you'll stay" }));
          m.appendChild(el("h1", { class: "trtp-h", text: "Pick your level of comfort" }));
          m.appendChild(el("p", { class: "trtp-sub", text: "This is your base in Medora for the whole visit. Pick a comfort level and we'll show the right in-town stays. (For any national parks on your route, we'll tell you which town to overnight in on your schedule — no need to pick those here.)" }));
          cardGrid(m, D.config.comfortTiers, {
            title: "label", selected: function (t) { return S.tier === t.id; }, blurb: function (t) { return t.blurb; }, meta: function (t) { return t.priceHint; },
            onclick: function (t) { S.tier = t.id; render(); }
          });
          if (S.tier) {
            var baseChosen = D.lodging.lodging.filter(function (l) { return l.nearbyBase && isPicked("lodging", l.id); })[0];
            var stays = D.lodging.lodging.filter(function (l) { return !l.nearbyBase && l.area === "Medora" && l.tier === S.tier; });
            m.appendChild(el("div", { class: "trtp-sub-h", text: S.tier === "camp" ? "Camping & RV in Medora" : "Places to stay in Medora" }));
            cardGrid(m, stays, {
              wide: true, selected: function (l) { return isPicked("lodging", l.id); },
              blurb: function (l) { return l.blurb; },
              meta: function (l) { return (l.season ? MON[l.season[0] - 1] + "–" + MON[l.season[1] - 1] : "Year-round") + (l.priceHint ? " · " + l.priceHint : ""); },
              onclick: function (l) { toggleLodging(l.id); }
            });
            // Nearby drive-in bases — pick one INSTEAD of a Medora stay (mutually exclusive)
            var bases = D.lodging.lodging.filter(function (l) { return l.nearbyBase; });
            var summer = S.months.some(function (mo) { return mo >= 6 && mo <= 8; });
            m.appendChild(el("div", { class: "trtp-sub-h", text: "Or stay nearby and drive in" }));
            m.appendChild(el("div", { class: summer ? "trtp-warn" : "trtp-note", html: (summer ? "<b>Heads up:</b> " : "") + "Medora books up fast and gets pricey in summer. These towns are a short drive on I-94 and often have more rooms for less — pick one to base your Medora days there <b>instead of</b> a Medora hotel." }));
            cardGrid(m, bases, {
              wide: true, selected: function (l) { return isPicked("lodging", l.id); },
              blurb: function (l) { return l.blurb; },
              meta: function (l) { return l.driveMin + " min / " + l.driveMiles + " mi to Medora" + (l.priceHint ? " · " + l.priceHint : ""); },
              onclick: function (l) { toggleLodging(l.id); }
            });
            // Real hotels in the chosen base town
            if (baseChosen && baseChosen.hotels) {
              m.appendChild(el("div", { class: "trtp-sub-h", text: "Hotels in " + baseChosen.name }));
              var hl = el("div", { class: "trtp-note" });
              hl.innerHTML = baseChosen.hotels.map(function (h) { return "<div style='margin:3px 0'>• <a href='" + h.search + "' target='_blank' rel='noopener'>" + h.name + " ↗</a></div>"; }).join("") + (baseChosen.bookingSearch ? "<div style='margin-top:6px'><a href='" + baseChosen.bookingSearch + "' target='_blank' rel='noopener'>See all " + baseChosen.name + " hotels ↗</a></div>" : "");
              m.appendChild(hl);
            }
          }
        },
        canAdvance: function () { return !!S.tier; }, nextLabel: "See my day-by-day schedule →"
      },

      // 8 Schedule
      { render: function (m) { renderSchedule(m); }, canAdvance: function () { return true; } }
    ];
  }

  // Recommend the best fly-in / fly-out airports for the chosen far stops.
  // Considers every airport pair, models the drive as entry → far stops → Medora →
  // far stops → exit (nearest-neighbour), and prefers an open-jaw (different in/out)
  // only when it meaningfully beats the best round-trip AND a rental serves both.
  function recommendAirports() {
    var M = D.config.brand.anchor, aps = D.airports.airports;
    var far = S.picks.route.map(function (id) { return byId(D.destinations.destinations, id); })
      .filter(function (d) { return d && d.milesFromMedora > NEAR_MI && d.lat != null; });

    if (!far.length) {
      var near = aps.slice().sort(function (a, b) { return a.driveToMedoraMin - b.driveToMedoraMin; })[0];
      return { entry: near, exit: near, open: false, reason: "you're focused on Medora, so the closest airport (" + near.code + ") in and out is simplest" };
    }
    function chain(sLat, sLng, stops, eLat, eLng) {
      var cur = { lat: sLat, lng: sLng }, rem = stops.slice(), total = 0;
      while (rem.length) {
        var bi = 0, bd = Infinity;
        rem.forEach(function (s, i) { var dd = haversine(cur.lat, cur.lng, s.lat, s.lng); if (dd < bd) { bd = dd; bi = i; } });
        total += bd; cur = { lat: rem[bi].lat, lng: rem[bi].lng }; rem.splice(bi, 1);
      }
      return total + haversine(cur.lat, cur.lng, eLat, eLng);
    }
    function cost(A, B) {
      var inb = [], outb = [];
      far.forEach(function (f) { var da = haversine(f.lat, f.lng, A.lat, A.lng), db = haversine(f.lat, f.lng, B.lat, B.lng); (da <= db ? inb : outb).push(f); });
      return chain(A.lat, A.lng, inb, M.lat, M.lng) + chain(M.lat, M.lng, outb, B.lat, B.lng);
    }
    var bestRound = null, bestOpen = null;
    aps.forEach(function (A) {
      var c = cost(A, A);
      if (!bestRound || c < bestRound.cost) bestRound = { entry: A, exit: A, cost: c };
      aps.forEach(function (B) {
        if (A.code === B.code) return;
        var shared = A.rentalCars.filter(function (r) { return B.rentalCars.indexOf(r) > -1; });
        if (!shared.length) return;
        var co = cost(A, B);
        if (!bestOpen || co < bestOpen.cost) bestOpen = { entry: A, exit: B, cost: co, shared: shared };
      });
    });
    var SAVE = 120; // miles of backtracking saved to justify a one-way rental
    if (bestOpen && bestOpen.cost + SAVE < bestRound.cost) {
      return { entry: bestOpen.entry, exit: bestOpen.exit, open: true, shared: bestOpen.shared,
        reason: "your stops line up across the region — flying into " + bestOpen.entry.code + " and out of " + bestOpen.exit.code + " saves roughly " + Math.round((bestRound.cost - bestOpen.cost) / 10) * 10 + " miles of backtracking" };
    }
    return { entry: bestRound.entry, exit: bestRound.exit, open: false,
      reason: "a round trip through " + bestRound.entry.code + " covers your stops with the least driving" };
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
  function normLib(o) { return { id: o.id, name: o.name, duration: o.duration || 0, avail: o.avail || {}, phone: o.phone, booking: o.booking, image: o.image, area: "library", where: "Theodore Roosevelt Presidential Library", price: o.price, priceLabel: o.priceLabel, kind: o.kind }; }
  function normMed(a) { return { id: a.id, name: a.name, duration: a.duration || 60, avail: a.avail || {}, phone: a.phone, booking: a.booking || a.url, image: a.image, area: "medora", where: "Medora", category: a.category, meal: a.meal, kind: a.category }; }
  function normDest(d) { return { id: d.id, name: d.name, duration: d.duration || 180, avail: d.avail || {}, phone: d.phone, booking: d.booking || d.url, image: d.image, miles: d.milesFromMedora, lat: d.lat, lng: d.lng, overnight: d.overnight || null, visitDays: d.visitDays || 1, kind: "destination" }; }

  // ---- routing helpers ----------------------------------------------------
  var NEAR_MI = 110;          // stops within this range are day-trips from Medora; beyond it, en-route legs
  function haversine(aLat, aLng, bLat, bLng) {
    if (aLat == null || bLat == null) return null;
    var R = 3959, toR = Math.PI / 180;
    var dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR, la1 = aLat * toR, la2 = bLat * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h)) * 1.15; // ×1.15 straight-line → road fudge
  }
  function driveHrs(mi) { return Math.max(1, Math.round((mi || 0) / 60)); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function fmtD(d) { return MON[d.getMonth()] + " " + d.getDate(); }
  function entryPoint() {
    if (S.arrival === "air" && S.airport) { var a = airport(S.airport); return { lat: a.lat, lng: a.lng, label: a.name.replace(/ –.*/, ""), code: a.code, air: true }; }
    if (S.origin && S.origin.lat != null) return { lat: S.origin.lat, lng: S.origin.lng, label: S.origin.label, air: false };
    return null;
  }
  function exitPoint() {
    if (S.arrival === "air") { var a = airport(S.diffReturn && S.airportOut ? S.airportOut : S.airport); return a ? { lat: a.lat, lng: a.lng, label: a.name.replace(/ –.*/, ""), code: a.code, air: true } : null; }
    if (S.origin && S.origin.lat != null) return { lat: S.origin.lat, lng: S.origin.lng, label: S.origin.label, air: false };
    return null;
  }
  function baseDriveMin(city) { var b = null; D.lodging.lodging.forEach(function (l) { if (l.nearbyBase && (l.name === city || l.area === city)) b = l; }); return b ? b.driveMin : 30; }

  // Season check: use the exact-date month when known, otherwise fall back to the
  // months the guest is considering (so seasonal items still get filtered sensibly).
  function seasonOk(av, month) {
    if (!av || !av.season) return true;
    var months = month != null ? [month] : (S.months.length ? S.months : null);
    if (!months) return true;
    return months.some(function (m) { return m >= av.season[0] && m <= av.season[1]; });
  }
  function fixedWindowFor(av, wd) { if (!av || !av.fixed) return null; if (wd == null) return av.fixed[0]; for (var i = 0; i < av.fixed.length; i++) if (av.fixed[i].days.indexOf(wd) > -1) return av.fixed[i]; return null; }
  function dayOk(av, wd) { if (!av) return true; if (av.fixed) return fixedWindowFor(av, wd) != null; if (av.days && wd != null) return av.days.indexOf(wd) > -1; return true; }

  function buildSchedule() {
    var lib = S.picks.library.map(function (id) { return libItem(id); }).filter(Boolean).map(normLib).filter(function (x) { return x.duration > 0 || x.kind === "tour" || x.kind === "admission"; });
    var med = S.picks.medora.map(function (id) { return byId(D.medora.attractions, id); }).filter(Boolean).map(normMed);
    var dest = S.picks.route.map(function (id) { return byId(D.destinations.destinations, id); }).filter(Boolean).map(normDest);
    var near = dest.filter(function (d) { return d.miles <= NEAR_MI; });
    var far = dest.filter(function (d) { return d.miles > NEAR_MI; });
    // near stops fold into the Medora block as day trips (visit + round-trip drive)
    var nearLocal = near.map(function (n) { var rt = driveHrs(n.miles) * 2 * 60; return { id: n.id, name: n.name, duration: n.duration + rt, avail: n.avail, phone: n.phone, booking: n.booking, image: n.image, kind: "daytrip", miles: n.miles }; });
    var local = lib.concat(med, nearLocal);
    var overflow = [];

    // classify far stops into inbound vs outbound relative to the entry/exit airports
    var entry = entryPoint(), exit = exitPoint(), MEDORA = D.config.brand.anchor;
    far.forEach(function (f) {
      f._dEntry = entry ? haversine(f.lat, f.lng, entry.lat, entry.lng) : f.miles;
      f._dExit = exit ? haversine(f.lat, f.lng, exit.lat, exit.lng) : f.miles;
    });
    var inbound = far.filter(function (f) { return f._dEntry <= f._dExit; }).sort(function (a, b) { return a._dEntry - b._dEntry; });
    var outbound = far.filter(function (f) { return f._dEntry > f._dExit; }).sort(function (a, b) { return a.miles - b.miles; });

    // which town are we based in for the Medora block? (a nearby drive-in base, or Medora itself)
    var baseLodge = null; S.picks.lodging.forEach(function (id) { var l = byId(D.lodging.lodging, id); if (l && l.nearbyBase) baseLodge = l; });
    var medoraBase = baseLodge ? baseLodge.name : "Medora";

    // Medora nights from the local activity load at the chosen pace (min 1)
    var budget = PACE[S.pace] || 480;
    var totalLocal = local.reduce(function (s, i) { return s + i.duration; }, 0);
    var medoraDays = Math.max(local.length ? 1 : (far.length ? 0 : 1), Math.ceil(totalLocal / budget));
    if (medoraDays < 1 && !far.length) medoraDays = 1;

    // --- Respect the day budget. If the picks need more days than the guest has,
    //     trim the farthest stops first, then shrink the Medora block (min 1),
    //     and report what we cut so the schedule step can guide them. ---
    function legDayCount() { return inbound.reduce(function (s, f) { return s + f.visitDays; }, 0) + outbound.reduce(function (s, f) { return s + f.visitDays; }, 0); }
    var medoraNeeded = medoraDays;
    var requiredDays = legDayCount() + medoraDays;
    var trimmedFar = [];
    if (S.days && requiredDays > S.days) {
      while (legDayCount() + Math.max(1, medoraDays) > S.days && (inbound.length || outbound.length)) {
        var pool = inbound.concat(outbound).sort(function (a, b) { return b.miles - a.miles; });
        var victim = pool[0];
        trimmedFar.push(victim);
        var io = inbound.indexOf(victim); if (io > -1) inbound.splice(io, 1); else outbound.splice(outbound.indexOf(victim), 1);
      }
      var legs = legDayCount();
      if (legs + medoraDays > S.days) medoraDays = Math.max(1, S.days - legs);
    }
    trimmedFar.forEach(function (f) { overflow.push({ item: f, reason: "would add " + f.visitDays + " day" + (f.visitDays > 1 ? "s" : "") + " beyond your " + S.days + "-day window — add days or drop another stop" }); });

    // Build the ordered plan: inbound legs → contiguous Medora block → outbound legs
    var plan = [];
    inbound.forEach(function (f) { for (var k = 0; k < f.visitDays; k++) plan.push({ kind: "leg", dir: "in", stop: f, baseCity: f.overnight ? f.overnight.city : null, contd: k > 0, lastOfStop: k === f.visitDays - 1 }); });
    for (var i = 0; i < medoraDays; i++) plan.push({ kind: "medora", baseCity: medoraBase, firstMedora: i === 0, lastMedora: i === medoraDays - 1 });
    outbound.forEach(function (f) { for (var k = 0; k < f.visitDays; k++) plan.push({ kind: "leg", dir: "out", stop: f, baseCity: f.overnight ? f.overnight.city : null, contd: k > 0, lastOfStop: k === f.visitDays - 1 }); });
    if (!plan.length) plan.push({ kind: "medora", baseCity: medoraBase, firstMedora: true, lastMedora: true });

    var days = plan.map(function (p, idx) { var dt = dateForDay(idx); return { index: idx, date: dt, wd: dt ? dt.getDay() : null, month: dt ? dt.getMonth() + 1 : null, kind: p.kind, dir: p.dir, stop: p.stop, baseCity: p.baseCity, firstMedora: p.firstMedora, lastMedora: p.lastMedora, contd: p.contd, lastOfStop: p.lastOfStop, items: [], entries: [], notes: [] }; });
    var N = days.length;
    var medoraDayObjs = days.filter(function (d) { return d.kind === "medora"; });

    // Assign local items across the Medora block (season + weekday + budget aware)
    var commute = medoraBase !== "Medora" ? 2 * baseDriveMin(medoraBase) : 0;
    medoraDayObjs.forEach(function (d) { d.used = commute; });
    local.sort(function (a, b) { var af = a.avail.fixed ? 0 : 1, bf = b.avail.fixed ? 0 : 1; return af - bf || (b.duration - a.duration); });
    local.forEach(function (it) {
      var best = null;
      for (var j = 0; j < medoraDayObjs.length; j++) {
        var d = medoraDayObjs[j];
        if (!seasonOk(it.avail, d.month)) continue;
        if (!dayOk(it.avail, d.wd)) continue;
        if (it.avail.fixed && conflictsFixed(d, it)) continue;
        if (d.used + it.duration > budget + 90) continue;
        if (!best || d.used < best.used) best = d;
      }
      if (best) { best.items.push(it); best.used += it.duration; }
      else overflow.push({ item: it, reason: reasonUnfit(it, medoraDayObjs) });
    });

    // Routing pass: chain drive segments entry → legs → Medora → legs → exit
    var prev = entry;
    days.forEach(function (d) {
      if (d.kind === "leg") {
        if (!d.contd && prev) { d._driveInMi = haversine(prev.lat, prev.lng, d.stop.lat, d.stop.lng); d._driveFrom = prev.label; }
        if (!d.contd) prev = { lat: d.stop.lat, lng: d.stop.lng, label: d.baseCity || d.stop.name };
      } else if (d.kind === "medora" && d.firstMedora) {
        if (prev) { d._driveInMi = haversine(prev.lat, prev.lng, MEDORA.lat, MEDORA.lng); d._driveFrom = prev.label; }
        prev = { lat: MEDORA.lat, lng: MEDORA.lng, label: "Medora" };
      }
    });
    if (entry && entry.air) days[0]._arriveAir = entry;
    if (exit && prev) { var last = days[N - 1]; last._exit = { to: exit.label, code: exit.code, air: exit.air, driveMi: haversine(prev.lat, prev.lng, exit.lat, exit.lng) }; }

    days.forEach(function (d) { layoutDay(d); });
    var booking = buildBooking(days);
    var capacity = {
      setDays: S.days || null, requiredDays: requiredDays, plannedDays: N,
      trimmedFar: trimmedFar.map(function (f) { return f.name; }),
      medoraNeeded: medoraNeeded, medoraShown: medoraDayObjs.length,
      over: !!(S.days && requiredDays > S.days),
      spare: !!(S.days && N < S.days)
    };
    return { days: days, overflow: overflow, booking: booking, medoraDays: medoraDayObjs.length, medoraBase: medoraBase, capacity: capacity };
  }

  // Group consecutive same-city days into lodging bookings (the Medora block is contiguous).
  function buildBooking(days) {
    var groups = [];
    days.forEach(function (d) {
      var city = d.kind === "medora" ? d.baseCity : d.baseCity;
      if (!city) return;
      var last = groups[groups.length - 1];
      if (last && last.city === city && last.kind === d.kind) last.days.push(d);
      else groups.push({ city: city, kind: d.kind, days: [d] });
    });
    return groups.map(function (g) {
      var nights = g.days.length, ci = g.days[0].date, co = ci ? addDays(ci, nights) : null;
      var stops = uniq(g.days.filter(function (d) { return d.stop; }).map(function (d) { return d.stop.name; }));
      return { city: g.city, kind: g.kind, nights: nights, checkIn: ci, checkOut: co, stops: stops };
    });
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
    var cursor = 9 * 60, limit = 22 * 60;
    // flight arrival on the very first day
    if (day._arriveAir) { entries.push({ start: 11 * 60, dur: 60, name: "Arrive at " + day._arriveAir.label + " (" + day._arriveAir.code + ")", ds: "Land and pick up your " + (S.rental || "rental") + " car" }); cursor = 12 * 60 + 15; }
    // drive to reach this day's place (from the previous overnight / airport / home)
    if (day._driveInMi != null) {
      var h = driveHrs(day._driveInMi), sd = Math.max(cursor, 8 * 60);
      var dn = day.kind === "medora" ? "Medora" : day.stop.name.replace(/ \(.*\)/, "");
      entries.push({ start: sd, dur: h * 60, drive: true, name: "Drive to " + dn, ds: "~" + h + "h from " + day._driveFrom });
      cursor = sd + h * 60 + 15;
    }

    if (day.kind === "leg") {
      var s = day.stop;
      entries.push({ start: Math.max(cursor, 9 * 60), dur: s.duration, name: s.name + (day.contd ? " (continued)" : ""), ds: day.contd ? "A second day to explore" : "Explore (~" + Math.round(s.duration / 60) + "h)", booking: s.booking, phone: s.phone, image: s.image });
      cursor = Math.max(cursor, 9 * 60) + s.duration + 15;
      if (day.baseCity) day.notes.push("Overnight in " + day.baseCity);
    } else if (day.kind === "medora") {
      if (day.baseCity && day.baseCity !== "Medora") { var bd = baseDriveMin(day.baseCity); entries.push({ start: cursor, dur: bd, drive: true, name: "Drive into Medora from " + day.baseCity, ds: "~" + durLabel(bd) }); cursor += bd + 10; }
      var anchors = day.items.filter(function (i) { return i.avail.fixed; }).map(function (i) { var w = fixedWindowFor(i.avail, day.wd); return { it: i, start: hmToMin(w.start), end: hmToMin(w.end) }; }).sort(function (a, b) { return a.start - b.start; });
      var flex = day.items.filter(function (i) { return !i.avail.fixed; });
      var order = { breakfast: 0, attraction: 1, destination: 1, daytrip: 1, recreation: 1, tour: 1, admission: 1, lunch: 2, shopping: 3, event: 4, dinner: 5 };
      flex.sort(function (a, b) { return (order[a.meal || a.kind] || 2) - (order[b.meal || b.kind] || 2); });
      var placeFlexUntil = function (lim) {
        while (flex.length && cursor + flex[0].duration <= lim) {
          var it = flex.shift();
          var open = it.avail.open ? hmToMin(it.avail.open) : cursor;
          if (it.meal === "lunch" && cursor < 12 * 60) cursor = 12 * 60;
          if (it.meal === "dinner" && cursor < 17 * 60) cursor = 17 * 60;
          if (cursor < open) cursor = open;
          if (cursor + it.duration > lim) { flex.unshift(it); break; }
          entries.push({ start: cursor, dur: it.duration, name: it.name, ds: descFor(it), booking: it.booking, phone: it.phone, image: it.image });
          cursor += it.duration + 15;
        }
      };
      for (var ai = 0; ai < anchors.length; ai++) {
        placeFlexUntil(anchors[ai].start);
        var a = anchors[ai];
        entries.push({ start: a.start, dur: a.end - a.start, name: a.it.name, ds: descFor(a.it) + " · reserved time", booking: a.it.booking, phone: a.it.phone, image: a.it.image, anchor: true });
        cursor = Math.max(cursor, a.end + 15);
      }
      placeFlexUntil(day._exit ? 17 * 60 : limit);
      if (day.baseCity && day.baseCity !== "Medora" && !day._exit) { var bd2 = baseDriveMin(day.baseCity); entries.push({ start: cursor, dur: bd2, drive: true, name: "Return to " + day.baseCity, ds: "~" + durLabel(bd2) }); cursor += bd2 + 10; }
      flex.forEach(function (it) { day.notes.push("Also consider: " + it.name); });
    }

    // exit travel on the final day (drive to airport + depart, or drive home)
    if (day._exit) {
      var h2 = driveHrs(day._exit.driveMi);
      entries.push({ start: cursor, dur: h2 * 60, drive: true, name: day._exit.air ? "Drive to " + day._exit.to + " (" + day._exit.code + ")" : "Drive home to " + day._exit.to, ds: "~" + h2 + "h" + (day._exit.air ? " — leave time for your flight" : "") });
      cursor += h2 * 60 + 15;
      if (day._exit.air) entries.push({ start: cursor, dur: 0, name: "Depart " + day._exit.code, ds: "Return flight home" });
    }
    day.entries = entries.sort(function (a, b) { return a.start - b.start; });
  }
  function descFor(it) {
    if (it.kind === "tour" && it.area === "library") return "Library specialty tour" + (it.price ? " · $" + it.price : " · included");
    if (it.kind === "admission") return "Self-guided galleries & grounds";
    if (it.category === "tour") return "Guided tour / ride · Medora";
    if (it.category === "recreation") return it.area === "park" ? "Outdoors · TR National Park" : "Outdoors & recreation · Medora";
    if (it.category === "event") return "Festival / special event";
    if (it.category === "dining") return "Meal · Medora";
    if (it.category === "evening") return "Evening show · book ahead";
    if (it.category === "shopping") return "Shopping · downtown Medora";
    if (it.kind === "daytrip") return "Day trip from Medora · ~" + it.miles + " mi each way";
    return it.where || "Medora";
  }

  // ---- schedule step render ----------------------------------------------
  function renderSchedule(m) {
    var sched = buildSchedule();
    m.appendChild(el("p", { class: "trtp-kicker", text: "Your itinerary" }));
    m.appendChild(el("h1", { class: "trtp-h display", text: (S.days ? S.days + "-Day " : "") + "Roosevelt Country Trip" }));
    m.appendChild(el("p", { class: "trtp-sub", text: "Here's your day-by-day plan. Far-flung stops are strung together on the way in and out; your time in Medora is kept as one contiguous stay so you only book one hotel there. The panel below shows how many nights to book in each town, and when." }));
    var seg = el("div", { class: "trtp-seg" });
    [["relaxed", "Relaxed"], ["balanced", "Balanced"], ["packed", "Packed"]].forEach(function (p) { seg.appendChild(el("button", { class: S.pace === p[0] ? "on" : "", onclick: function () { S.pace = p[0]; render(); } }, [p[1]])); });
    m.appendChild(seg);

    if (!hasAnyPick()) m.appendChild(el("div", { class: "trtp-note", text: "You haven't added anything yet. Jump back to Road trip, Medora or Library and click what appeals — it'll lay out here by day and time." }));

    // Over-capacity guidance: picks need more days than the guest set
    var cap = sched.capacity;
    if (cap.over) {
      var overBox = el("div", { class: "trtp-overcap" });
      var msg = "<b>This is more than your " + cap.setDays + " day" + (cap.setDays > 1 ? "s" : "") + " can hold.</b> Your selections would take about " + cap.requiredDays + " days at a " + S.pace + " pace. We fit what we could and trimmed the rest.";
      var recs = [];
      recs.push("Add days on the <b>Dates</b> step (you'd need about " + cap.requiredDays + ")");
      if (cap.trimmedFar.length) recs.push("Or drop far stops: " + cap.trimmedFar.join(", "));
      if (cap.medoraNeeded > cap.medoraShown) recs.push("Or trim some Medora activities (they don't all fit in " + cap.medoraShown + " day" + (cap.medoraShown > 1 ? "s" : "") + " here)");
      recs.push("Or switch pace to <b>Packed</b> to squeeze in more per day");
      overBox.innerHTML = msg + "<ul style='margin:8px 0 0;padding-left:20px'>" + recs.map(function (r) { return "<li>" + r + "</li>"; }).join("") + "</ul>";
      m.appendChild(overBox);
    } else if (cap.spare && hasAnyPick()) {
      m.appendChild(el("div", { class: "trtp-note", text: "You've got room to spare — your plan fills " + cap.plannedDays + " of your " + cap.setDays + " days. Add a few more stops or a day trip to round it out." }));
    }

    // Where to book — contiguous nights per town, with dates
    if (sched.booking.length) {
      var bp = el("div", { class: "trtp-booking" });
      bp.appendChild(el("h4", { text: "Where to book" }));
      sched.booking.forEach(function (b) {
        var row = el("div", { class: "trtp-book-row" });
        var main = el("div", {});
        main.appendChild(el("div", { class: "bcity", text: b.city }));
        var det = b.nights + " night" + (b.nights > 1 ? "s" : "") + (b.checkIn ? " · " + fmtD(b.checkIn) + " – " + fmtD(b.checkOut) : "");
        main.appendChild(el("div", { class: "bdet", text: det }));
        if (b.kind === "medora") main.appendChild(el("div", { class: "bwhy", text: "Your Medora base" + (b.city !== "Medora" ? " (short drive in)" : "") + " — book early; it fills up and gets pricey in summer." }));
        else if (b.stops.length) main.appendChild(el("div", { class: "bwhy", text: "Overnight near " + b.stops.join(", ") }));
        row.appendChild(main);
        bp.appendChild(row);
      });
      m.appendChild(bp);
    }

    sched.days.forEach(function (day) {
      var card = el("div", { class: "trtp-day" });
      var head = el("div", { class: "trtp-day-head" });
      var title = "Day " + (day.index + 1);
      var sub = day.kind === "leg" ? ("En route" + (day.baseCity ? " · overnight " + day.baseCity : "")) : (day.baseCity && day.baseCity !== "Medora" ? "Medora day · stay " + day.baseCity : "In & around Medora");
      if (day.date) title += " · " + DOWLONG[day.date.getDay()] + ", " + MON[day.date.getMonth()] + " " + day.date.getDate();
      head.appendChild(el("span", { class: "dt", text: title }));
      head.appendChild(el("span", { class: "sd", text: sub }));
      card.appendChild(head);
      if (!day.entries.length) card.appendChild(el("div", { class: "trtp-row" }, [el("div", { class: "bd" }, [el("div", { class: "ds", text: "Open day — add stops from earlier steps, or leave it free to explore." })])]));
      day.entries.forEach(function (e) {
        var row = el("div", { class: "trtp-row" + (e.drive ? " drive" : "") });
        row.appendChild(el("div", { class: "tm", text: minToLabel(e.start) }));
        if (e.image) { var th = el("img", { class: "rthumb", src: imgURL(e.image), alt: e.name, loading: "lazy" }); th.addEventListener("error", function () { if (th.parentNode) th.parentNode.removeChild(th); }); row.appendChild(th); }
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

    renderWeather(m);
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

    // Where to book: contiguous nights per town
    var bookingHtml = sched.booking.length ? "<h2>Where to book</h2><table class='book'>" + sched.booking.map(function (b) {
      var why = b.kind === "medora" ? "Your Medora base — book early (fills up in summer)" : (b.stops.length ? "Near " + esc(b.stops.join(", ")) : "");
      return "<tr><td><b>" + esc(b.city) + "</b></td><td>" + b.nights + " night" + (b.nights > 1 ? "s" : "") + (b.checkIn ? " · " + fmtD(b.checkIn) + "–" + fmtD(b.checkOut) : "") + "</td><td>" + why + "</td></tr>";
    }).join("") + "</table>" : "";
    var lodging = S.picks.lodging.map(function (id) { return byId(D.lodging.lodging, id); }).filter(function (l) { return l && !l.nearbyBase; });
    var lodgingHtml = lodging.length ? "<h2>Your Medora lodging picks</h2><ul>" + lodging.map(function (l) { return "<li><b>" + esc(l.name) + "</b> — " + esc(l.area) + (l.phone ? " · " + esc(l.phone) : "") + " · <a href='" + l.booking + "'>book</a></li>"; }).join("") + "</ul>" : "";

    sched.days.forEach(function (day) {
      var title = "Day " + (day.index + 1) + (day.date ? " — " + DOWLONG[day.date.getDay()] + ", " + MON[day.date.getMonth()] + " " + day.date.getDate() : "");
      var psub = day.kind === "leg" ? ("En route" + (day.baseCity ? " · overnight " + esc(day.baseCity) : "")) : (day.baseCity && day.baseCity !== "Medora" ? "Medora day · stay " + esc(day.baseCity) : "In &amp; around Medora");
      rows += "<div class='day'><h3>" + esc(title) + " <span class='sub'>" + psub + "</span></h3><table>";
      if (!day.entries.length) rows += "<tr><td colspan=3 class='free'>Open day — explore at your own pace.</td></tr>";
      day.entries.forEach(function (e) {
        var book = "";
        if (e.booking) book += "<a href='" + e.booking + "'>" + esc(e.booking) + "</a>";
        if (e.phone) book += (book ? " · " : "") + esc(e.phone);
        var thumb = e.image ? "<td class='thc'><img class='thm' src='" + imgURL(e.image) + "' onerror='this.style.display=\"none\"'></td>" : "<td class='thc'></td>";
        rows += "<tr><td class='tm'>" + minToLabel(e.start) + "</td>" + thumb + "<td><span class='nm'>" + esc(e.name) + "</span>" + (e.ds ? "<span class='ds'>" + esc(e.ds) + "</span>" : "") + (book ? "<span class='bk'>" + book + "</span>" : "") + "</td></tr>";
      });
      day.notes.forEach(function (n) { rows += "<tr><td></td><td class='ds'>" + esc(n) + "</td></tr>"; });
      rows += "</table></div>";
    });

    var overflow = sched.overflow.length ? "<div class='warn'><b>Check availability / didn't fit:</b><ul>" + sched.overflow.map(function (o) { return "<li>" + esc(o.item.name) + " — " + esc(o.reason) + "</li>"; }).join("") + "</ul></div>" : "";

    // Weather & packing
    var wi = weatherInfo();
    var weatherHtml = "";
    if (wi) {
      weatherHtml = "<h2>Weather &amp; what to pack</h2>" +
        "<p style='font-size:13px;margin:0 0 8px'>" + wi.rows.map(function (r) { return "<b>" + MON[r.m - 1] + ":</b> " + r.hi + "°/" + r.lo + "°F, " + esc(r.note); }).join(" &nbsp;·&nbsp; ") + "</p>" +
        "<table style='width:100%'><tr>" +
        "<td style='width:50%;vertical-align:top;padding-right:12px'><b>Pack</b><ul style='margin:4px 0;padding-left:18px;font-size:13px'>" + wi.pack.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul></td>" +
        "<td style='width:50%;vertical-align:top'><b>Prepare for</b><ul style='margin:4px 0;padding-left:18px;font-size:13px'>" + wi.prepare.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul></td>" +
        "</tr></table>";
    }

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
      ".tm{font-family:Oswald,sans-serif;font-weight:600;font-size:12px;color:" + c.primary + ";white-space:nowrap;width:80px;vertical-align:top;}" +
      ".thc{width:76px;padding:7px 8px;}" +
      ".thm{width:68px;height:50px;object-fit:cover;border-radius:3px;display:block;}" +
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
      bookingHtml + lodgingHtml + "<h2>Day by day</h2>" + rows + overflow + weatherHtml + bookHtml +
      "<div class='foot'>Planned with the Theodore Roosevelt Presidential Library trip planner · trlibrary.com/visit · Times and availability are estimates — please confirm when you book.</div>" +
      "</body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ---- go -----------------------------------------------------------------
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // expose for tests
  if (typeof window !== "undefined") window.__TRTP = { state: S, build: buildSchedule, data: D, recommend: recommendAirports };
})();
