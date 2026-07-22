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

  // ---- privacy-friendly analytics (GA4, optional) -------------------------
  // Fires anonymous funnel/usage events (no personal data). If the script tag has
  // data-ga="G-XXXXXXX" we load GA4 ourselves; otherwise we just forward events to
  // any gtag() already on the host page. Fully guarded — never throws if absent.
  var GA_ID = THIS.getAttribute("data-ga") || null;
  (function initGA() {
    if (!GA_ID || typeof window === "undefined" || window.__trtpGAloaded) return;
    try {
      window.__trtpGAloaded = true;
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      var g = document.createElement("script"); g.async = true;
      g.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
      document.head.appendChild(g);
      window.gtag("js", new Date());
      window.gtag("config", GA_ID, { anonymize_ip: true });
    } catch (e) { }
  })();
  function track(name, params) {
    try { if (typeof window !== "undefined" && typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) { }
  }

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
  var MONTHFULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
    #${CONTAINER_ID}{--tr-primary:${c.primary};--tr-secondary:${c.secondary};--tr-muted:${c.muted};--tr-paper:${c.paper};--tr-ink:${c.ink};--tr-primary-text:#B04E2F;
      color:var(--tr-ink);background:var(--tr-paper);border-radius:6px;overflow:hidden;
      font-family:Frutiger,'Helvetica Neue',Arial,sans-serif;line-height:1.5;position:relative;box-shadow:0 1px 0 rgba(0,0,0,.04);}
    #${CONTAINER_ID} *{box-sizing:border-box;}
    /* Visible keyboard focus (WCAG 2.4.7) */
    #${CONTAINER_ID} :focus-visible{outline:3px solid var(--tr-secondary);outline-offset:2px;border-radius:3px;}
    #${CONTAINER_ID} .trtp-card:focus-visible{outline-offset:-1px;}
    @media (prefers-reduced-motion: reduce){#${CONTAINER_ID} *{transition:none !important;animation:none !important;}}
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
    .trtp-kicker{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.14em;font-size:12px;color:var(--tr-primary-text);font-weight:600;margin:0 0 6px;}
    .trtp-h{font-family:'Clearface',Georgia,serif;font-weight:600;color:var(--tr-secondary);font-size:29px;line-height:1.08;margin:0 0 8px;}
    .trtp-h.display{font-family:Oswald,'Dharma Gothic E',sans-serif;text-transform:uppercase;letter-spacing:.02em;font-weight:700;font-size:36px;}
    .trtp-sub{font-size:15px;color:#4a4d50;margin:0 0 20px;max-width:58ch;}
    .trtp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:13px;margin:6px 0 4px;}
    .trtp-grid.wide{grid-template-columns:repeat(auto-fill,minmax(255px,1fr));}
    .trtp-card{background:#fff;border:1px solid #e4ddcd;border-radius:5px;padding:14px 15px;cursor:pointer;text-align:left;
      transition:transform .12s,box-shadow .12s,border-color .12s;position:relative;font:inherit;color:inherit;}
    .trtp-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(9,42,77,.10);border-color:var(--tr-muted);}
    .trtp-card.sel{border-color:var(--tr-primary);box-shadow:0 0 0 2px var(--tr-primary) inset;}
    .trtp-card.dis{opacity:.45;cursor:not-allowed;filter:grayscale(.6);}
    .trtp-card.dis:hover{transform:none;box-shadow:none;border-color:#e4ddcd;}
    .trtp-rec2{background:#092a4d;color:#fff;border-radius:6px;padding:12px 16px;margin:4px 0 14px;font-size:14px;}
    .trtp-rec2 b{color:var(--tr-primary-text);}
    .trtp-card.has-img{padding-top:0;overflow:hidden;}
    .trtp-card .cimg{display:block;width:calc(100% + 30px)!important;max-width:none!important;height:140px;object-fit:cover;margin:-14px -15px 12px -15px;background:#e9e2d2;border-bottom:1px solid #e4ddcd;}
    .trtp-card .t{font-family:'Clearface',Georgia,serif;font-weight:600;font-size:16px;color:var(--tr-secondary);margin:0 0 3px;}
    .trtp-card .b{font-size:13px;color:#5c5f62;margin:0;}
    .trtp-card .meta{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.07em;font-size:10.5px;color:var(--tr-primary-text);margin-top:8px;font-weight:600;}
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
    .trtp-toolrow{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}
    .trtp-disclaimer{background:#fbf7ef;border:1px dashed var(--tr-muted);border-radius:6px;padding:11px 14px;font-size:12.5px;line-height:1.5;color:#5f5137;margin:0 0 16px;}
    .trtp-disclaimer b{color:var(--tr-secondary);}
    .trtp-fixrow{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px;}
    .trtp-btn.xsm{font-size:12px;padding:6px 12px;}
    .trtp-ofrow{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:6px 0;border-top:1px solid #f0d9cd;}
    .trtp-ofrow:first-of-type{border-top:none;}
    .trtp-ofrow .oftext{flex:1;line-height:1.35;}
    .trtp-ofrow .trtp-btn{flex:none;}
    .trtp-loading{padding:60px 30px;text-align:center;color:var(--tr-secondary);font-family:'Clearface',Georgia,serif;font-size:20px;}
    .trtp-sub-h{font-family:'Clearface',Georgia,serif;font-weight:600;font-size:18px;color:var(--tr-secondary);margin:22px 0 8px;}
    .trtp-field{display:flex;flex-direction:column;gap:6px;margin:4px 0 8px;max-width:280px;}
    .trtp-field label{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:var(--tr-secondary);font-weight:600;}
    .trtp-field input{font:inherit;padding:10px 12px;border:1px solid #d8cfb9;border-radius:4px;background:#fff;}
    .trtp-dinearound{background:#fff;border:1px solid #e4ddcd;border-radius:6px;padding:15px 18px;margin:16px 0;}
    .trtp-dinearound h4{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:13px;color:var(--tr-primary-text);margin:0 0 4px;font-weight:600;}
    .trtp-dinearound .da-sub{font-size:13px;color:#5c5f62;margin:0 0 11px;}
    .trtp-dinearound .da-chips{display:flex;flex-wrap:wrap;gap:8px;}
    .da-chip{font:inherit;font-size:13px;background:var(--tr-paper);border:1px solid #d8cfb9;border-radius:20px;padding:7px 13px;cursor:pointer;color:var(--tr-secondary);transition:all .12s;display:inline-flex;align-items:center;gap:2px;}
    .da-chip:hover{border-color:var(--tr-primary);background:#fff;transform:translateY(-1px);}
    .da-chip .plus{color:var(--tr-primary-text);font-weight:700;margin-right:4px;}
    .trtp-consider{padding:8px 11px 4px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
    .trtp-consider .clabel{font-size:12px;color:#6c6f72;font-family:Arial,sans-serif;width:100%;margin-bottom:2px;}
    .consider-chip{font:inherit;font-size:12.5px;background:var(--tr-paper);border:1px solid #d8cfb9;border-radius:20px;padding:6px 12px;cursor:pointer;color:var(--tr-secondary);display:inline-flex;align-items:center;gap:2px;}
    .consider-chip:hover{border-color:var(--tr-primary);background:#fff;}
    .consider-chip .cx{color:var(--tr-primary-text);font-weight:700;}
    .da-chip .cat{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.05em;font-size:10px;color:#9a8a6a;margin-left:5px;}
    .trtp-weather{background:#fff;border:1px solid #e4ddcd;border-radius:6px;padding:15px 18px;margin:16px 0;}
    .trtp-weather h4{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:13px;color:var(--tr-primary-text);margin:0 0 12px;font-weight:600;}
    .trtp-weather .wmonths{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}
    .trtp-weather .wmo{flex:1;min-width:120px;background:var(--tr-paper);border:1px solid #e4ddcd;border-radius:5px;padding:9px 11px;}
    .trtp-weather .wm{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--tr-secondary);font-weight:600;}
    .trtp-weather .wt{font-family:'Clearface',Georgia,serif;font-size:18px;color:var(--tr-primary);font-weight:600;margin:1px 0;}
    .trtp-weather .wc{font-size:11.5px;color:#6c6f72;line-height:1.35;}
    .trtp-weather .wcols{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
    @media(max-width:560px){.trtp-weather .wcols{grid-template-columns:1fr;}
      #${CONTAINER_ID} .trtp-main{padding:18px 15px 26px;}
      #${CONTAINER_ID} .trtp-grid,#${CONTAINER_ID} .trtp-grid.wide{grid-template-columns:1fr;}
      #${CONTAINER_ID} .trtp-steps{padding:8px 8px;gap:3px;}
      #${CONTAINER_ID} .trtp-step{font-size:11px;padding:8px 9px;}
      #${CONTAINER_ID} .trtp-seg button{padding:11px 14px;}
      #${CONTAINER_ID} .trtp-chip{padding:10px 14px;}
      #${CONTAINER_ID} .trtp-side{padding:20px 16px;}
    }
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
    .trtp-row .bd .nm .rdur{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.05em;font-size:10.5px;font-weight:600;color:#fff;background:var(--tr-primary);border-radius:10px;padding:2px 8px;margin-left:8px;vertical-align:1px;}
    .trtp-row .bd .ds{font-size:12.5px;color:#6c6f72;margin-top:1px;}
    .trtp-row .bd .raddr{font-size:11.5px;color:#8a8d90;margin-top:2px;}
    .trtp-row .bd .bk{font-size:12px;margin-top:3px;}
    .trtp-row .bd .bk a{color:var(--tr-primary-text);text-decoration:underline;font-weight:600;}
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
        try { decodeState(window.location.hash); } catch (e) { }
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
  // Suggest a concrete arrival date (first Saturday of the guest's month, this or next year).
  function recommendDate() {
    var now = new Date(), year = now.getFullYear();
    var mo = S.months.length ? S.months.slice().sort(function (a, b) { return a - b; })[0] : 7;
    if (mo < now.getMonth() + 1 || (mo === now.getMonth() + 1 && now.getDate() > 20)) year++;
    var d = new Date(year, mo - 1, 1);
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
    return { date: d, iso: d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()), label: DOW[d.getDay()] + ", " + MON[d.getMonth()] + " " + d.getDate() };
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
  // Remove a picked item by id from whichever bucket holds it, then re-render.
  function removePick(id) { ["route", "medora", "library"].forEach(function (k) { var i = S.picks[k].indexOf(id); if (i > -1) S.picks[k].splice(i, 1); }); render(); }
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
  function goto(i) { S.step = i; if (i > S.maxStep) S.maxStep = i; pendingFocus = "heading"; render(); scrollToTop(); track("wizard_step", { step_index: i, step_name: STEP_LABELS[i], arrival: S.arrival || "", pace: S.pace, days: S.days || 0 }); }
  function scrollToTop() {
    var host = document.getElementById(CONTAINER_ID);
    if (!host) return;
    try {
      var top = host.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop || 0);
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: Math.max(0, top - 12), behavior: reduce ? "auto" : "smooth" });
    } catch (e) { if (host.scrollIntoView) host.scrollIntoView(); }
  }
  // ---- shareable permalink ------------------------------------------------
  // The whole wizard state lives in the URL hash, so any plan can be bookmarked
  // or shared. We write it (via replaceState, so we don't spam history) after
  // every render, and restore from it on load.
  function encodeState() {
    var p = [];
    function add(k, v) { if (v == null || v === "" || v === false || (Array.isArray(v) && !v.length)) return; p.push(k + "=" + encodeURIComponent(Array.isArray(v) ? v.join(",") : v)); }
    add("st", S.step);
    add("o", S.origin && S.origin.id);
    add("a", S.arrival);
    add("ap", S.airport);
    add("dr", S.diffReturn ? 1 : "");
    add("apo", S.airportOut);
    add("r", S.rental);
    add("m", S.months);
    add("d", S.startDate);
    add("days", S.days);
    add("p", S.pace !== "balanced" ? S.pace : "");
    add("t", S.tier);
    add("sty", S.styles);
    add("rt", S.picks.route);
    add("md", S.picks.medora);
    add("lb", S.picks.library);
    add("lg", S.picks.lodging);
    return p.join("&");
  }
  function decodeState(hash) {
    if (!hash) return false;
    var q = {}, any = false;
    hash.replace(/^#/, "").split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); any = true; } });
    if (!any) return false;
    var list = function (v) { return v ? v.split(",") : []; };
    if (q.o) S.origin = byId(D.origins.origins, q.o) || null;
    if (q.a) S.arrival = q.a;
    if (q.ap) S.airport = q.ap;
    if (q.dr) S.diffReturn = true;
    if (q.apo) S.airportOut = q.apo;
    if (q.r) S.rental = q.r;
    if (q.m) S.months = list(q.m).map(Number).filter(function (n) { return n >= 1 && n <= 12; });
    if (q.d) S.startDate = q.d;
    if (q.days) S.days = parseInt(q.days, 10) || null;
    if (q.p) S.pace = q.p;
    if (q.t) S.tier = q.t;
    if (q.sty) S.styles = list(q.sty);
    if (q.rt) S.picks.route = list(q.rt);
    if (q.md) S.picks.medora = list(q.md);
    if (q.lb) S.picks.library = list(q.lb);
    if (q.lg) S.picks.lodging = list(q.lg);
    var st = parseInt(q.st, 10); if (!isNaN(st)) { S.step = Math.max(0, Math.min(st, STEP_LABELS.length - 1)); S.maxStep = Math.max(S.maxStep, S.step); }
    return true;
  }
  function syncURL() {
    try { if (window.history && window.history.replaceState) window.history.replaceState(null, "", "#" + encodeState()); } catch (e) { }
  }
  function shareURL() {
    var base = location.href.split("#")[0];
    return base + "#" + encodeState();
  }

  var pendingFocus = null;   // "heading" after a step change; else preserve the active control
  function render() {
    var host = document.getElementById(CONTAINER_ID);
    // remember which control had focus so a re-render (e.g. toggling a pick) doesn't
    // drop keyboard users back to the top of the page.
    var prevFk = (document.activeElement && document.activeElement.getAttribute) ? document.activeElement.getAttribute("data-fk") : null;
    var root = el("div", {});
    root.appendChild(renderStepper());
    var wrap = el("div", { class: "trtp-wrap" });
    var main = el("div", { class: "trtp-main", role: "region", "aria-label": STEP_LABELS[S.step] + " — step " + (S.step + 1) + " of " + STEP_LABELS.length });
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
    syncURL();
    // Focus: on a step change move to the step heading (announces the new step to
    // screen readers); otherwise restore focus to the control the user just used.
    try {
      if (pendingFocus === "heading") {
        var h = main.querySelector(".trtp-h") || main.querySelector("h1,h2");
        if (h) { h.setAttribute("tabindex", "-1"); h.focus(); }
      } else if (prevFk) {
        var els = host.querySelectorAll("[data-fk]");
        for (var i = 0; i < els.length; i++) { if (els[i].getAttribute("data-fk") === prevFk) { els[i].focus(); break; } }
      }
    } catch (e) { }
    pendingFocus = null;
  }
  function renderStepper() {
    var bar = el("nav", { class: "trtp-steps", "aria-label": "Trip planner steps" });
    STEP_LABELS.forEach(function (lbl, i) {
      var cls = "trtp-step" + (i === S.step ? " on" : (i < S.step || i <= S.maxStep ? " done" : ""));
      bar.appendChild(el("button", {
        class: cls, disabled: i <= S.maxStep || i === S.step ? null : "disabled",
        "aria-current": i === S.step ? "step" : null,
        "aria-label": "Step " + (i + 1) + ": " + lbl + (i < S.step || (i <= S.maxStep && i !== S.step) ? " (done)" : ""),
        onclick: function () { if (i <= S.maxStep) goto(i); }
      }, [el("span", { class: "n", "aria-hidden": "true", text: "" + (i + 1) }), lbl]));
    });
    return bar;
  }

  // ---- sidebar ------------------------------------------------------------
  function renderSidebar() {
    var side = el("div", { class: "trtp-side" });
    side.appendChild(el("h3", { text: "Your Trip" }));
    var planDays = hasAnyPick() ? buildSchedule().days.length : 0;
    side.appendChild(el("div", { class: "trip-name", text: (planDays ? planDays + "-Day " : "") + "Roosevelt Country Trip" }));
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
      row.appendChild(el("button", { class: "x", type: "button", title: "Remove " + it.name, "aria-label": "Remove " + it.name, onclick: function () { toggle(bucket, id); } }, [el("span", { "aria-hidden": "true" }, ["×"])]));
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
        "aria-pressed": opts.selected ? (sel ? "true" : "false") : null,
        disabled: dis ? "disabled" : null,
        "data-fk": "card:" + (it.id || it.code || it.name),
        onclick: function () { opts.onclick(it); }
      }, [
        img,
        el("span", { class: "check", "aria-hidden": "true", html: "✓" }),
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
          // Order by relationship to the Library (its Medora home is the trip's
          // anchor, so proximity = how easily a stop pairs with a Library visit)
          // lifted by popularity, so the closest and best-loved stops lead.
          function relScore(d) { return d.milesFromMedora * (1 - 0.08 * ((d.popularity || 3) - 1)); }
          var items = D.destinations.destinations.filter(function (d) { return matchesStyle(d.tags); }).sort(function (a, b) { return relScore(a) - relScore(b); });
          var tl = { national_park: "National Park", national_monument: "National Monument", state_park: "State Park", town: "Western Town", cultural: "History & Culture", scenic: "Scenic", outdoors: "Outdoors", recreation: "Recreation", family: "Family" };
          cardGrid(m, items, {
            wide: true, selected: function (d) { return isPicked("route", d.id); },
            blurb: function (d) { return d.blurb; },
            meta: function (d) { return ((d.popularity || 0) >= 4 ? "★ Popular · " : "") + (d.area && d.area !== "Medora" && d.area !== "National Park" ? d.area + " · " : "") + (tl[d.type] || "Stop") + " · " + (d.milesFromMedora <= 1 ? "in Medora" : d.milesFromMedora + " mi · ~" + Math.round(d.duration / 60) + "h"); },
            onclick: function (d) { toggle("route", d.id); }
          });
          m.appendChild(el("div", { class: "trtp-note", html: "Just 40 minutes east, <b>Dickinson</b> adds dinosaur museums, the Ukrainian Cultural Institute, Patterson Lake and more — a great half-day or a cheaper place to stay. It's mixed into the list above; see everything at <a href='https://www.visitdickinson.com' target='_blank' rel='noopener'>VisitDickinson ↗</a>." }));
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
              "aria-pressed": S.months.indexOf(mo) > -1 ? "true" : "false",
              "aria-label": MONTHFULL[mo - 1], "data-fk": "mon:" + mo,
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
            var calLinks = (D.events.sources || []).map(function (s) { return "<a href='" + s.url + "' target='_blank' rel='noopener'>" + s.name + " ↗</a>"; }).join(" · ");
            note.innerHTML = evs.map(function (e) { return "<div style='margin:2px 0'><b>" + e.title + "</b>" + (e.location ? " — " + e.location : "") + " <a href='" + e.url + "' target='_blank' rel='noopener'>details ↗</a></div>"; }).join("") + "<div style='margin-top:8px;font-size:12px;opacity:.75'>Full event calendars: " + calLinks + "</div>";
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
              var valid = rentalOptions();                          // serve the required airport(s)
              var union = airport(S.airport).rentalCars.slice();     // every company at the fly-in airport
              if (S.diffReturn && S.airportOut) airport(S.airportOut).rentalCars.forEach(function (r) { if (union.indexOf(r) < 0) union.push(r); });
              union.sort(function (a, b) { var av = valid.indexOf(a) > -1 ? 0 : 1, bv = valid.indexOf(b) > -1 ? 0 : 1; return av - bv || a.localeCompare(b); });
              m.appendChild(el("div", { class: "trtp-sub-h", text: S.diffReturn ? "Rental cars (one-way, " + S.airport + " → " + S.airportOut + ")" : "Rental cars at " + S.airport }));
              // Explain WHY, because people don't realize not every company is at every airport
              if (S.diffReturn) m.appendChild(el("div", { class: "trtp-note", html: "You're flying into <b>" + S.airport + "</b> and out of <b>" + S.airportOut + "</b>, so you need a company that has a counter at <b>both</b> for a one-way rental. Companies at only one airport are greyed out — renting one of those would strand your car at the wrong airport. (One-way rentals usually carry a drop-off fee.)" }));
              if (!valid.length) m.appendChild(el("div", { class: "trtp-warn", text: "No single company serves both " + S.airport + " and " + S.airportOut + ". Pick the same airport for return, or choose two airports that share a company." }));
              // Flag if the current pick is no longer valid
              if (S.rental && valid.indexOf(S.rental) < 0) m.appendChild(el("div", { class: "trtp-warn", html: "<b>" + S.rental + " won't work for this airport pair</b> — it's not at " + (airport(S.airport).rentalCars.indexOf(S.rental) < 0 ? S.airport : S.airportOut) + ". Pick a company below that serves both." }));
              cardGrid(m, union.map(function (n) { return { id: n, name: n }; }), {
                selected: function (r) { return S.rental === r.id; },
                disabled: function (r) { return valid.indexOf(r.id) < 0; },
                blurb: function (r) {
                  if (valid.indexOf(r.id) > -1) return S.diffReturn ? "At both " + S.airport + " and " + S.airportOut + " — good for a one-way" : "Available at " + airport(S.airport).city;
                  var at = airport(S.airport).rentalCars.indexOf(r.id) > -1 ? S.airport : S.airportOut;
                  return "Only at " + at + " — can't do a one-way, would strand your car";
                },
                onclick: function (r) { if (valid.indexOf(r.id) < 0) return; S.rental = r.id; render(); }
              });
              m.appendChild(el("div", { class: "trtp-warn", html: "There is <b>no rideshare</b> (Uber/Lyft) and no taxi in Medora — a rental car is essential to explore the Badlands. <a href='" + D.config.brand.directionsUrl + "' target='_blank' rel='noopener'>Full directions ↗</a>" }));
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
          fld.appendChild(el("label", { "for": "trtp-arrival-date", text: "Arrival date (optional, but recommended)" }));
          fld.appendChild(el("input", { id: "trtp-arrival-date", type: "date", "data-fk": "arrival-date", value: S.startDate || "", onchange: function (e) { S.startDate = e.target.value || null; render(); } }));
          m.appendChild(fld);
          // Smart estimate of how many days the current picks need — shown right above the day picker
          if (hasAnyPick()) {
            var rd = buildSchedule().capacity.requiredDays, txt, cls = "trtp-rec2";
            if (!S.days) txt = "Based on what you've picked so far, plan for about <b>" + rd + " day" + (rd > 1 ? "s" : "") + "</b> at a " + S.pace + " pace.";
            else if (S.days < rd) { cls = "trtp-warn"; txt = "Heads up: your picks would take about <b>" + rd + " days</b> — more than the " + S.days + " you've set. Add days, drop a stop, or switch to a Packed pace (we'll trim to fit otherwise)."; }
            else if (S.days > rd) txt = "Your picks fill about <b>" + rd + " day" + (rd > 1 ? "s" : "") + "</b> — you've set " + S.days + ", so you have room to add more stops.";
            else txt = "Nicely matched — your picks fit your " + S.days + " day" + (S.days > 1 ? "s" : "") + " at a " + S.pace + " pace.";
            m.appendChild(el("div", { class: cls, html: txt }));
          }
          m.appendChild(el("div", { class: "trtp-sub-h", text: "How many days do you have?" }));
          var opts = [
            { d: 1, label: "A day or less", note: "The Library + the South Unit loop" },
            { d: 3, label: "A weekend (2–3 days)", note: "Medora, properly" },
            { d: 6, label: "About a week (4–7 days)", note: "Add the Black Hills or River Road" },
            { d: 12, label: "The big one (8+ days)", note: "Several national parks" }
          ];
          cardGrid(m, opts, { title: "label", selected: function (o) { return S.days === o.d; }, blurb: function (o) { return o.note; }, onclick: function (o) { S.days = o.d; render(); } });
          m.appendChild(el("div", { class: "trtp-sub-h", text: "What's your pace?" }));
          var seg = el("div", { class: "trtp-seg", role: "group", "aria-label": "Trip pace" });
          [["relaxed", "Relaxed"], ["balanced", "Balanced"], ["packed", "Packed"]].forEach(function (p) {
            seg.appendChild(el("button", { class: S.pace === p[0] ? "on" : "", type: "button", "aria-pressed": S.pace === p[0] ? "true" : "false", "data-fk": "pace:" + p[0], onclick: function () { S.pace = p[0]; render(); } }, [p[1]]));
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
            // Ordered by hotel quality (Dickinson/Glendive lead), then proximity.
            var bases = D.lodging.lodging.filter(function (l) { return l.nearbyBase; }).sort(function (a, b) { return (b.quality || 0) - (a.quality || 0) || a.driveMin - b.driveMin; });
            var summer = S.months.some(function (mo) { return mo >= 6 && mo <= 8; });
            m.appendChild(el("div", { class: "trtp-sub-h", text: "Or stay nearby and drive in" }));
            m.appendChild(el("div", { class: summer ? "trtp-warn" : "trtp-note", html: (summer ? "<b>Heads up:</b> " : "") + "Medora books up fast and gets pricey in summer. These towns are a short drive on I-94 and often have more rooms for less — pick one to base your Medora days there <b>instead of</b> a Medora hotel." }));
            cardGrid(m, bases, {
              wide: true, selected: function (l) { return isPicked("lodging", l.id); },
              blurb: function (l) { return l.blurb; },
              meta: function (l) { return l.driveMin + " min / " + l.driveMiles + " mi to Medora" + (l.priceHint ? " · " + l.priceHint : ""); },
              onclick: function (l) { toggleLodging(l.id); }
            });
            // Real hotels in the chosen base town — matched to the comfort level
            if (baseChosen && baseChosen.hotels) {
              var tierRank = { value: 1, comfort: 2, premium: 3 };
              var want = tierRank[S.tier] || 2;
              var matched = baseChosen.hotels.filter(function (h) { return (tierRank[h.tier] || 2) === want; });
              var picks = matched.length ? matched : baseChosen.hotels.slice().sort(function (a, b) { return Math.abs((tierRank[a.tier] || 2) - want) - Math.abs((tierRank[b.tier] || 2) - want); }).slice(0, 3);
              var tierLabel = byId(D.config.comfortTiers, S.tier) ? byId(D.config.comfortTiers, S.tier).label.toLowerCase() : "your comfort level";
              m.appendChild(el("div", { class: "trtp-sub-h", text: "Hotels in " + baseChosen.name + (matched.length ? " (" + tierLabel + ")" : "") }));
              var hl = el("div", { class: "trtp-note" });
              hl.innerHTML = picks.map(function (h) { return "<div style='margin:3px 0'>• <a href='" + h.search + "' target='_blank' rel='noopener'>" + h.name + " ↗</a></div>"; }).join("") + (matched.length ? "" : "<div style='font-size:12px;opacity:.75;margin-top:4px'>No exact match at your comfort level here — closest options shown.</div>") + (baseChosen.bookingSearch ? "<div style='margin-top:6px'><a href='" + baseChosen.bookingSearch + "' target='_blank' rel='noopener'>See all " + baseChosen.name + " hotels ↗</a></div>" : "");
              m.appendChild(hl);
              if (baseChosen.id === "dickinson-base") m.appendChild(el("div", { class: "trtp-note", html: "Basing in Dickinson? It's a destination in its own right — dinosaur museums, the Ukrainian Cultural Institute, Patterson Lake, breweries and a full events calendar. Add Dickinson stops on the Road-trip step, and see <a href='https://www.visitdickinson.com' target='_blank' rel='noopener'>things to do ↗</a> and the <a href='https://www.visitdickinson.com/events' target='_blank' rel='noopener'>events calendar ↗</a>." }));
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
  function normLib(o) { return { id: o.id, name: o.name, duration: o.duration || 0, avail: o.avail || {}, phone: o.phone, booking: o.booking, image: o.image, address: o.address || "Theodore Roosevelt Presidential Library, Medora, ND 58645", area: "library", where: "Theodore Roosevelt Presidential Library", price: o.price, priceLabel: o.priceLabel, kind: o.kind }; }
  function normMed(a) { return { id: a.id, name: a.name, duration: a.duration || 60, avail: a.avail || {}, phone: a.phone, booking: a.booking || a.url, image: a.image, address: a.address, lat: a.lat, lng: a.lng, gps: a.gps, area: "medora", where: "Medora", category: a.category, meal: a.meal, kind: a.category }; }
  function normDest(d) { return { id: d.id, name: d.name, duration: d.duration || 180, avail: d.avail || {}, phone: d.phone, booking: d.booking || d.url, image: d.image, address: d.address, miles: d.milesFromMedora, lat: d.lat, lng: d.lng, gps: d.gps, overnight: d.overnight || null, visitDays: d.visitDays || 1, kind: "destination" }; }
  // Google Maps link for GPS routing. Trailheads (gps flag) route to exact coordinates;
  // businesses/parks use their address (e.g. the right park entrance); else coords, else name.
  function mapsUrl(e) {
    var q = (e.gps && e.lat != null) ? (e.lat + "," + e.lng)
      : e.addr ? e.addr
      : (e.lat != null && e.lng != null ? e.lat + "," + e.lng : (e.name ? e.name + ", ND" : null));
    return q ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) : null;
  }

  // ---- routing helpers ----------------------------------------------------
  var NEAR_MI = 110;          // stops within this range are day-trips from Medora; beyond it, en-route legs
  function haversine(aLat, aLng, bLat, bLng) {
    if (aLat == null || bLat == null) return null;
    var R = 3959, toR = Math.PI / 180;
    var dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR, la1 = aLat * toR, la2 = bLat * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h)) * 1.15; // ×1.15 straight-line → road fudge
  }
  // Turn a distance into a drive time. The miles fed here are already road-ish
  // (haversine() applies a ×1.15 straight-line→road fudge, and the data's
  // milesFromMedora values are real road miles), so we DON'T re-inflate. We use
  // a blended door-to-door speed (below the limit, to cover towns, grades and a
  // stop), add a small buffer, and round to the nearest 15 minutes — landing a
  // touch generous so nobody feels rushed. Calibrated against known drives
  // (Dickinson→Devils Tower ~3h50 → shows ~4h; Dickinson→Medora ~40m → ~45m).
  var DRIVE_MPH = 53;         // blended average incl. towns, grades, a stop
  var DRIVE_BUFFER = 5;       // minutes of generosity before rounding
  function driveMin(mi) {
    var raw = (mi || 0) / DRIVE_MPH * 60 + DRIVE_BUFFER;
    return Math.max(15, Math.round(raw / 15) * 15);   // nearest 15, slightly generous
  }
  function driveHrs(mi) { return driveMin(mi) / 60; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function fmtD(d) { return MON[d.getMonth()] + " " + d.getDate(); }
  // realToMedora = curated real drive minutes from this origin to Medora (origins.json
  // driveHours), used instead of the haversine estimate for the origin↔Medora leg.
  function entryPoint() {
    if (S.arrival === "air" && S.airport) { var a = airport(S.airport); return { lat: a.lat, lng: a.lng, label: a.name.replace(/ –.*/, ""), code: a.code, air: true }; }
    if (S.origin && S.origin.lat != null) return { lat: S.origin.lat, lng: S.origin.lng, label: S.origin.label, air: false, realToMedora: S.origin.driveHours ? Math.round(S.origin.driveHours * 60 / 15) * 15 : null };
    return null;
  }
  function exitPoint() {
    if (S.arrival === "air") { var a = airport(S.diffReturn && S.airportOut ? S.airportOut : S.airport); return a ? { lat: a.lat, lng: a.lng, label: a.name.replace(/ –.*/, ""), code: a.code, air: true } : null; }
    if (S.origin && S.origin.lat != null) return { lat: S.origin.lat, lng: S.origin.lng, label: S.origin.label, air: false, realToMedora: S.origin.driveHours ? Math.round(S.origin.driveHours * 60 / 15) * 15 : null };
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
    var nearLocal = near.map(function (n) { var rt = driveMin(n.miles) * 2; return { id: n.id, name: n.name, duration: n.duration + rt, avail: n.avail, phone: n.phone, booking: n.booking, image: n.image, address: n.address, lat: n.lat, lng: n.lng, gps: n.gps, kind: "daytrip", miles: n.miles }; });
    var local = lib.concat(med, nearLocal);
    var overflow = [];

    // Drop far stops that are out of season for the trip — a seasonal en-route
    // stop (e.g. Pompeys Pillar, open May–Sep) must not be built into a winter
    // leg. (Near stops are season-checked later via canPlace.)
    var tripMonth = S.startDate ? (new Date(S.startDate).getMonth() + 1) : null;
    far = far.filter(function (f) {
      if (seasonOk(f.avail, tripMonth)) return true;
      overflow.push({ item: f, reason: "closed on your dates (seasonal)" });
      return false;
    });

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

    // --- Multi-day drive split (general, per-segment). ANY drive between two
    //     consecutive route nodes (entry → legs → Medora → legs → exit) that's
    //     longer than a day is spread across dedicated "transit" driving days with
    //     en-route overnights, so no drive row crosses midnight — and we never stack
    //     an arrival drive and the drive home on one Medora day. Built in the walk
    //     below (see "Segment-based plan"). These helpers do the math.
    var DAY_DRIVE = 600;   // max ~10h of driving on a transit day
    var originLabel = S.origin ? S.origin.label : "home";
    function tCount(m) { return m > DAY_DRIVE ? Math.ceil(m / DAY_DRIVE) : 0; }
    var MEDORA_POS = { lat: MEDORA.lat, lng: MEDORA.lng, label: "Medora" };
    function segDrive(a, b) {
      if (!a || !b || a.lat == null || b.lat == null) return 0;
      if (a.realToMedora && b.label === "Medora") return a.realToMedora;   // curated real drive
      if (b.realToMedora && a.label === "Medora") return b.realToMedora;
      return driveMin(haversine(a.lat, a.lng, b.lat, b.lng));
    }
    // Leg-independent estimate of dedicated driving days, for the capacity math.
    var transitEstimate = tCount(segDrive(entry, MEDORA_POS)) + tCount(segDrive(MEDORA_POS, exit));

    // Medora nights from the local activity load at the chosen pace (min 1).
    // Near day-trips that eat most of a day (their visit + round-trip drive)
    // really want a day of their own — otherwise they get crammed onto a
    // travel-heavy arrival/departure day and bumped to a note. Count those
    // separately, then pack the remaining local load by the daily budget.
    var budget = PACE[S.pace] || 480;
    var totalLocal = local.reduce(function (s, i) { return s + i.duration; }, 0);
    var bigTrips = nearLocal.filter(function (n) { return n.duration >= budget * 0.6; });
    var packLoad = totalLocal - bigTrips.reduce(function (s, n) { return s + n.duration; }, 0);
    var medoraDays = Math.max(local.length ? 1 : (far.length ? 0 : 1), bigTrips.length + Math.ceil(Math.max(0, packLoad) / budget));
    if (medoraDays < 1 && !far.length) medoraDays = 1;

    // Extend the Medora block so a day-of-week-restricted pick (e.g. a Library tour
    // that skips some weekdays) lands on a weekday it actually runs — when the
    // guest's window includes such a day and there's room. Otherwise a short stay
    // that starts on an off-day would drop the tour even though a valid day is in
    // reach. (Applies when the block starts on the arrival date — no inbound legs.)
    if (S.startDate && S.days && !inbound.length && local.length) {
      var blockStart = transitEstimate;   // day index the Medora block begins on
      var restricted = local.filter(function (it) {
        if (!it.avail || !it.avail.fixed || !it.avail.fixed.length) return false;
        var allDays = it.avail.fixed.reduce(function (a, f) { return a.concat(f.days); }, []);
        return uniq(allDays).length < 7;   // truly restricted (not open every day)
      });
      if (restricted.length) {
        var blockWeekdays = function (md) { var s = {}; for (var i = 0; i < md; i++) { var dt = dateForDay(blockStart + i); if (dt) s[dt.getDay()] = 1; } return s; };
        var runnable = function (it, cov) { return it.avail.fixed.some(function (f) { return f.days.some(function (d) { return cov[d]; }); }); };
        var maxMedora = Math.max(medoraDays, S.days - legDayCount() - transitEstimate);
        while (medoraDays < maxMedora && !restricted.every(function (it) { return runnable(it, blockWeekdays(medoraDays)); })) medoraDays++;
      }
    }

    // --- Respect the day budget. If the picks need more days than the guest has,
    //     trim the farthest stops first, then shrink the Medora block (min 1),
    //     and report what we cut so the schedule step can guide them. ---
    function legDayCount() { return inbound.reduce(function (s, f) { return s + f.visitDays; }, 0) + outbound.reduce(function (s, f) { return s + f.visitDays; }, 0); }
    var transitDayCount = transitEstimate;   // mandatory driving days (can't be trimmed)
    var medoraNeeded = medoraDays;
    var requiredDays = legDayCount() + medoraDays + transitDayCount;
    var trimmedFar = [];
    if (S.days && requiredDays > S.days) {
      while (legDayCount() + Math.max(1, medoraDays) + transitDayCount > S.days && (inbound.length || outbound.length)) {
        var pool = inbound.concat(outbound).sort(function (a, b) { return b.miles - a.miles; });
        var victim = pool[0];
        trimmedFar.push(victim);
        var io = inbound.indexOf(victim); if (io > -1) inbound.splice(io, 1); else outbound.splice(outbound.indexOf(victim), 1);
      }
      var legs = legDayCount();
      if (legs + medoraDays + transitDayCount > S.days) medoraDays = Math.max(1, S.days - legs - transitDayCount);
    }
    trimmedFar.forEach(function (f) { overflow.push({ item: f, reason: "would add " + f.visitDays + " day" + (f.visitDays > 1 ? "s" : "") + " beyond your " + S.days + "-day window — add days or drop another stop" }); });

    // --- Segment-based plan. Walk entry → inbound legs → Medora → outbound legs →
    //     exit; any single drive over a day becomes dedicated transit days, and the
    //     first stop after transit arrives with no drive-in (no giant row). ---
    // Exit-airport reroute first (air trip ending in Medora with a far chosen airport).
    var exitNote = null, effExit = exit;
    if (S.arrival === "air" && exit && !outbound.length) {
      var nearestA = D.airports.airports.slice().sort(function (a, b) { return a.driveToMedoraMin - b.driveToMedoraMin; })[0];
      var chosenA = airport(S.diffReturn && S.airportOut ? S.airportOut : S.airport);
      if (chosenA && nearestA && chosenA.driveToMedoraMin > nearestA.driveToMedoraMin + 90) {
        effExit = { lat: nearestA.lat, lng: nearestA.lng, label: nearestA.name.replace(/ –.*/, ""), code: nearestA.code, air: true };
        exitNote = { chosen: chosenA.code, chosenMin: chosenA.driveToMedoraMin, used: nearestA.code, usedMin: nearestA.driveToMedoraMin, trimmed: trimmedFar.map(function (f) { return f.name; }) };
      }
    }

    var plan = [];
    var walkPrev = entry ? { lat: entry.lat, lng: entry.lng, label: entry.label, realToMedora: entry.realToMedora } : null;
    // Drive to `pos`; if longer than a day, emit transit days (node gets no drive-in).
    function connect(pos, dir, towards, force) {
      var fromLabel = walkPrev ? walkPrev.label : null;
      var d = segDrive(walkPrev, pos);
      var n = tCount(d);
      if (!n && force && d > 60) n = 1;   // anti-cram: dedicate the arrival even if under a day
      walkPrev = { lat: pos.lat, lng: pos.lng, label: pos.label };
      if (n > 0) {
        var seg = Math.round(d / n / 15) * 15;
        for (var i = 0; i < n; i++) plan.push({ kind: "transit", dir: dir, seg: seg, towards: towards, baseCity: "En route" });
        return { min: 0, from: fromLabel };
      }
      return { min: d, from: fromLabel };
    }
    inbound.forEach(function (f) {
      var c = connect({ lat: f.lat, lng: f.lng, label: f.overnight ? f.overnight.city : f.name }, "in", "Medora", false);
      for (var k = 0; k < f.visitDays; k++) plan.push({ kind: "leg", dir: "in", stop: f, baseCity: f.overnight ? f.overnight.city : null, contd: k > 0, lastOfStop: k === f.visitDays - 1, _driveMin: k === 0 ? c.min : 0, _driveFrom: k === 0 ? c.from : null });
    });
    // Anti-cram: a 1-day Medora block that also carries the drive home shouldn't also
    // absorb a big arrival drive — dedicate the arrival to a transit day.
    var returnMin = (!outbound.length && effExit) ? segDrive(MEDORA_POS, effExit) : 0;
    var forceArr = medoraDays === 1 && returnMin > 0 && (segDrive(walkPrev, MEDORA_POS) + returnMin) > DAY_DRIVE;
    var cm = connect(MEDORA_POS, "in", "Medora", forceArr);
    for (var mi2 = 0; mi2 < medoraDays; mi2++) plan.push({ kind: "medora", baseCity: medoraBase, firstMedora: mi2 === 0, lastMedora: mi2 === medoraDays - 1, _driveMin: mi2 === 0 ? cm.min : 0, _driveFrom: mi2 === 0 ? cm.from : null });
    outbound.forEach(function (f) {
      var c = connect({ lat: f.lat, lng: f.lng, label: f.overnight ? f.overnight.city : f.name }, "out", f.name.replace(/ \(.*\)/, ""), false);
      for (var k = 0; k < f.visitDays; k++) plan.push({ kind: "leg", dir: "out", stop: f, baseCity: f.overnight ? f.overnight.city : null, contd: k > 0, lastOfStop: k === f.visitDays - 1, _driveMin: k === 0 ? c.min : 0, _driveFrom: k === 0 ? c.from : null });
    });
    // Exit connection: dedicated transit days for a long car drive home, else a
    // short exit drive on the last real day — unless that would stack on top of the
    // last day's own drive-in (arrival + departure on one day), in which case give
    // the drive home its own day too.
    var exitShort = null;
    var lastReal = null;
    for (var pl = plan.length - 1; pl >= 0; pl--) { if (plan[pl].kind !== "transit") { lastReal = plan[pl]; break; } }
    var lastContent = 0;
    if (lastReal) { lastContent = lastReal._driveMin || 0; if (lastReal.kind === "leg" && lastReal.stop) lastContent += lastReal.stop.duration; else if (lastReal.kind === "medora") lastContent += budget; }
    var DAY_SPAN = 13 * 60;   // usable daytime 9am–10pm
    if (effExit) {
      var de = segDrive(walkPrev, effExit);
      // Give the drive home its own day when it wouldn't fit after the last day's
      // own drive-in + visit (or a full Medora day) — no arrival+departure cram.
      var stacks = de > 0 && (lastContent + de) > DAY_SPAN;
      var ne = effExit.air ? 0 : (tCount(de) || (stacks ? 1 : 0));
      if (ne > 0) {
        var eseg = Math.round(de / ne / 15) * 15;
        for (var ei = 0; ei < ne; ei++) plan.push({ kind: "transit", dir: "out", seg: eseg, towards: originLabel, arriveHome: ei === ne - 1, baseCity: ei === ne - 1 ? null : "En route" });
      } else {
        exitShort = { to: effExit.label, code: effExit.code, air: effExit.air, driveMi: haversine(walkPrev.lat, walkPrev.lng, effExit.lat, effExit.lng), driveMinReal: de };
      }
    }
    if (!plan.length) plan.push({ kind: "medora", baseCity: medoraBase, firstMedora: true, lastMedora: true });

    var days = plan.map(function (p, idx) { var dt = dateForDay(idx); return { index: idx, date: dt, wd: dt ? dt.getDay() : null, month: dt ? dt.getMonth() + 1 : null, kind: p.kind, dir: p.dir, stop: p.stop, baseCity: p.baseCity, firstMedora: p.firstMedora, lastMedora: p.lastMedora, contd: p.contd, lastOfStop: p.lastOfStop, seg: p.seg, towards: p.towards, arriveHome: p.arriveHome, _driveMin: p._driveMin, _driveFrom: p._driveFrom, items: [], entries: [], notes: [], considerItems: [] }; });
    var N = days.length;
    if (entry && entry.air && days[0] && days[0].kind !== "transit") days[0]._arriveAir = entry;
    if (exitShort) { for (var li = days.length - 1; li >= 0; li--) { if (days[li].kind !== "transit") { days[li]._exit = exitShort; break; } } }
    var medoraDayObjs = days.filter(function (d) { return d.kind === "medora"; });

    // Assign local items across the Medora block (season + weekday + budget aware)
    var commute = medoraBase !== "Medora" ? 2 * baseDriveMin(medoraBase) : 0;
    medoraDayObjs.forEach(function (d) { d.used = commute; d._evening = false; });
    // Can this day take this item? (season, weekday, time conflicts, one evening show/night, budget)
    function canPlace(d, it) {
      if (!seasonOk(it.avail, d.month)) return false;
      if (!dayOk(it.avail, d.wd)) return false;
      if (it.avail.fixed && conflictsFixed(d, it)) return false;
      // Evening-show rules apply only to shows that actually run in the evening on
      // this weekday (a brunch show — Gospel Brunch, or the TR Show on Thu/Sat AM —
      // isn't an evening show, so it can share a day with the Musical).
      if (isEveningShow(it, d.wd) && d._evening) return false;        // only one evening show per night
      if (isEveningShow(it, d.wd) && d._exit) return false;           // not on your departure day (heading home/to the airport)
      // One of each meal per day — you eat one breakfast, one lunch, one dinner.
      // (The Pitchfork Steak Fondue IS your dinner, so nothing else with meal
      // "dinner" shares its day.) This also spreads multiple dining picks across
      // days instead of piling several onto one.
      if (it.meal && d.items.some(function (x) { return x.meal === it.meal; })) return false;
      // Pitchfork Steak Fondue is the pre-Musical dinner — only on a Medora Musical day
      if (it.id === "pitchfork-fondue" && !d.items.some(function (x) { return x.id === "medora-musical"; })) return false;
      if (d.used + it.duration > budget + 90) return false;
      return true;
    }
    function place(d, it) { d.items.push(it); d.used += it.duration; if (isEveningShow(it, d.wd)) d._evening = true; }
    // A show counts as "evening" (for the one-per-night / not-on-departure rules)
    // only if its fixed window on this weekday actually starts in the evening.
    function isEveningShow(it, wd) {
      if (it.category !== "evening") return false;
      var w = it.avail && it.avail.fixed ? fixedWindowFor(it.avail, wd) : null;
      return w ? hmToMin(w.start) >= 17 * 60 : true;
    }

    // 1) Co-locate all Library items (admission + specialty tours) on ONE day, so a
    //    guest doing multiple tours does them the same day. Pick the day that can
    //    host the most of them, then fill the rest onto other days / overflow.
    var libItems = local.filter(function (it) { return it.area === "library"; });
    var others = local.filter(function (it) { return it.area !== "library"; });
    libItems.sort(function (a, b) { var af = a.avail.fixed ? 0 : 1, bf = b.avail.fixed ? 0 : 1; return af - bf || (b.duration - a.duration); });
    if (libItems.length) {
      var libDay = medoraDayObjs.slice().sort(function (a, b) {
        var sa = libItems.filter(function (it) { return seasonOk(it.avail, a.month) && dayOk(it.avail, a.wd); }).length;
        var sb = libItems.filter(function (it) { return seasonOk(it.avail, b.month) && dayOk(it.avail, b.wd); }).length;
        return sb - sa || a.index - b.index;
      })[0];
      libItems.forEach(function (it) {
        if (libDay && canPlace(libDay, it)) { place(libDay, it); return; }
        var alt = null;
        for (var j = 0; j < medoraDayObjs.length; j++) { if (canPlace(medoraDayObjs[j], it)) { alt = medoraDayObjs[j]; break; } }
        if (alt) place(alt, it); else overflow.push({ item: it, reason: reasonUnfit(it, medoraDayObjs) });
      });
    }

    // 2) Everything else — least-full day that can take it. Meals are steered by
    //    time-of-day: a breakfast wants a day with a free morning (not one eaten by
    //    an arrival flight or a long drive-in), lunch a free midday — so they get
    //    scheduled instead of dropped to an "Also consider" note.
    others.sort(function (a, b) { var af = a.avail.fixed ? 0 : 1, bf = b.avail.fixed ? 0 : 1; return af - bf || (b.duration - a.duration); });
    function morningTaken(d) { return !!(d._arriveAir || (d._driveMin && d._driveMin > 60)); }
    others.forEach(function (it) {
      var best = null, bestScore = Infinity;
      for (var j = 0; j < medoraDayObjs.length; j++) {
        var d = medoraDayObjs[j]; if (!canPlace(d, it)) continue;
        var score = d.used;
        if (it.meal === "breakfast" && morningTaken(d)) score += 100000;                 // morning gone
        if (it.meal === "lunch" && d._driveMin && d._driveMin > 4 * 60) score += 100000;  // midday gone
        if (score < bestScore) { best = d; bestScore = score; }
      }
      if (best) place(best, it);
      else {
        var reason = reasonUnfit(it, medoraDayObjs);
        if (it.category === "evening" && medoraDayObjs.every(function (d) { return d._evening || d._exit; })) reason = "no free evening — shows can't go on your departure night, and it's one show per night; add a night to catch it";
        if (it.id === "pitchfork-fondue" && !medoraDayObjs.some(function (d) { return d.items.some(function (x) { return x.id === "medora-musical"; }); })) reason = "the Pitchfork Steak Fondue is the pre-Musical dinner — add the Medora Musical to include it (they're booked together)";
        else if (it.meal && medoraDayObjs.every(function (d) { return d.items.some(function (x) { return x.meal === it.meal; }); })) reason = "you've already got " + it.meal + " each day — one " + it.meal + " spot per day (add a day for another, or swap it in)";
        overflow.push({ item: it, reason: reason });
      }
    });

    // (Drive segments, transit days, arrival buffer and exit are all set during the
    // segment-based plan walk above.)
    days.forEach(function (d) { layoutDay(d); });
    var booking = buildBooking(days);
    var reqDays = Math.max(requiredDays, N);   // transit days can push the actual plan past the estimate
    var capacity = {
      setDays: S.days || null, requiredDays: reqDays, plannedDays: N,
      trimmedFar: trimmedFar.map(function (f) { return f.name; }),
      medoraNeeded: medoraNeeded, medoraShown: medoraDayObjs.length,
      over: !!(S.days && reqDays > S.days),
      spare: !!(S.days && N < S.days)
    };
    return { days: days, overflow: overflow, booking: booking, medoraDays: medoraDayObjs.length, medoraBase: medoraBase, capacity: capacity, exitNote: exitNote };
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
    if (day._arriveAir) { entries.push({ start: 11 * 60, dur: 90, name: "Arrive at " + day._arriveAir.label + " (" + day._arriveAir.code + ")", ds: "Deplane, collect luggage and pick up your " + (S.rental || "rental") + " car — allow about 1.5 hours" }); cursor = 12 * 60 + 30 + 15; }
    // drive to reach this day's place (from the previous overnight / airport / home)
    if (day._driveMin != null && day._driveMin > 0) {
      var dm = day._driveMin, sd = Math.max(cursor, 8 * 60);
      var dn = day.kind === "medora" ? "Medora" : day.stop.name.replace(/ \(.*\)/, "");
      entries.push({ start: sd, dur: dm, drive: true, name: "Drive to " + dn, ds: "~" + durLabel(dm) + (day._driveFrom ? " from " + day._driveFrom : "") });
      cursor = sd + dm + 15;
    }

    // Dedicated transit driving day (a long drive spread over days, overnight en route).
    if (day.kind === "transit") {
      var seg = day.seg, home = S.origin ? S.origin.label : "home", arriveHome = !!day.arriveHome;
      var nm = arriveHome ? "Drive home to " + home : "Drive toward " + (day.towards || (day.dir === "in" ? "Medora" : home));
      var tds = "~" + durLabel(seg) + (arriveHome ? " — arrive home" : " · overnight en route");
      entries.push({ start: 9 * 60, dur: seg, drive: true, name: nm, ds: tds });
      if (!arriveHome) day.notes.push("Overnight en route");
      day.entries = entries.sort(function (a, b) { return a.start - b.start; });
      return;
    }

    if (day.kind === "leg") {
      var s = day.stop;
      var sOpen = s.avail && s.avail.open ? hmToMin(s.avail.open) : 9 * 60;
      var sClose = s.avail && s.avail.close ? hmToMin(s.avail.close) : 21 * 60;
      var sStart = Math.max(cursor, sOpen, 9 * 60);
      // Only schedule the visit if it fits within the stop's hours and the day.
      // If a long drive-in means you arrive too late, don't invent a midnight
      // visit — note it and see it in the morning (the gateway overnight covers it).
      if (sStart + s.duration <= Math.min(sClose, limit)) {
        entries.push({ id: s.id, start: sStart, dur: s.duration, name: s.name + (day.contd ? " (continued)" : ""), ds: day.contd ? "A second day to explore" : "Explore (~" + Math.round(s.duration / 60) + "h)", booking: s.booking, phone: s.phone, image: s.image, addr: s.address, lat: s.lat, lng: s.lng, gps: s.gps });
        cursor = sStart + s.duration + 15;
      } else {
        day.notes.push("Arrive and settle in" + (day.baseCity ? " near " + day.baseCity : "") + " — explore " + s.name.replace(/ \(.*\)/, "") + " in the morning (you'd reach it after hours today).");
      }
      if (day.baseCity) day.notes.push("Overnight in " + day.baseCity);
    } else if (day.kind === "medora") {
      if (day.baseCity && day.baseCity !== "Medora") { var bd = baseDriveMin(day.baseCity); entries.push({ start: cursor, dur: bd, drive: true, name: "Drive into Medora from " + day.baseCity, ds: "~" + durLabel(bd) }); cursor += bd + 10; }
      var anchors = day.items.filter(function (i) { return i.avail.fixed; }).map(function (i) { var w = fixedWindowFor(i.avail, day.wd); return { it: i, start: hmToMin(w.start), end: hmToMin(w.end) }; }).sort(function (a, b) { return a.start - b.start; });
      var flex = day.items.filter(function (i) { return !i.avail.fixed; });
      var order = { breakfast: 0, attraction: 1, destination: 1, daytrip: 1, recreation: 1, tour: 1, admission: 1, lunch: 2, shopping: 3, event: 4, dinner: 5 };
      var ordOf = function (x) { var v = order[x.meal || x.kind]; return v == null ? 2 : v; };   // don't let 0 (breakfast) fall through
      flex.sort(function (a, b) { return ordOf(a) - ordOf(b); });
      // Place flexible items in time order, each inside its own opening hours
      // AND its meal window. Anything that can't fit before `lim` (or whose
      // window has already passed — e.g. a breakfast cafe when it's now evening)
      // is kept back and surfaced as an "Also consider" note rather than being
      // jammed in at a time the place is closed.
      var mealFloor = { breakfast: 7 * 60, lunch: 12 * 60, dinner: 17 * 60 };   // earliest sensible start
      var mealCeil = { breakfast: 10 * 60 + 30, lunch: 14 * 60 };               // latest sensible start
      var placeFlexUntil = function (lim) {
        var keep = [];
        for (var qi = 0; qi < flex.length; qi++) {
          var it = flex[qi];
          var open = it.avail.open ? hmToMin(it.avail.open) : 8 * 60;
          var close = it.avail.close ? hmToMin(it.avail.close) : 24 * 60;
          var start = cursor;
          if (mealFloor[it.meal] && start < mealFloor[it.meal]) start = mealFloor[it.meal];
          if (start < open) start = open;
          // must start within its meal window, and finish within opening hours &
          // the segment cap — otherwise hold it back (a later segment, or a note)
          var tooLate = mealCeil[it.meal] && start > mealCeil[it.meal];
          if (!tooLate && start + it.duration <= Math.min(lim, close)) {
            entries.push({ id: it.id, start: start, dur: it.duration, name: it.name, ds: descFor(it), booking: it.booking, phone: it.phone, image: it.image, addr: it.address, lat: it.lat, lng: it.lng, gps: it.gps });
            cursor = start + it.duration + 15;
          } else {
            keep.push(it);   // doesn't fit this segment/window — try a later segment or note it
          }
        }
        flex = keep;
      };
      for (var ai = 0; ai < anchors.length; ai++) {
        var a = anchors[ai];
        // If its reserved time has already passed because you're still arriving
        // (a long drive-in on this day), don't overlap it onto the drive — note it.
        if (a.start < cursor) { day.notes.push(a.it.name + " runs at " + minToLabel(a.start) + ", but you're still arriving then — book it on a full Medora day."); continue; }
        placeFlexUntil(a.start);
        entries.push({ id: a.it.id, start: a.start, dur: a.end - a.start, name: a.it.name, ds: descFor(a.it) + " · reserved time", booking: a.it.booking, phone: a.it.phone, image: a.it.image, addr: a.it.address, lat: a.it.lat, lng: a.it.lng, gps: a.it.gps, anchor: true });
        cursor = Math.max(cursor, a.end + 15);
      }
      // Leave enough of the day for a same-day drive home so it can't cross midnight
      // (air exits keep a 5pm cutoff for the airport buffer).
      var exitBound = limit;
      if (day._exit) { var eMin = day._exit.driveMinReal != null ? day._exit.driveMinReal : driveMin(day._exit.driveMi); exitBound = day._exit.air ? 17 * 60 : Math.max(11 * 60, Math.min(17 * 60, 22 * 60 - eMin)); }
      placeFlexUntil(exitBound);
      if (day.baseCity && day.baseCity !== "Medora" && !day._exit) { var bd2 = baseDriveMin(day.baseCity); entries.push({ start: cursor, dur: bd2, drive: true, name: "Return to " + day.baseCity, ds: "~" + durLabel(bd2) }); cursor += bd2 + 10; }
      // Picks assigned to this day that didn't fit the timeline — surfaced as
      // interactive "also consider" chips (tap to drop) rather than dead text.
      flex.forEach(function (it) { day.considerItems.push({ id: it.id, name: it.name }); });
    }

    // exit travel on the final day (drive to airport + depart, or drive home)
    if (day._exit) {
      var dm2 = day._exit.driveMinReal != null ? day._exit.driveMinReal : driveMin(day._exit.driveMi);
      entries.push({ start: cursor, dur: dm2, drive: true, name: day._exit.air ? "Drive to " + day._exit.to + " (" + day._exit.code + ")" : "Drive home to " + day._exit.to, ds: "~" + durLabel(dm2) + (day._exit.air ? " — plus arrive ~2h early for your flight" : "") });
      cursor += dm2 + 15;
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
    m.appendChild(el("h1", { class: "trtp-h display", text: (sched.days.length ? sched.days.length + "-Day " : "") + "Roosevelt Country Trip" }));
    m.appendChild(el("p", { class: "trtp-sub", text: "Here's your day-by-day plan. Far-flung stops are strung together on the way in and out; your time in Medora is kept as one contiguous stay so you only book one hotel there. The panel below shows how many nights to book in each town, and when." }));
    var seg = el("div", { class: "trtp-seg", role: "group", "aria-label": "Trip pace" });
    [["relaxed", "Relaxed"], ["balanced", "Balanced"], ["packed", "Packed"]].forEach(function (p) { seg.appendChild(el("button", { class: S.pace === p[0] ? "on" : "", type: "button", "aria-pressed": S.pace === p[0] ? "true" : "false", "data-fk": "pace:" + p[0], onclick: function () { S.pace = p[0]; render(); } }, [p[1]])); });
    m.appendChild(seg);

    // Share + calendar tools. The whole plan lives in the URL (the address bar
    // updates automatically as you go), so this copies a bookmarkable permalink.
    // The calendar export appears only once a real arrival date is set.
    if (hasAnyPick()) {
      var tools = el("div", { class: "trtp-toolrow" });
      var shareBtn = el("button", { class: "trtp-btn ghost xsm", onclick: function (ev) {
        var url = shareURL(), b = ev.currentTarget;
        track("share_link", {}); var done = function () { b.textContent = "Link copied ✓"; setTimeout(function () { b.textContent = "🔗 Copy shareable link"; }, 2000); };
        try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done); else done(); } catch (e) { done(); }
      } }, ["🔗 Copy shareable link"]);
      tools.appendChild(shareBtn);
      if (S.startDate) tools.appendChild(el("button", { class: "trtp-btn ghost xsm", onclick: function () { downloadICS(); } }, ["📅 Add to calendar (.ics)"]));
      m.appendChild(tools);
    }

    // Not-a-live-booking disclaimer — this is a guide, availability/hours change.
    if (hasAnyPick()) {
      m.appendChild(el("div", { class: "trtp-disclaimer", html: "<b>Please double-check before you book.</b> This planner is a guide, not a live booking system — it doesn't check real-time availability, ticket inventory or the latest hours, and seasons, showtimes and hours change. Always confirm dates, times and hours directly with each location before finalizing plans or traveling." }));
    }

    if (!hasAnyPick()) m.appendChild(el("div", { class: "trtp-note", text: "You haven't added anything yet. Jump back to Road trip, Medora or Library and click what appeals — it'll lay out here by day and time." }));

    // Strong nudge to set a date — availability is only real once we know the weekday
    if (!S.startDate && hasAnyPick()) {
      var recD = recommendDate();
      var db = el("div", { class: "trtp-overcap" });
      db.innerHTML = "<b>Set an arrival date for real availability.</b> Tours and shows run on specific days and times — the Badlands Landscape Tour skips Sundays, the Musical is summer-only — so without a date this schedule is approximate. ";
      var btn = el("button", { class: "trtp-btn primary", style: "margin-top:9px;padding:8px 15px;font-size:12px", onclick: function () { S.startDate = recD.iso; if (!S.days) S.days = buildSchedule().capacity.requiredDays; render(); } }, ["Use " + recD.label + " →"]);
      db.appendChild(btn);
      db.appendChild(el("span", { style: "font-size:12px;opacity:.8;margin-left:8px", text: "(you can change it on the Dates step)" }));
      m.appendChild(db);
    }

    // Departure-airport sanity flag
    if (sched.exitNote) {
      var en = sched.exitNote;
      var ebox = el("div", { class: "trtp-overcap" });
      ebox.innerHTML = "<b>Your trip ends in Medora, so we routed your departure out of " + en.used + "</b> (" + en.usedMin + " min away). You'd picked <b>" + en.chosen + "</b>, about " + Math.round(en.chosenMin / 60) + "h from Medora — a long, out-of-the-way drive with nothing on the route" + (en.trimmed.length ? " (we couldn't fit " + en.trimmed.join(", ") + " in your days)" : "") + ". Change your fly-out airport on <b>Getting here</b>, or add days to keep the western stops that made " + en.chosen + " make sense.";
      m.appendChild(ebox);
    }

    // Over-capacity guidance: picks need more days than the guest set. We show
    // one-click fixes right here — bump to the days you need, switch pace — and
    // list what got trimmed with a Remove button that recalculates in real time.
    var cap = sched.capacity;
    if (cap.over) {
      var overBox = el("div", { class: "trtp-overcap" });
      overBox.appendChild(el("div", { html: "<b>This is more than your " + cap.setDays + " day" + (cap.setDays > 1 ? "s" : "") + " can hold.</b> Your selections would take about " + cap.requiredDays + " days at a " + S.pace + " pace — we fit what we could. Fix it in one click:" }));
      var fixes = el("div", { class: "trtp-fixrow" });
      fixes.appendChild(el("button", { class: "trtp-btn primary", onclick: function () { S.days = cap.requiredDays; if (S.maxStep < 7) S.maxStep = 7; track("fix_make_days", { days: cap.requiredDays }); render(); } }, ["Make it " + cap.requiredDays + " days →"]));
      if (S.pace !== "packed") fixes.appendChild(el("button", { class: "trtp-btn ghost", onclick: function () { S.pace = "packed"; render(); } }, ["Switch to Packed pace"]));
      fixes.appendChild(el("button", { class: "trtp-btn ghost", onclick: function () { goto(7); } }, ["Edit dates"]));
      overBox.appendChild(fixes);
      m.appendChild(overBox);
    } else if (cap.spare && hasAnyPick()) {
      var spareBox = el("div", { class: "trtp-note" });
      spareBox.appendChild(document.createTextNode("You've got room to spare — your plan fills " + cap.plannedDays + " of your " + cap.setDays + " days. Add a few more stops, or "));
      var tight = el("a", { href: "#", onclick: function (ev) { ev.preventDefault(); S.days = Math.max(1, cap.requiredDays); render(); } }, ["tighten to " + Math.max(1, cap.requiredDays) + " day" + (Math.max(1, cap.requiredDays) > 1 ? "s" : "")]);
      spareBox.appendChild(tight); spareBox.appendChild(document.createTextNode("."));
      m.appendChild(spareBox);
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
      var sub = day.kind === "transit" ? "On the road" : day.kind === "leg" ? ("En route" + (day.baseCity ? " · overnight " + day.baseCity : "")) : (day.baseCity && day.baseCity !== "Medora" ? "Medora day · stay " + day.baseCity : "In & around Medora");
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
        var nm = el("div", { class: "nm" }, [e.name]);
        if (!e.drive && e.dur > 0) nm.appendChild(el("span", { class: "rdur", text: "~" + durLabel(e.dur) }));
        bd.appendChild(nm);
        if (e.ds) bd.appendChild(el("div", { class: "ds", text: e.ds }));
        if (!e.drive && e.addr) bd.appendChild(el("div", { class: "raddr", text: e.addr }));
        var mu = (!e.drive) ? mapsUrl(e) : null;
        if (e.booking || e.phone || mu) {
          var bk = el("div", { class: "bk" });
          if (mu) bk.appendChild(el("a", { href: mu, target: "_blank", rel: "noopener" }, ["Directions ↗"]));
          if (e.booking) { if (bk.childNodes.length) bk.appendChild(document.createTextNode("  ·  ")); bk.appendChild(el("a", { href: e.booking, target: "_blank", rel: "noopener" }, ["Book / info ↗"])); }
          if (e.phone) { if (bk.childNodes.length) bk.appendChild(document.createTextNode("  ·  ")); bk.appendChild(el("span", { text: e.phone })); }
          bd.appendChild(bk);
        }
        row.appendChild(bd);
        card.appendChild(row);
      });
      day.notes.forEach(function (n) { card.appendChild(el("div", { class: "trtp-row" }, [el("div", { class: "bd" }, [el("div", { class: "ds", text: n })])])); });
      if (day.considerItems.length) {
        var cwrap = el("div", { class: "trtp-consider" });
        cwrap.appendChild(el("span", { class: "clabel", text: "Picked, but no room today — tap to drop, or add a day:" }));
        day.considerItems.forEach(function (ci) {
          cwrap.appendChild(el("button", { class: "consider-chip", type: "button", title: "Remove " + ci.name, "aria-label": "Remove " + ci.name + " from your trip", "data-fk": "consider:" + ci.id, onclick: function () { removePick(ci.id); } }, [ci.name, el("span", { class: "cx", "aria-hidden": "true" }, [" ✕"])]));
        });
        card.appendChild(cwrap);
      }
      m.appendChild(card);
    });

    if (sched.overflow.length) {
      var w = el("div", { class: "trtp-warn" });
      w.appendChild(el("div", { html: "<b>Couldn't fit these into your dates</b> — availability or time ran short. Add days above, or remove any to recalculate:" }));
      sched.overflow.forEach(function (o) {
        var orow = el("div", { class: "trtp-ofrow" });
        orow.appendChild(el("div", { class: "oftext", html: "<b>" + o.item.name + "</b> — " + o.reason }));
        if (o.item.id) orow.appendChild(el("button", { class: "trtp-btn ghost xsm", onclick: function () { removePick(o.item.id); } }, ["Remove"]));
        w.appendChild(orow);
      });
      m.appendChild(w);
    }

    renderWeather(m);
    renderDineAround(m);
    m.appendChild(el("div", { class: "trtp-note", html: "The <b>Print / save itinerary</b> button opens a clean, printer-friendly page with every stop, its booking link and phone number — ready to print or save as PDF." }));
  }
  function hasAnyPick() { return S.picks.route.length || S.picks.medora.length || S.picks.library.length; }

  // Encourage dining around Medora + shopping local: unpicked, in-season food & shops
  // as one-tap adds that fold straight into the schedule.
  function renderDineAround(m) {
    var pool = D.medora.attractions.filter(function (a) {
      return (a.category === "dining" || a.category === "shopping") && monthsBrowseOk(a.avail) && S.picks.medora.indexOf(a.id) < 0;
    });
    if (!pool.length) return;
    pool.sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (a.category === "dining" ? 0 : 1) - (b.category === "dining" ? 0 : 1); });
    var box = el("div", { class: "trtp-dinearound" });
    box.appendChild(el("h4", { text: "Dine around & shop local" }));
    box.appendChild(el("div", { class: "da-sub", text: "Medora rewards wandering — try a different spot each meal and browse the independent shops. Tap to add any to your plan." }));
    var wrap = el("div", { class: "da-chips" });
    pool.slice(0, 14).forEach(function (a) {
      wrap.appendChild(el("button", { class: "da-chip", type: "button", "aria-label": "Add " + a.name, onclick: function () { track("dine_around_add", { id: a.id }); toggle("medora", a.id); } }, [
        el("span", { class: "plus", text: "+" }),
        a.name,
        el("span", { class: "cat", text: a.category === "dining" ? (a.meal || "eat") : "shop" })
      ]));
    });
    box.appendChild(wrap);
    m.appendChild(box);
  }

  // ---- printable ----------------------------------------------------------
  // ---- iCal (.ics) export -------------------------------------------------
  // Only meaningful once a real arrival date is set. Times are written as
  // "floating" local time (no timezone) so each event shows at its local clock
  // time wherever it is — right for an itinerary that can cross time zones.
  function icsEsc(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function icsFold(line) { var out = ""; while (line.length > 73) { out += line.slice(0, 73) + "\r\n "; line = line.slice(73); } return out + line; }
  function icsDT(dateObj, minutes) {
    var base = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    base.setMinutes(base.getMinutes() + minutes);
    return base.getFullYear() + pad2(base.getMonth() + 1) + pad2(base.getDate()) + "T" + pad2(base.getHours()) + pad2(base.getMinutes()) + "00";
  }
  function buildICS(sched) {
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad2(now.getUTCMonth() + 1) + pad2(now.getUTCDate()) + "T" + pad2(now.getUTCHours()) + pad2(now.getUTCMinutes()) + pad2(now.getUTCSeconds()) + "Z";
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Theodore Roosevelt Presidential Library//Trip Planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Roosevelt Country Trip"];
    var n = 0;
    sched.days.forEach(function (day) {
      if (!day.date) return;
      day.entries.forEach(function (e) {
        var durMin = (e.dur && e.dur > 0) ? e.dur : 30;
        var loc = e.addr ? e.addr : (e.lat != null && e.lng != null ? e.lat + "," + e.lng : "Medora, ND");
        var desc = [];
        if (e.ds) desc.push(e.ds);
        if (e.booking) desc.push("Info/booking: " + e.booking);
        if (e.phone) desc.push("Phone: " + e.phone);
        desc.push("Confirm details directly with the venue — this itinerary is a guide, not a live booking.");
        lines.push("BEGIN:VEVENT");
        lines.push("UID:trtp-" + (n++) + "-" + icsDT(day.date, e.start) + "@trlibrary.com");
        lines.push("DTSTAMP:" + stamp);
        lines.push("DTSTART:" + icsDT(day.date, e.start));
        lines.push("DTEND:" + icsDT(day.date, e.start + durMin));
        lines.push("SUMMARY:" + icsEsc(e.name));
        lines.push("DESCRIPTION:" + icsEsc(desc.join("\n")));
        lines.push("LOCATION:" + icsEsc(loc));
        lines.push("END:VEVENT");
      });
    });
    lines.push("END:VCALENDAR");
    return lines.map(icsFold).join("\r\n");
  }
  function downloadICS() {
    if (!S.startDate) return;
    track("calendar_export", { days: S.days || 0 });
    var ics = buildICS(buildSchedule());
    try {
      var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "roosevelt-country-trip.ics";
      document.body.appendChild(a); a.click();
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 100);
    } catch (e) {
      try { window.open("data:text/calendar;charset=utf-8," + encodeURIComponent(ics)); } catch (e2) { }
    }
  }

  function openPrintable() {
    track("print_itinerary", { days: S.days || 0, pace: S.pace });
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
      var psub = day.kind === "transit" ? "On the road" : day.kind === "leg" ? ("En route" + (day.baseCity ? " · overnight " + esc(day.baseCity) : "")) : (day.baseCity && day.baseCity !== "Medora" ? "Medora day · stay " + esc(day.baseCity) : "In &amp; around Medora");
      rows += "<div class='day'><h3>" + esc(title) + " <span class='sub'>" + psub + "</span></h3><table>";
      if (!day.entries.length) rows += "<tr><td colspan=3 class='free'>Open day — explore at your own pace.</td></tr>";
      day.entries.forEach(function (e) {
        var mu = (!e.drive) ? mapsUrl(e) : null;
        var book = "";
        if (e.addr) book += esc(e.addr);
        if (mu) book += (book ? " · " : "") + "<a href='" + mu + "'>Directions</a>";
        if (e.booking) book += (book ? " · " : "") + "<a href='" + e.booking + "'>book/info</a>";
        if (e.phone) book += (book ? " · " : "") + esc(e.phone);
        var thumb = e.image ? "<td class='thc'><img class='thm' src='" + imgURL(e.image) + "' onerror='this.style.display=\"none\"'></td>" : "<td class='thc'></td>";
        var durTag = (!e.drive && e.dur > 0) ? " <span class='rdur'>~" + durLabel(e.dur) + "</span>" : "";
        rows += "<tr><td class='tm'>" + minToLabel(e.start) + "</td>" + thumb + "<td><span class='nm'>" + esc(e.name) + durTag + "</span>" + (e.ds ? "<span class='ds'>" + esc(e.ds) + "</span>" : "") + (book ? "<span class='bk'>" + book + "</span>" : "") + "</td></tr>";
      });
      day.notes.forEach(function (n) { rows += "<tr><td></td><td class='ds'>" + esc(n) + "</td></tr>"; });
      day.considerItems.forEach(function (ci) { rows += "<tr><td></td><td class='ds'>Also consider: " + esc(ci.name) + "</td></tr>"; });
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
      ".rdur{font-family:Oswald,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#fff;background:" + c.primary + ";border-radius:9px;padding:1px 7px;margin-left:6px;}" +
      ".ds{display:block;font-size:12px;color:#6c6f72;font-family:Arial,sans-serif;}" +
      ".bk{display:block;font-size:11.5px;font-family:Arial,sans-serif;margin-top:2px;}" +
      ".bk a{color:#B04E2F;text-decoration:underline;}" +
      ".free{color:#6c6f72;font-style:italic;}" +
      ".book td{border-bottom:1px solid #eee;padding:5px 8px;font-size:13px;font-family:Arial,sans-serif;}" +
      ".warn{background:#fff4ef;border-left:3px solid " + c.primary + ";padding:8px 12px;font-size:13px;margin:16px 0;}" +
      ".disc{background:#fbf7ef;border:1px dashed #c9b79a;border-radius:6px;padding:9px 13px;font-size:12px;line-height:1.5;color:#5f5137;margin:0 0 16px;font-family:Arial,sans-serif;}" +
      ".foot{margin-top:22px;font-size:12px;color:#8a8d90;font-family:Arial,sans-serif;border-top:1px solid #e4ddcd;padding-top:10px;}" +
      ".pbtn{font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.06em;background:" + c.primary + ";color:#25282a;border:none;padding:11px 20px;border-radius:3px;font-size:13px;font-weight:600;cursor:pointer;}" +
      "@media print{.noprint{display:none;}body{margin:0;}}" +
      "</style></head><body>" +
      "<div class='noprint' style='text-align:right;margin-bottom:10px'><button class='pbtn' onclick='window.print()'>Print / Save as PDF</button></div>" +
      "<h1>" + (sched.days.length ? sched.days.length + "-Day " : "") + "Roosevelt Country Trip</h1>" +
      "<div class='facts'>" + facts.map(function (f) { return "<div>" + f + "</div>"; }).join("") + "</div>" +
      "<div class='disc'><b>Please double-check before you book.</b> This itinerary is a guide, not a live booking system — it doesn't check real-time availability, ticket inventory or the latest hours, and seasons, showtimes and hours change. Always confirm dates, times and hours directly with each location before finalizing plans or traveling.</div>" +
      bookingHtml + lodgingHtml + "<h2>Day by day</h2>" + rows + overflow + weatherHtml + bookHtml +
      "<div class='foot'>Planned with the Theodore Roosevelt Presidential Library trip planner · trlibrary.com/visit · Times, hours and availability are estimates only — always confirm directly with each location before you book or travel.</div>" +
      "</body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ---- go -----------------------------------------------------------------
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // expose for tests
  if (typeof window !== "undefined") window.__TRTP = { state: S, build: buildSchedule, data: D, recommend: recommendAirports, render: render, goto: goto, encode: encodeState, decode: decodeState, ics: buildICS };
})();
