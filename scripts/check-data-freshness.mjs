#!/usr/bin/env node
/**
 * check-data-freshness.mjs
 * Weekly watchdog for the CURATED data that the event refresher does NOT touch
 * (hours, show seasons, booking links). It never edits data — it reports drift
 * so a human can confirm and update. Three checks:
 *
 *   1. Link-rot   — every booking/info URL in the data returns a live page.
 *   2. Season drift — the Medora Musical's advertised season still matches the
 *      months encoded in data/medora.json (these change every year).
 *   3. Staleness  — data/events.json has actually been refreshed recently.
 *
 * Emits a markdown report to data/freshness-report.md and sets $GITHUB_OUTPUT
 * (status=ok|warn, plus the report path) so the workflow can open an issue.
 */
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchWithRetry, isStale, stripTags } from "./refresh-events.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const D = join(ROOT, "data");
const REPORT = join(D, "freshness-report.md");

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

async function readJSON(f) { return JSON.parse(await readFile(join(D, f), "utf8")); }

// Collect every external URL worth monitoring from the data files.
function collectURLs(data) {
  const urls = new Map(); // url -> where
  const add = (u, where) => { if (u && /^https?:\/\//.test(u) && !urls.has(u)) urls.set(u, where); };
  (data.destinations.destinations || []).forEach((d) => { add(d.url, d.name); add(d.booking, d.name); });
  (data.medora.attractions || []).forEach((a) => { add(a.url, a.name); add(a.booking, a.name); });
  (data.lodging.lodging || []).forEach((l) => { add(l.booking, l.name); (l.hotels || []).forEach((h) => add(h.search || h.booking, h.name)); });
  const lib = data.library;
  [lib.ticketsUrl, lib.toursUrl].forEach((u) => add(u, "Library"));
  [lib.generalAdmission, ...(lib.tours || []), ...(lib.options || [])].forEach((o) => add(o && o.booking, o && o.name));
  return urls;
}

async function checkLink(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    let res = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": "TRLibraryTripPlanner-linkcheck/1.0" }, signal: ctrl.signal });
    clearTimeout(t);
    return { ok: res.status < 400, status: res.status };
  } catch (e) { return { ok: false, status: 0, error: String(e.message || e) }; }
}

async function pool(items, worker, size = 6) {
  const out = []; let i = 0;
  async function run() { while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx], idx); } }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return out;
}

const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december)";

// Pull "June 3 - September 12, 2026" style ranges from a page → [startMonth,endMonth]
export function extractSeasonMonths(text) {
  const re = new RegExp("\\b" + MONTH + "\\s+\\d{1,2}\\s*[-–—to]+\\s*" + MONTH + "\\s+\\d{1,2}", "i");
  const m = (text || "").match(re);
  if (!m) return null;
  return [MONTHS.indexOf(m[1].toLowerCase()) + 1, MONTHS.indexOf(m[2].toLowerCase()) + 1];
}

// Looser: also matches month-only ranges like "June - September" or "April - October"
// (the listing pages advertise seasons this way). Day-numbered form wins when present.
export function extractSeasonMonthsLoose(text) {
  const precise = extractSeasonMonths(text);
  if (precise) return precise;
  const re = new RegExp("\\b" + MONTH + "\\s*[-–—]\\s*" + MONTH + "\\b", "i");
  const m = (text || "").match(re);
  if (!m) return null;
  return [MONTHS.indexOf(m[1].toLowerCase()) + 1, MONTHS.indexOf(m[2].toLowerCase()) + 1];
}

