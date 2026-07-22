#!/usr/bin/env node
/**
 * refresh-events.mjs
 * Pulls time-sensitive EVENTS into data/events.json (runs weekly in CI).
 *
 * Resilience model — the planner must never end up with an empty calendar:
 *   1. Each source is fetched with retry/backoff (handles 429s & blips).
 *   2. JS-rendered sources are rendered with Playwright when available;
 *      otherwise we fall back to a static fetch, and if that yields nothing
 *      we KEEP the previous events for that source.
 *   3. Every parse result is validated; malformed events are dropped.
 *   4. If a source errors, yields nothing, or drops to zero after previously
 *      having events, we keep its previous data AND flag it as needing
 *      attention so the workflow can open an issue (failures are never silent).
 *   5. A per-run status is written to $GITHUB_OUTPUT (status + summary) and to
 *      data/refresh-status.json for the workflow to act on.
 *
 * Exports its pure helpers for unit testing; main() only runs when invoked
 * directly (node scripts/refresh-events.mjs).
 */
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "events.json");
const STATUS_OUT = join(ROOT, "data", "refresh-status.json");

export const SOURCES = [
  { id: "medora",      name: "Medora.com",                   url: "https://medora.com/calendar/",                         strategy: "mec",     render: true },
  { id: "cowboy-hall", name: "ND Cowboy Hall of Fame",       url: "https://northdakotacowboy.org/events/",                strategy: "jsonld" },
  { id: "trnp",        name: "TR National Park Events (NPS)", url: "https://www.nps.gov/thro/planyourvisit/calendar.htm",  strategy: "jsonld" },
  { id: "chamber",     name: "Medora Chamber of Commerce",   url: "https://medorachamber.com/events/",                    strategy: "jsonld" },
  { id: "dickinson",   name: "VisitDickinson",               url: "https://www.visitdickinson.com/events",                strategy: "saffire", render: true }
];

const UA = "Mozilla/5.0 (compatible; TRLibraryTripPlanner/1.0; +https://trip.labs.trlibrary.com)";
const HORIZON_DAYS = 400;   // keep events up to ~13 months out
const STALE_DAYS = 21;      // consider data stale if not refreshed in this long

export function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60); }

// --- fetch with retry/backoff (handles transient 429/5xx/timeouts) ----------
export async function fetchWithRetry(url, { tries = 3, backoffMs = 1500, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) throw new Error("HTTP " + res.status);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    }
  }
  throw lastErr;
}

// --- optional Playwright render (JS-heavy pages) ----------------------------
export async function renderHTML(url, { timeoutMs = 30000 } = {}) {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { throw new Error("playwright-unavailable"); }
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    await page.waitForTimeout(1500);
    return await page.content();
  } finally { await browser.close(); }
}

// --- parsers ----------------------------------------------------------------
export function collectJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim());
      const arr = Array.isArray(data) ? data : (data["@graph"] ? data["@graph"] : [data]);
      for (const node of arr) {
        const t = node && node["@type"];
        const isEvent = t === "Event" || (Array.isArray(t) && t.includes("Event")) || (typeof t === "string" && /Event$/.test(t));
        if (isEvent) out.push(node);
      }
    } catch { /* ignore malformed blocks */ }
  }
  return out;
}

