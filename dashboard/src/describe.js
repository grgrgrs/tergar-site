// Plain-English list of what a pending change does, for the review page.
// Compares the data before and after the change; never shows raw data.

import { esc, isoDate } from "../../lib/render.js";

const FIELD = {
  name: "Short name", full_name: "Full name", location: "Location", about: "Introduction",
  first_announcement: "Announcement", community_note: "Community events note",
  title: "Title", teachers: "Teachers", start: "Start date", end: "End date", time: "Time",
  format: "Format", place: "Place", requires: "Requires", description: "Description", url: "Link",
  cadence: "How often", weekday: "Day", start_time: "Start time", weeks: "Weeks of the month",
  anchor_date: "A date it meets", zoom_access: "Zoom link", zoom_url: "Zoom address", notes: "Notes",
  start_date: "Starts", end_date: "Ends", cadence_text: "When", date: "Date",
  reading: "Reading", contemplation: "Contemplation", text: "Text", by: "By", note: "Local note",
  has_prerequisites: "Has prerequisites", subscription: "Subscription", event_url: "Event link",
};
const WORDS = {
  weekly: "Every week", every_other_week: "Every other week", monthly_weeks: "Certain weeks of the month",
  in_person: "In person", zoom: "Zoom", both: "In person and Zoom",
  on_request: "On request", shown: "Shown on the page",
};
const SKIP = new Set(["id", "time_zone", "featured", "requires"]);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const blank = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
function niceDate(v) {
  const d = isoDate(v);
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}
function show(v, key) {
  if (blank(v)) return "(none)";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && /date|start|end/.test(key || ""))) return niceDate(v) || String(v);
  if (Array.isArray(v)) return v.map((x) => show(x)).join(", ");
  if (typeof v === "object") return "(details)";
  return WORDS[v] || String(v);
}
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
function norm(x) {
  if (x instanceof Date) return isoDate(x);
  if (Array.isArray(x)) return x.map(norm);
  if (x && typeof x === "object") {
    const o = {};
    for (const k of Object.keys(x).sort()) if (!blank(x[k]) && !(k === "featured" && x[k] === false)) o[k] = norm(x[k]);
    return o;
  }
  return blank(x) ? null : x;
}

// one line: kind is added | removed | changed | featured
const line = (kind, tag, html) => ({ kind, tag, html });
const q = (s) => `<strong>${esc(s)}</strong>`;

function fieldChanges(before, after, out, prefix = "") {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  for (const k of keys) {
    if (SKIP.has(k)) continue;
    const a = (before || {})[k], b = (after || {})[k];
    if (same(a, b)) continue;
    const label = FIELD[k] || k.replace(/_/g, " ");
    if (blank(a) && typeof b !== "boolean") { out.push(line("added", "New", `${prefix}${esc(label)}: ${esc(show(b, k))}`)); continue; }
    if (blank(b) && typeof a !== "boolean") { out.push(line("removed", "Removed", `${prefix}${esc(label)} removed (was: ${esc(show(a, k))})`)); continue; }
    const long = String(show(a, k)).length + String(show(b, k)).length > 90;
    if (long) out.push(line("changed", "Changed", `${prefix}${esc(label)}:<div class="chg-ba"><div><span>Before</span>${esc(show(a, k))}</div><div><span>After</span>${esc(show(b, k))}</div></div>`));
    else out.push(line("changed", "Changed", `${prefix}${esc(label)}: <span class="chg-old">${esc(show(a, k))}</span> → <span class="chg-new">${esc(show(b, k))}</span>`));
  }
}

// Lists of items with an id (local events, meetings, library items).
function itemList(before, after, out, what, titleOf = (x) => x.title || x.text || x.id) {
  const A = new Map((before || []).map((x) => [x.id, x])), B = new Map((after || []).map((x) => [x.id, x]));
  for (const [id, x] of B) {
    if (!A.has(id)) out.push(line("added", "New", `${what}: ${q(titleOf(x))}${x.start ? ` (${esc(show(x.start, "start"))})` : ""}`));
    else if (!same(A.get(id), x)) {
      const sub = [];
      fieldChanges(A.get(id), x, sub);
      for (const s of sub) out.push({ ...s, html: `${q(titleOf(x))}: ${s.html}` });
    }
  }
  for (const [id, x] of A) if (!B.has(id)) out.push(line("removed", "Deleted", `${what}: ${q(titleOf(x))}`));
}

// Lists of choices {shared|local: id, featured, note} that put things on the page.
function choices(before, after, out, where, nameOf) {
  const key = (e) => (e.shared ? "s:" + e.shared : "l:" + e.local);
  const A = new Map((before || []).map((e) => [key(e), e])), B = new Map((after || []).map((e) => [key(e), e]));
  for (const [k, e] of B) {
    const was = A.get(k), name = q(nameOf(e));
    if (!was) out.push(line("added", "Added", `${name} added to ${where}${e.featured ? ", as a featured block" : ""}`));
    else {
      if (!!was.featured !== !!e.featured) out.push(line("featured", e.featured ? "Featured" : "Unfeatured", e.featured ? `${name} is now featured` : `${name} is no longer featured (still listed)`));
      if (!same(was.note, e.note)) out.push(line("changed", "Changed", blank(e.note) ? `Local note removed from ${name}` : `Local note for ${name}: “${esc(e.note)}”`));
    }
  }
  for (const [k, e] of A) if (!B.has(k)) out.push(line("removed", "Removed", `${q(nameOf(e))} taken off ${where}`));
}