// Surface advertised clock times ("7:30 pm", "9 am", "4:00pm") for a human to
// eyeball against the curated avail.fixed windows. Informational only — never
// auto-flags, because a page carries prices/phones that can look like times.
export function extractShowTimes(text) {
  const re = /\b(1[0-2]|0?[1-9])(:[0-5]\d)?\s*(a\.?m\.?|p\.?m\.?)/gi;
  const seen = new Set(); const list = []; let m;
  while ((m = re.exec(text || ""))) {
    const ap = m[3].replace(/\./g, "").toLowerCase();
    const key = m[1] + (m[2] || "") + ap;
    if (!seen.has(key)) { seen.add(key); list.push(m[1] + (m[2] || "") + " " + ap); }
    if (list.length >= 6) break;
  }
  return list;
}

// Curated recurring shows/tours whose day-of-week & season schedules the event
// refresher does NOT touch. The watchdog re-checks each against its source page
// and flags advertised-vs-curated SEASON drift (a hard signal). It also prints
// the advertised showtimes so a human can confirm the curated avail.fixed windows.
export const MONITORED_SCHEDULES = [
  { id: "medora-musical", url: "https://medora.com/medoramusical/", label: "Medora Musical" },
  { id: "pitchfork-fondue", url: "https://medora.com/listing/pitchfork-steak-fondue/", label: "Pitchfork Steak Fondue" },
  { id: "bully-pulpit", url: "https://medora.com/listing/bully-pulpit-golf/", label: "Bully Pulpit Golf" },
  { id: "medora-gospel-brunch", url: "https://medora.com/listing/medora-gospel-brunch/", label: "Medora Gospel Brunch" },
  { id: "the-teddy-roosevelt-show", url: "https://medora.com/listing/theteddyrooseveltshow/", label: "The Teddy Roosevelt Show" },
  { id: "the-great-american-folk-show", url: "https://medora.com/listing/great-american-folk-show/", label: "The Great American Folk Show" },
  { id: "t-r-the-strenuous-life", url: "https://medora.com/listing/t-r-the-strenuous-life/", label: "T.R. – The Strenuous Life" },
  { id: "medora-riding-stables-trail-rides", url: "https://medora.com/trailrides/", label: "Medora Trail Rides" },
  { id: "medora-musical-backstage-tour", url: "https://medora.com/listing/medora-musical-backstage-tour/", label: "Musical Backstage Tour" },
  { id: "footsteps-into-medora-s-past-walking-tou", url: "https://medora.com/listing/footsteps-into-medoras-past/", label: "Footsteps Walking Tour" }
];

// Back-compat single-item check (still exported for unit tests).
async function checkMusicalSeason(medora) {
  const item = (medora.attractions || []).find((a) => a.id === "medora-musical");
  if (!item || !item.avail || !item.avail.season) return null;
  try {
    const html = await fetchWithRetry("https://medora.com/medoramusical/", { tries: 2 });
    const text = stripTags(html).replace(/\s+/g, " ");
    const found = extractSeasonMonthsLoose(text);
    if (!found) return { ok: true, note: "could not read advertised season (page layout changed?)", data: item.avail.season, found: null };
    const [ds, de] = item.avail.season, [fs, fe] = found;
    const ok = ds === fs && de === fe;
    return { ok, data: [ds, de], found: [fs, fe], note: ok ? "matches" : `data says months ${ds}–${de}, site advertises months ${fs}–${fe}` };
  } catch (e) { return { ok: true, note: "could not fetch musical page: " + e.message, data: item.avail.season, found: null }; }
}

