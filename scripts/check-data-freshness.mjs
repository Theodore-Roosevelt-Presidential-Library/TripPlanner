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

// Pull "June 3 - September 12, 2026" style ranges from a page → [startMonth,endMonth]
export function extractSeasonMonths(text) {
  const re = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\s*[-–—to]+\s*(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i;
  const m = (text || "").match(re);
  if (!m) return null;
  return [MONTHS.indexOf(m[1].toLowerCase()) + 1, MONTHS.indexOf(m[2].toLowerCase()) + 1];
}

async function checkMusicalSeason(medora) {
  const item = (medora.attractions || []).find((a) => a.id === "medora-musical");
  if (!item || !item.avail || !item.avail.season) return null;
  try {
    const html = await fetchWithRetry("https://medora.com/medoramusical/", { tries: 2 });
    const text = stripTags(html).replace(/\s+/g, " ");
    const found = extractSeasonMonths(text);
    if (!found) return { ok: true, note: "could not read advertised season (page layout changed?)", data: item.avail.season, found: null };
    const [ds, de] = item.avail.season, [fs, fe] = found;
    const ok = ds === fs && de === fe;
    return { ok, data: [ds, de], found: [fs, fe], note: ok ? "matches" : `data says months ${ds}–${de}, site advertises months ${fs}–${fe}` };
  } catch (e) { return { ok: true, note: "could not fetch musical page: " + e.message, data: item.avail.season, found: null }; }
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

  // 2) season drift
  const season = await checkMusicalSeason(data.medora);

  // 3) staleness
  const stale = isStale(data.events.generatedAt);

  const problems = dead.length > 0 || (season && !season.ok) || stale;
  const lines = [];
  lines.push("# Trip planner data freshness report");
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()} · checked ${urls.length} links_`);
  lines.push("");
  lines.push(`- **Events data staleness:** ${stale ? "⚠ STALE — events.json not refreshed in >3 weeks (last: " + (data.events.generatedAt || "never") + ")" : "✓ fresh (" + data.events.generatedAt + ")"}`);
  if (season) lines.push(`- **Medora Musical season:** ${season.ok ? "✓ " + season.note : "⚠ " + season.note + " — update `medora-musical` (and Pitchfork/TR Show) in data/medora.json"}`);
  lines.push(`- **Dead / unreachable links:** ${dead.length ? "⚠ " + dead.length : "✓ none"}`);
  if (dead.length) { lines.push(""); lines.push("| Link | Used by | Status |"); lines.push("|---|---|---|"); dead.forEach((d) => lines.push(`| ${d.url} | ${d.where || ""} | ${d.status || d.error || "error"} |`)); }
  lines.push("");
  lines.push(problems ? "**Action needed:** confirm the items above against the source sites and update the curated data." : "All checks passed — no action needed.");
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