/**
 * @returns {Array<{kind, tag, html}>}
 * For a group change: before/after are the group data. For a library change:
 * before/after are the shared events doc or the library.
 */
export function describeChange(change, { before, after, sharedBefore, sharedAfter, groupAfter }) {
  const out = [];
  const keys = [...new Set(change.ops.map((o) => (typeof o.path[0] === "object" ? "" : o.path[0])))];
  const lib = sharedAfter.library || {};
  const eventName = (g) => (e) => e.shared
    ? (sharedAfter.sharedEvents[e.shared] || sharedAfter.sharedSeries[e.shared] || {}).title || e.shared
    : ([...(g.local_events || []), ...(g.local_series || [])].find((x) => x.id === e.local) || {}).title || e.local;

  if (change.scope === "shared") {
    if (change.block === "review") {
      const titles = Object.fromEntries((after.events || []).map((e) => [e.id, e.title]));
      for (const op of change.ops) {
        const t = q(titles[op.path[1].id] || op.path[1].id);
        if (op.path[2] === "review_cleared") out.push(op.value ? line("added", "Cleared", `${t} cleared for publishing`) : line("removed", "Held", `${t} held back for review again`));
        if (op.path[2] === "summary_approved") out.push(op.value ? line("added", "Approved", `Summary approved for ${t}`) : line("removed", "Withdrawn", `Summary approval withdrawn for ${t}`));
        if (op.path[2] === "subscription") out.push(op.value ? line("changed", "Label", `${t} gets a ${esc(op.value)} label`) : line("removed", "Label", `Subscription label removed from ${t}`));
        if (op.path[2] === "event_url") out.push(op.value ? line("changed", "Link", `Event link for ${t}: ${esc(op.value)}`) : line("changed", "Link", `Event link for ${t} chosen automatically again`));
      }
    } else {
      itemList(before.quotes, after.quotes, out, "Quote", (x) => `“${x.text}”`);
      itemList(before.from_tergar, after.from_tergar, out, "From Tergar item");
      itemList(before.resources, after.resources, out, "Resource link");
    }
    return out;
  }

  const ga = after, gb = before;
  for (const k of keys) {
    switch (k) {
      case "events": choices(gb.events, ga.events, out, "the page", eventName(ga)); break;
      case "series": choices(gb.series, ga.series, out, "the meeting schedule", eventName(ga)); break;
      case "recurring": choices(gb.recurring, ga.recurring, out, "Recurring (Program announcements)", eventName(ga)); break;
      case "community": break; // covered by local_series
      case "local_events": itemList(gb.local_events, ga.local_events, out, "Local event"); break;
      case "local_series": {
        const isComm = change.block === "community";
        const pick = (l) => (l || []).filter((s) => !!s.cadence_text === isComm);
        itemList(pick(gb.local_series), pick(ga.local_series), out, isComm ? "Community event" : "Meeting");
        break;
      }
      case "quote": {
        const t = (id) => { const x = (lib.quotes || []).find((q2) => q2.id === id); return x ? `“${x.text}”` : null; };
        if (!same(gb.quote, ga.quote)) out.push(ga.quote ? line("changed", "Changed", `Quote: ${q(t(ga.quote) || ga.quote)}`) : line("removed", "Removed", "Quote block hidden (no quote)"));
        break;
      }
      case "from_tergar": case "resources": {
        const where = k === "from_tergar" ? "From Tergar" : "Resources";
        const t = (id) => ((lib[k] || []).find((x) => x.id === id) || {}).title || id;
        const A = new Set(gb[k] || []), B = new Set(ga[k] || []);
        for (const id of B) if (!A.has(id)) out.push(line("added", "Added", `${q(t(id))} added to ${where}`));
        for (const id of A) if (!B.has(id)) out.push(line("removed", "Removed", `${q(t(id))} taken off ${where}`));
        break;
      }
      case "next_meeting":
        if (blank(ga.next_meeting)) { if (!blank(gb.next_meeting)) out.push(line("removed", "Removed", "Next meeting block hidden (no meeting shown)")); }
        else if (blank(gb.next_meeting)) out.push(line("added", "New", `Next meeting: ${q(ga.next_meeting.title || "")} (${esc(show(ga.next_meeting.date, "date"))})`));
        else fieldChanges(gb.next_meeting, ga.next_meeting, out, "Next meeting, ");
        break;
      case "contact":
        if (!same((gb.contact || {}).consent, (ga.contact || {}).consent))
          out.push(line("changed", "Changed", (ga.contact || {}).consent ? "The group's contact address will be shown on the page" : "The group's contact address will no longer be shown"));
        break;
      default: {
        const sub = [];
        fieldChanges({ [k]: gb[k] }, { [k]: ga[k] }, sub);
        out.push(...sub);
      }
    }
  }
  return out;
}

export function changeListHtml(lines) {
  if (!lines.length) return `<p>This change doesn't alter anything visible. You can discard it.</p>`;
  return `<ul class="chg">${lines.map((l) => `<li class="chg-${l.kind}"><span class="chg-tag">${esc(l.tag)}</span><span class="chg-text">${l.html}</span></li>`).join("")}</ul>`;
}