// General schedule watchdog over MONITORED_SCHEDULES. A readable season mismatch
// is the only hard flag; fetch/parse failures stay silent (keep-calm-on-outage),
// so a site being down or a layout change never spams an issue.
export async function checkSchedules(medora, fetcher = fetchWithRetry) {
  const byId = new Map((medora.attractions || []).map((a) => [a.id, a]));
  const out = [];
  for (const mon of MONITORED_SCHEDULES) {
    const item = byId.get(mon.id);
    if (!item || !item.avail) { out.push({ ...mon, ok: true, note: "not in data (skipped)" }); continue; }
    try {
      const html = await fetcher(mon.url, { tries: 2 });
      const text = stripTags(html).replace(/\s+/g, " ");
      const found = extractSeasonMonthsLoose(text);
      const times = extractShowTimes(text);
      const cur = item.avail.season || null;
      if (!cur) { out.push({ ...mon, ok: true, note: "no curated season to compare", times }); continue; }
      if (!found) { out.push({ ...mon, ok: true, note: "could not read advertised season (layout?)", data: cur, times }); continue; }
      const ok = cur[0] === found[0] && cur[1] === found[1];
      out.push({ ...mon, ok, data: cur, found, times, note: ok ? "season matches" : `data months ${cur[0]}–${cur[1]} vs site advertises ${found[0]}–${found[1]}` });
    } catch (e) { out.push({ ...mon, ok: true, note: "fetch failed: " + e.message }); }
  }
  return out;
}

export async function main() {
  const data = {
    destinations: await readJSON("destinations.json"),
    medora: await readJSON("medora.json"),
    lodging: await readJSON("lodging.json"),
    library: await readJSON("library.json"),
    events: await readJSON("events.json")
  };

  // 1) link rot
  const urlMap = collectURLs(data);
  const urls = [...urlMap.keys()];
  const results = await pool(urls, async (u) => ({ url: u, where: urlMap.get(u), ...(await checkLink(u)) }));
  const dead = results.filter((r) => !r.ok);

  // 2) schedule drift — season (hard flag) + advertised showtimes (informational)
  //    for every monitored recurring show/tour.
  const schedules = await checkSchedules(data.medora);
  const scheduleDrift = schedules.filter((s) => !s.ok);

  // 3) staleness
  const stale = isStale(data.events.generatedAt);

  const problems = dead.length > 0 || scheduleDrift.length > 0 || stale;
  const lines = [];
  lines.push("# Trip planner data freshness report");
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()} · checked ${urls.length} links · ${schedules.length} show/tour schedules_`);
  lines.push("");
  lines.push(`- **Events data staleness:** ${stale ? "⚠ STALE — events.json not refreshed in >3 weeks (last: " + (data.events.generatedAt || "never") + ")" : "✓ fresh (" + data.events.generatedAt + ")"}`);
  lines.push(`- **Show / tour season drift:** ${scheduleDrift.length ? "⚠ " + scheduleDrift.length + " changed — update data/medora.json" : "✓ none"}`);
  lines.push(`- **Dead / unreachable links:** ${dead.length ? "⚠ " + dead.length : "✓ none"}`);
  if (dead.length) { lines.push(""); lines.push("| Link | Used by | Status |"); lines.push("|---|---|---|"); dead.forEach((d) => lines.push(`| ${d.url} | ${d.where || ""} | ${d.status || d.error || "error"} |`)); }
  // Full schedule table — advertised season + showtimes for a human to confirm
  // the curated avail.fixed days/times still match. Times are informational.
  lines.push("");
  lines.push("### Show & tour schedules (confirm days/times against the curated `avail`)");
  lines.push("");
  lines.push("| Show / tour | Season check | Advertised showtimes |");
  lines.push("|---|---|---|");
  schedules.forEach((s) => lines.push(`| ${s.label} | ${s.ok ? "✓ " : "⚠ "}${s.note} | ${(s.times && s.times.length) ? s.times.join(", ") : "—"} |`));
  lines.push("");
  lines.push(problems ? "**Action needed:** confirm the flagged items above against the source sites and update the curated data. (Showtimes are listed for a periodic manual sanity-check even when nothing is flagged.)" : "No hard flags — but glance at the advertised showtimes above and confirm the curated day/time windows still match.");
  const report = lines.join("\n") + "\n";
  await writeFile(REPORT, report);

  console.log(report);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `status=${problems ? "warn" : "ok"}\n`);
    await appendFile(process.env.GITHUB_OUTPUT, `report_path=data/freshness-report.md\n`);
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main().catch((e) => { console.error(e); process.exit(1); });