// Modern Events Calendar (WordPress) — used by medora.com/calendar/. Prefers
// JSON-LD if present; otherwise parses the rendered event articles.
export function parseMec(html, source) {
  const ld = collectJsonLd(html).map((n) => normalize(n, source)).filter(Boolean);
  if (ld.length) return dedupe(ld);
  const events = [];
  // MEC event blocks carry a title link to /calendar/<slug>/ and a machine date
  const artRe = /<(?:article|div)[^>]*class=["'][^"']*mec-event-article[^"']*["'][\s\S]*?<\/(?:article|div)>/gi;
  const blocks = html.match(artRe) || [];
  for (const b of blocks) {
    const title = (b.match(/mec-event-title[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) || b.match(/mec-event-title[^>]*>([\s\S]*?)</i) || [])[1];
    const href = (b.match(/mec-event-title[^>]*>\s*<a[^>]*href=["']([^"']+)["']/i) || [])[1];
    const dm = b.match(/data-mec-(?:date|start)=["'](\d{4}-\d{2}-\d{2})["']/i) || b.match(/(\d{4}-\d{2}-\d{2})/);
    const iso = dm ? dm[1] : "";
    if (!title) continue;
    events.push(normalize({ name: stripTags(title), url: href, startDate: iso }, source));
  }
  return dedupe(events.filter(Boolean));
}

// Saffire CMS (VisitDickinson). Best-effort DOM parse of event cards; returns
// [] if the layout isn't recognized (caller keeps the curated seed).
export function parseSaffire(html, source) {
  const ld = collectJsonLd(html).map((n) => normalize(n, source)).filter(Boolean);
  if (ld.length) return dedupe(ld);
  const events = [];
  const cardRe = /<a[^>]+href=["']([^"']*\/events?\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html))) {
    const href = m[1], inner = m[2];
    const title = stripTags(inner).replace(/\s+/g, " ").trim();
    const iso = (inner.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
    if (title && title.length > 3 && !/^(home|events|calendar)$/i.test(title)) events.push(normalize({ name: title, url: href, startDate: iso }, source));
  }
  return dedupe(events.filter(Boolean));
}

export function stripTags(s) { return String(s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#\d+;/g, "").trim(); }

export function normalize(node, source) {
  const title = (node.name || "").trim();
  if (!title) return null;
  const start = (node.startDate || "").slice(0, 10) || null;
  const end = (node.endDate || node.startDate || "").slice(0, 10) || null;
  let loc = "";
  if (typeof node.location === "string") loc = node.location;
  else if (node.location && node.location.name) loc = node.location.name;
  let url = node.url || "";
  if (url && url.startsWith("/")) { try { url = new URL(url, source.url).href; } catch { /* keep */ } }
  return { id: source.id + "-" + slug(title) + (start ? "-" + start : ""), title, source: source.id, start, end, allDay: true, location: loc || "", url: url || source.url, tags: [] };
}

export function dedupe(events) {
  const seen = new Set();
  return events.filter((e) => (e && !seen.has(e.id) ? (seen.add(e.id), true) : false));
}

// --- validation -------------------------------------------------------------
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function validDate(s) {
  if (s == null) return true;                       // undated is allowed
  if (!ISO.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;  // real calendar date
}
export function validateEvents(events) {
  return (events || []).filter((e) =>
    e && typeof e.title === "string" && e.title.trim().length > 1 &&
    typeof e.source === "string" && validDate(e.start) && validDate(e.end)
  );
}

export function upcoming(events, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const horizon = new Date(now + HORIZON_DAYS * 864e5).toISOString().slice(0, 10);
  return events.filter((e) => {
    const ref = e.end || e.start;
    if (!ref) return true;                       // keep undated recurring items
    return ref >= today && (e.start || ref) <= horizon;
  });
}

async function parseSource(source) {
  let html, mode = "static";
  if (source.render) {
    try { html = await renderHTML(source.url); mode = "rendered"; }
    catch (e) { html = await fetchWithRetry(source.url); mode = e.message === "playwright-unavailable" ? "static(no-playwright)" : "static(render-failed)"; }
  } else {
    html = await fetchWithRetry(source.url);
  }
  let events;
  if (source.strategy === "mec") events = parseMec(html, source);
  else if (source.strategy === "saffire") events = parseSaffire(html, source);
  else events = dedupe(collectJsonLd(html).map((n) => normalize(n, source)).filter(Boolean));
  return { events: validateEvents(events), mode };
}

export async function main() {
  let prev = { events: [] };
  try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch { /* first run */ }
  const prevBySource = (id) => (prev.events || []).filter((e) => e.source === id);

  const collected = [];
  const status = [];
  for (const source of SOURCES) {
    const had = prevBySource(source.id).length;
    try {
      const { events, mode } = await parseSource(source);
      if (events.length) {
        console.log(`✓ ${source.name}: ${events.length} events (${mode})`);
        collected.push(...events);
        status.push({ id: source.id, ok: true, count: events.length, mode, note: "" });
      } else {
        console.log(`• ${source.name}: 0 events (${mode}) — keeping previous (${had})`);
        collected.push(...prevBySource(source.id));
        status.push({ id: source.id, ok: had === 0, count: had, mode, note: had > 0 ? "yielded 0 but had " + had + " before — parser or site may have changed" : "no events found" });
      }
    } catch (err) {
      console.log(`✗ ${source.name}: ${err.message} — keeping previous (${had})`);
      collected.push(...prevBySource(source.id));
      status.push({ id: source.id, ok: false, count: had, mode: "error", note: err.message });
    }
  }

  const events = upcoming(validateEvents(collected)).sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  const out = {
    note: "AUTO-GENERATED by scripts/refresh-events.mjs via GitHub Actions. Do not hand-edit; edits are overwritten on the next refresh.",
    generatedAt: new Date().toISOString(),
    sources: SOURCES.map((s) => ({ id: s.id, name: s.name, url: s.url, ...(s.render ? { rendered: true } : {}) })),
    events: events.length ? events : (prev.events || [])
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");

  const needsAttention = status.filter((s) => !s.ok);
  const report = { generatedAt: out.generatedAt, total: out.events.length, sources: status, needsAttention: needsAttention.map((s) => s.id) };
  await writeFile(STATUS_OUT, JSON.stringify(report, null, 2) + "\n");

  console.log(`\nWrote ${out.events.length} events to data/events.json`);
  const summary = status.map((s) => `${s.ok ? "✓" : "⚠"} ${s.id}: ${s.count} (${s.mode})${s.note ? " — " + s.note : ""}`).join("\n");
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `status=${needsAttention.length ? "warn" : "ok"}\n`);
    await appendFile(process.env.GITHUB_OUTPUT, `summary<<__EOF__\n${summary}\n__EOF__\n`);
  }
  if (needsAttention.length) console.log(`\n⚠ ${needsAttention.length} source(s) need attention:\n${summary}`);
}

// season/staleness helper reused by the drift checker & tests
export function isStale(generatedAt, now = Date.now(), days = STALE_DAYS) {
  if (!generatedAt) return true;
  return (now - new Date(generatedAt).getTime()) > days * 864e5;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main().catch((e) => { console.error(e); process.exit(1); });
