// Edit forms for each block of a group page, and for the coordinator's
// Shared Library. Each block: { label, render(ctx) -> form HTML,
// parse(fd, ctx) -> ops }. Forms are plain HTML (no client framework); the
// only script adds rows from a <template>. Parsing validates everything:
// the dashboard never trusts the browser.

import { esc, eventLink, isoDate } from "../../lib/render.js";
import { groupFile, SHARED_EVENTS, LIBRARY } from "./data.js";

export class FormError extends Error {
  constructor(list) { super(list.join("; ")); this.list = list; }
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MAX_FEATURED = 10;

// ------------------------------------------------------------- HTML bits

const v = (x) => (x === null || x === undefined ? "" : esc(String(x)));
const input = (name, label, value, o = {}) => `<label class="f${o.wide ? " wide" : ""}"><span>${label}${o.required ? " *" : ""}</span>
  <input name="${name}" type="${o.type || "text"}" value="${v(value)}"${o.required ? " required" : ""}${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ""} maxlength="${o.max || 300}">${o.hint ? `<small>${o.hint}</small>` : ""}</label>`;
const textarea = (name, label, value, o = {}) => `<label class="f wide"><span>${label}${o.required ? " *" : ""}</span>
  <textarea name="${name}" rows="${o.rows || 3}" maxlength="${o.max || 2000}"${o.required ? " required" : ""}>${v(value)}</textarea>${o.hint ? `<small>${o.hint}</small>` : ""}</label>`;
const select = (name, label, options, value, o = {}) => `<label class="f"><span>${label}</span><select name="${name}">
  ${options.map(([val, text]) => `<option value="${esc(val)}"${String(val) === String(value ?? "") ? " selected" : ""}>${esc(text)}</option>`).join("")}</select>${o.hint ? `<small>${o.hint}</small>` : ""}</label>`;
const check = (name, label, on, value = "1") => `<label class="c"><input type="checkbox" name="${name}" value="${esc(value)}"${on ? " checked" : ""}> ${label}</label>`;

/** A list of editable rows plus an "Add" button cloning a template. */
function rowList(prefix, items, rowHtml, addLabel) {
  return `<div class="rows" data-rows="${prefix}">
    ${items.map((it, i) => `<fieldset class="row">${rowHtml(`${prefix}-${i}`, it)}</fieldset>`).join("")}
  </div>
  <template id="tpl-${prefix}"><fieldset class="row">${rowHtml(`${prefix}-__i__`, {})}</fieldset></template>
  <button type="button" class="btn-add" data-add="${prefix}" data-next="${items.length}">${addLabel}</button>`;
}

// ------------------------------------------------------------- parsing

const clean = (s) => (s === null || s === undefined ? "" : String(s).replace(/\r\n/g, "\n").trim());
function text(fd, name, max = 300) {
  const s = clean(fd.get(name));
  if (s.length > max) throw new FormError([`"${name}" is too long (max ${max} characters)`]);
  return s || null;
}
const on = (fd, name) => fd.get(name) === "1";

function rows(fd, prefix) {
  const found = new Map();
  for (const key of fd.keys()) {
    const m = key.match(new RegExp(`^${prefix}-(\\d+)-(.+)$`));
    if (m) found.set(+m[1], true);
  }
  return [...found.keys()].sort((a, b) => a - b).map((i) => ({
    get: (f, max) => text(fd, `${prefix}-${i}-${f}`, max),
    on: (f) => on(fd, `${prefix}-${i}-${f}`),
    all: (f) => fd.getAll(`${prefix}-${i}-${f}`).map(String),
    n: i + 1,
  }));
}

function checkDate(errs, label, s) {
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) errs.push(`${label}: use the date picker (YYYY-MM-DD)`);
  return s;
}
function checkUrl(errs, label, s) {
  if (s && !/^https?:\/\/[^\s]+$/i.test(s)) errs.push(`${label}: must be a web address starting with https://`);
  return s;
}
function slug(t) {
  return String(t || "item").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "item";
}
function uniqueId(base, taken) {
  let id = slug(base), k = 2;
  while (taken.has(id)) id = `${slug(base)}-${k++}`;
  taken.add(id);
  return id;
}
/** Drop null/empty fields so the YAML stays tidy. */
function tidy(o) {
  const out = {};
  for (const [k, val] of Object.entries(o)) if (val !== null && val !== undefined && val !== "" && !(Array.isArray(val) && !val.length)) out[k] = val;
  return out;
}
/**
 * Merge edited fields into an existing record: keeps its key order and any
 * fields the form doesn't edit; an emptied field is dropped, unless the
 * record already listed it as null.
 */
function mergeKeep(base, fields) {
  base = base || {};
  const out = {};
  const put = (k, val, wasNull) => {
    if (val === null || val === undefined || val === "" || (Array.isArray(val) && !val.length)) { if (wasNull) out[k] = null; }
    else out[k] = val;
  };
  for (const k of Object.keys(base)) {
    if (k in fields) put(k, fields[k], base[k] === null);
    else out[k] = base[k];
  }
  for (const k of Object.keys(fields)) if (!(k in base)) put(k, fields[k], false);
  return out;
}
const sel = (kind, id, featured, note) => tidy({ [kind]: id, featured: featured || undefined, note });

// ================================================================ blocks

const header = {
  label: "Group name and introduction",
  render({ g, shared }) {
    const addr = shared.contacts[g.path];
    return `
    ${input("name", "Page title", g.name, { required: true, hint: "Shown at the top of the page, e.g. Tergar Venice." })}
    ${input("full_name", "Full group name", g.full_name, { required: true })}
    ${input("location", "Location", g.location, { required: true, placeholder: "City, State" })}
    ${textarea("about", "Introduction", g.about, { rows: 5, hint: "A few sentences about the group, shown under the header." })}
    <div class="f wide"><span>Contact address</span>
      <p class="small">${addr ? `On file: <strong>${esc(addr)}</strong> (a role address, kept privately; to change it, ask the coordinator).` : "No contact address on file yet; ask the coordinator to add your group's role address."}</p>
      ${check("consent", "The group agrees to publish this contact address on the page", g.contact && g.contact.consent)}
    </div>`;
  },
  parse(fd) {
    const errs = [];
    const name = text(fd, "name", 80), full = text(fd, "full_name", 120), loc = text(fd, "location", 120);
    if (!name || !full || !loc) errs.push("Page title, full name and location are required");
    if (errs.length) throw new FormError(errs);
    return [
      { path: ["name"], value: name }, { path: ["full_name"], value: full },
      { path: ["location"], value: loc }, { path: ["about"], value: text(fd, "about", 1500) },
      { path: ["contact", "consent"], value: on(fd, "consent") },
    ];
  },
};

const announcement = {
  label: "Announcement",
  render({ g }) {
    return `${textarea("first_announcement", "Announcement", g.first_announcement, { rows: 4, max: 1000,
      hint: "Leave empty to hide the block. Give the year with any month you mention (\"March 2027\"), so it doesn't read as stale later." })}`;
  },
  parse(fd) { return [{ path: ["first_announcement"], value: text(fd, "first_announcement", 1000) }]; },
};

const quote = {
  label: "Quote",
  render({ g, shared }) {
    const qs = shared.library.quotes || [];
    return `<div class="f wide"><span>Choose a quote from the shared library</span>
      <label class="c"><input type="radio" name="quote" value=""${!g.quote ? " checked" : ""}> No quote (hide the block)</label>
      ${qs.map((q) => `<label class="c"><input type="radio" name="quote" value="${esc(q.id)}"${g.quote === q.id ? " checked" : ""}> “${esc(q.text)}” — ${esc(q.by)}</label>`).join("")}
      <small>New quotes are added to the shared library by the coordinator.</small></div>`;
  },
  parse(fd, { shared }) {
    const id = text(fd, "quote", 100);
    if (id && !(shared.library.quotes || []).some((q) => q.id === id)) throw new FormError(["Unknown quote"]);
    return [{ path: ["quote"], value: id }];
  },
};

const nextMeeting = {
  label: "Next meeting",
  render({ g }) {
    const nm = g.next_meeting || {};
    return `
    ${check("none", "No next meeting block (hide it)", !g.next_meeting)}
    ${input("date", "Date", isoDate(nm.date) || "", { type: "date", hint: "The block hides itself after this date." })}
    ${input("title", "Topic", nm.title, { wide: true, max: 150 })}
    ${textarea("description", "Description", nm.description, { rows: 4 })}
    ${textarea("reading", "Reading (optional)", nm.reading, { rows: 2, max: 600 })}
    ${textarea("contemplation", "Contemplation (optional)", nm.contemplation, { rows: 2, max: 600 })}`;
  },
  parse(fd) {
    if (on(fd, "none")) return [{ path: ["next_meeting"], value: null }];
    const errs = [];
    const date = checkDate(errs, "Date", text(fd, "date", 10));
    const title = text(fd, "title", 150);
    if (!date) errs.push("Date is required (or tick \"No next meeting block\")");
    if (!title) errs.push("Topic is required");
    if (errs.length) throw new FormError(errs);
    return [{ path: ["next_meeting"], value: tidy({ date, title,
      description: text(fd, "description", 2000), reading: text(fd, "reading", 600), contemplation: text(fd, "contemplation", 600) }) }];
  },
};

function pickList(key, label, hint) {
  return {
    label,
    render({ g, shared }) {
      const chosen = new Set(g[key] || []);
      const items = shared.library[key] || [];
      return `<div class="f wide"><span>${hint}</span>
        ${items.map((it) => `<label class="c"><input type="checkbox" name="${key}" value="${esc(it.id)}"${chosen.has(it.id) ? " checked" : ""}> <a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></label>`).join("")}
        <small>Nothing ticked hides the block. New items are added to the shared library by the coordinator.</small></div>`;
    },
    parse(fd, { shared }) {
      const known = new Set((shared.library[key] || []).map((x) => x.id));
      const ids = fd.getAll(key).map(String).filter((id) => known.has(id));
      // keep the library's order
      const order = (shared.library[key] || []).map((x) => x.id);
      return [{ path: [key], value: order.filter((id) => ids.includes(id)) }];
    },
  };
}

// ----------------------------------------------------------- meetings

const CADENCES = [["weekly", "Every week"], ["every_other_week", "Every other week"], ["monthly_weeks", "Certain weeks of the month"]];
const FORMATS = [["in_person", "In person"], ["zoom", "Zoom"], ["both", "In person and Zoom"]];
const SUBS = [["", "None"], ["JOL", "Joy of Living Online (JOL)"], ["VOL", "Vajrayana Online (VOL)"]];
const subOf = (v) => (v === "JOL" || v === "VOL" ? v : null);

function meetingRow(p, s) {
  const weeks = new Set((s.weeks || []).map(Number));
  return `<legend>${s.title ? esc(s.title) : "New meeting"}</legend>
    <input type="hidden" name="${p}-id" value="${v(s.id)}">
    ${input(`${p}-title`, "Title", s.title, { required: !!s.id || undefined, wide: true, max: 150 })}
    ${select(`${p}-cadence`, "How often", CADENCES, s.cadence || "weekly")}
    ${select(`${p}-weekday`, "Day", WEEKDAYS.map((d) => [d, d]), s.weekday || "Monday")}
    ${input(`${p}-start_time`, "Start time (local)", s.start_time, { type: "time" })}
    <div class="f"><span>Weeks of the month</span><div>${[1, 2, 3, 4, 5].map((n) => `<label class="c inline"><input type="checkbox" name="${p}-weeks" value="${n}"${weeks.has(n) ? " checked" : ""}> ${["1st", "2nd", "3rd", "4th", "5th"][n - 1]}</label>`).join("")}</div><small>Only for "certain weeks of the month".</small></div>
    ${input(`${p}-anchor_date`, "A date it meets", isoDate(s.anchor_date) || "", { type: "date", hint: "Only for \"every other week\"." })}
    ${select(`${p}-format`, "Format", FORMATS, s.format || "in_person")}
    ${input(`${p}-place`, "Place", s.place, { wide: true, max: 200 })}
    ${select(`${p}-zoom_access`, "Zoom link", [["on_request", "On request (people email the group)"], ["shown", "Shown on the page"]], s.zoom_access || "on_request")}
    ${input(`${p}-zoom_url`, "Zoom link (only if shown)", s.zoom_url, { wide: true, max: 300, hint: "Publishing a Zoom link makes it public. Leave empty when access is on request." })}
    <div class="f wide">${check(`${p}-has_prerequisites`, "Has prerequisites (shows a \u201cHas prerequisites\u201d label linked to the event page)", s.has_prerequisites === true)}</div>
    ${select(`${p}-subscription`, "Subscription needed", SUBS, s.subscription || "")}
    ${textarea(`${p}-notes`, "Notes (optional)", s.notes, { rows: 2, max: 600 })}
    ${input(`${p}-start_date`, "Starts (optional)", isoDate(s.start_date) || "", { type: "date" })}
    ${input(`${p}-end_date`, "Ends (optional)", isoDate(s.end_date) || "", { type: "date" })}
    <div class="f wide">${check(`${p}-featured`, "Also show as a featured block", s._featured)}
    ${s.id ? check(`${p}-remove`, "<strong>Remove this meeting</strong>", false) : ""}</div>`;
}

const schedule = {
  label: "Meeting schedule and recurring series",
  render({ g, shared }) {
    const entries = (list) => Object.fromEntries((list || []).filter((e) => e.local || e.shared).map((e) => [e.local || e.shared, e]));
    const inSeries = entries(g.series), inRecurring = entries(g.recurring);
    const meetings = (g.local_series || []).filter((s) => !s.cadence_text)
      .map((s) => Object.assign({}, s, { _featured: !!(inSeries[s.id] || inRecurring[s.id] || {}).featured }));
    const sharedRows = shared.sharedSeriesList.map((s) => {
      const place = inSeries[s.id] ? "schedule" : inRecurring[s.id] ? "recurring" : "";
      const feat = !!(inSeries[s.id] || inRecurring[s.id] || {}).featured;
      return `<tr><td><strong>${esc(s.title)}</strong>${s.host ? `<div class="small">${esc(s.host)}</div>` : ""}<div class="small">${esc(s.weekday)} ${esc(s.start_time)}${s.has_prerequisites ? " · has prerequisites" : ""}${s.subscription ? ` · ${esc(s.subscription)}` : ""}</div></td>
        <td><select name="sh-${esc(s.id)}-place">
          <option value=""${!place ? " selected" : ""}>Not shown</option>
          <option value="schedule"${place === "schedule" ? " selected" : ""}>Meeting schedule (our group hosts it)</option>
          <option value="recurring"${place === "recurring" ? " selected" : ""}>Program announcements: Recurring</option></select></td>
        <td>${check(`sh-${esc(s.id)}-featured`, "Featured", feat)}</td></tr>`;
    }).join("");
    return `
    <h2>Your group's meetings</h2>
    <p class="small">Your own meetings, shown under Meeting schedule. Times are in the group's local time (${esc(g.time_zone)}).</p>
    ${rowList("m", meetings, meetingRow, "Add a meeting")}
    <h2>Tergar meeting series</h2>
    <p class="small">Series run by Tergar or other groups. Put one under Meeting schedule only if your group hosts it; otherwise list it under Program announcements, "Recurring".</p>
    <div class="dash-table"><table><thead><tr><th>Series</th><th>Show</th><th></th></tr></thead><tbody>${sharedRows}</tbody></table></div>`;
  },
  parse(fd, { g, shared }) {
    const errs = [];
    const existing = Object.fromEntries((g.local_series || []).map((s) => [s.id, s]));
    const taken = new Set((g.local_series || []).map((s) => s.id));
    const items = [], seriesEntries = [], featuredCount = { n: 0 };
    for (const r of rows(fd, "m")) {
      const id0 = r.get("id", 100);
      if (id0 && !existing[id0]) { errs.push("Unknown meeting"); continue; }
      if (r.on("remove")) continue;
      const title = r.get("title", 150);
      if (!title) { if (id0) errs.push(`Meeting ${r.n}: title is required`); continue; } // empty new row: ignore
      const label = `"${title}"`;
      const cadence = r.get("cadence", 30), weekday = r.get("weekday", 12);
      if (!CADENCES.some(([c]) => c === cadence)) errs.push(`${label}: choose how often`);
      if (!WEEKDAYS.includes(weekday)) errs.push(`${label}: choose a day`);
      const start_time = r.get("start_time", 5);
      if (!start_time || !/^\d{2}:\d{2}$/.test(start_time)) errs.push(`${label}: start time is required`);
      const weeks = r.all("weeks").map(Number).filter((n) => n >= 1 && n <= 5);
      if (cadence === "monthly_weeks" && !weeks.length) errs.push(`${label}: tick the weeks of the month`);
      const anchor = checkDate(errs, label, r.get("anchor_date", 10));
      if (cadence === "every_other_week" && !anchor) errs.push(`${label}: give one date it meets, to fix which weeks`);
      const format = r.get("format", 20);
      if (!FORMATS.some(([f]) => f === format)) errs.push(`${label}: choose a format`);
      const usesZoom = format === "zoom" || format === "both";
      let zoom_access = r.get("zoom_access", 20) === "shown" ? "shown" : "on_request";
      const zoom_url = usesZoom && zoom_access === "shown" ? checkUrl(errs, `${label} Zoom link`, r.get("zoom_url", 300)) : null;
      if (usesZoom && zoom_access === "shown" && !zoom_url) errs.push(`${label}: give the Zoom link, or choose "on request"`);
      const start_date = checkDate(errs, label, r.get("start_date", 10)), end_date = checkDate(errs, label, r.get("end_date", 10));
      if (start_date && end_date && end_date < start_date) errs.push(`${label}: ends before it starts`);
      const id = id0 || uniqueId(title, taken);
      const base = existing[id0] || {};
      items.push(mergeKeep(base, ({
        id, title, cadence, weekday,
        weeks: cadence === "monthly_weeks" ? weeks : null,
        anchor_date: cadence === "every_other_week" ? anchor : null,
        start_time, time_zone: base.time_zone || g.time_zone, format,
        place: r.get("place", 200), zoom_access: usesZoom ? zoom_access : (base.zoom_access || null), zoom_url,
        has_prerequisites: r.on("has_prerequisites") || null, subscription: subOf(r.get("subscription", 3)),
        notes: r.get("notes", 600), start_date, end_date,
      })));
      const feat = r.on("featured");
      if (feat) featuredCount.n++;
      seriesEntries.push(sel("local", id, feat));
    }
    const recurring = [];
    for (const s of shared.sharedSeriesList) {
      const place = text(fd, `sh-${s.id}-place`, 20), feat = on(fd, `sh-${s.id}-featured`);
      if (place && feat) featuredCount.n++;
      if (place === "schedule") seriesEntries.push(sel("shared", s.id, feat));
      else if (place === "recurring") recurring.push(sel("shared", s.id, feat));
    }
    // keep any local entries already in "recurring" (none expected)
    for (const e of g.recurring || []) if (e.local) recurring.push(e);
    if (errs.length) throw new FormError(errs);
    return [
      { path: ["local_series"], listReplace: "meetings", items },
      { path: ["series"], value: seriesEntries },
      { path: ["recurring"], value: recurring },
    ];
  },
};

// ------------------------------------------------------------- community

function communityRow(p, s) {
  return `<legend>${s.title ? esc(s.title) : "New community event"}</legend>
    <input type="hidden" name="${p}-id" value="${v(s.id)}">
    ${input(`${p}-title`, "Title", s.title, { wide: true, max: 150 })}
    ${input(`${p}-cadence_text`, "When", s.cadence_text, { wide: true, max: 150, placeholder: "e.g. Tuesdays, 2 to 3:30 PM" })}
    ${input(`${p}-place`, "Place", s.place, { wide: true, max: 200 })}
    ${input(`${p}-url`, "Web page (optional)", s.url, { wide: true })}
    ${s.id ? `<div class="f wide">${check(`${p}-remove`, "<strong>Remove</strong>", false)}</div>` : ""}`;
}

const community = {
  label: "Community events (non-Tergar)",
  render({ g }) {
    const listed = new Set((g.community || []).map((e) => e.local));
    const items = (g.local_series || []).filter((s) => s.cadence_text && listed.has(s.id));
    return `<p class="small">Programs that are not Tergar's, listed separately and clearly labelled. No personal contacts. (Whether groups should list these at all is still an open question.)</p>
      ${textarea("community_note", "Introductory note", g.community_note, { rows: 2, max: 600 })}
      ${rowList("c", items, communityRow, "Add a community event")}`;
  },
  parse(fd, { g }) {
    const errs = [];
    const existing = Object.fromEntries((g.local_series || []).map((s) => [s.id, s]));
    const taken = new Set((g.local_series || []).map((s) => s.id));
    const items = [];
    for (const r of rows(fd, "c")) {
      const id0 = r.get("id", 100);
      if (r.on("remove")) continue;
      const title = r.get("title", 150);
      if (!title) { if (id0) errs.push(`Community event ${r.n}: title is required`); continue; }
      const cadence_text = r.get("cadence_text", 150);
      if (!cadence_text) errs.push(`"${title}": say when it meets`);
      const url = checkUrl(errs, `"${title}"`, r.get("url", 300));
      const cid = id0 && existing[id0] ? id0 : uniqueId(title, taken);
      items.push(mergeKeep(existing[cid], { id: cid, title, cadence_text, place: r.get("place", 200), url }));
    }
    if (errs.length) throw new FormError(errs);
    const note = text(fd, "community_note", 600);
    if (!items.length && !note && !g.community && !g.community_note) return [];
    return [
      { path: ["community_note"], value: note },
      { path: ["local_series"], listReplace: "community", items },
      { path: ["community"], value: items.map((s) => ({ local: s.id })) },
    ];
  },
};

// ---------------------------------------------------------------- events

function localEventRow(p, e) {
  return `<legend>${e.title ? esc(e.title) : "New local event"}</legend>
    <input type="hidden" name="${p}-id" value="${v(e.id)}">
    ${input(`${p}-title`, "Title", e.title, { wide: true, max: 200 })}
    ${input(`${p}-teachers`, "Teacher(s) (optional)", e.teachers, { max: 200 })}
    ${input(`${p}-start`, "Starts", isoDate(e.start) || "", { type: "date" })}
    ${input(`${p}-end`, "Ends (optional)", isoDate(e.end) || "", { type: "date" })}
    ${input(`${p}-time`, "Start time (optional, local)", e.time, { type: "time" })}
    ${input(`${p}-format`, "Format", e.format, { max: 100, placeholder: "In person / Online / ..." })}
    ${input(`${p}-place`, "Place", e.place, { wide: true, max: 200 })}
    <div class="f wide">${check(`${p}-has_prerequisites`, "Has prerequisites (shows a \u201cHas prerequisites\u201d label linked to the event page)", e.has_prerequisites === true)}</div>
    ${select(`${p}-subscription`, "Subscription needed", SUBS, e.subscription || "")}
    ${textarea(`${p}-description`, "Description (our own words)", e.description, { rows: 3, max: 1200 })}
    ${input(`${p}-url`, "More information / registration link", e.url, { wide: true })}
    ${input(`${p}-note`, "Local note (optional)", e._note, { wide: true, max: 300 })}
    <div class="f wide">${check(`${p}-show`, "Show on the page", e.id ? !!e._shown : true)}
    ${check(`${p}-featured`, "Featured block", e._featured)}
    ${e.id ? check(`${p}-remove`, "<strong>Delete this event</strong>", false) : ""}</div>`;
}

const events = {
  label: "Events (program announcements and featured events)",
  render({ g, shared, today }) {
    const chosen = Object.fromEntries((g.events || []).filter((e) => e.shared).map((e) => [e.shared, e]));
    const list = shared.sharedEventsList.filter((e) => chosen[e.id] || !e.last_date || String(e.last_date) >= today)
      .sort((a, b) => String(a.sort_date || "9999").localeCompare(String(b.sort_date || "9999")));
    const rowsHtml = list.map((e) => {
      const c = chosen[e.id] || {};
      const flags = [
        e.needs_review && !e.review_cleared ? `<span class="badge warn">held for review: ${esc(e.needs_review)}</span>` : "",
        e.summary && !e.summary_approved ? `<span class="badge">summary awaiting approval</span>` : "",
        e.restricted === "yes" ? `<span class="badge">has prerequisites</span>` : "",
        e.subscription ? `<span class="badge">${esc(e.subscription)}</span>` : "",
        e.last_date && String(e.last_date) < today ? `<span class="badge">past</span>` : "",
      ].join(" ");
      return `<tr><td><a href="${esc(eventLink(e) || "#")}" target="_blank" rel="noopener">${esc(e.title)}</a>
          <div class="small">${esc(e.start ? `${e.start}${e.end && e.end !== e.start ? " to " + e.end : ""}` : e.date_text || "no dates")}${e.format ? " · " + esc(e.format) : ""}</div><div>${flags}</div></td>
        <td>${check(`ev-${esc(e.id)}-show`, "Show", !!chosen[e.id])}</td>
        <td>${check(`ev-${esc(e.id)}-featured`, "Featured", !!c.featured)}</td>
        <td><input name="ev-${esc(e.id)}-note" value="${v(c.note)}" maxlength="300" placeholder="Local note (optional)"></td></tr>`;
    }).join("");
    const sel = Object.fromEntries((g.events || []).filter((e) => e.local).map((e) => [e.local, e]));
    const locals = (g.local_events || []).map((e) => Object.assign({}, e, { _shown: !!sel[e.id], _featured: !!(sel[e.id] || {}).featured, _note: (sel[e.id] || {}).note }));
    return `
    <h2>Tergar events</h2>
    <p class="small">Tick <strong>Show</strong> to list an event under Program announcements, and <strong>Featured</strong> to also give it a full block (up to ${MAX_FEATURED}). Featured blocks are placed by date, into whichever column is shorter. Events held for review or with a summary awaiting approval can be chosen; the live page holds those parts back until the coordinator clears them.</p>
    <div class="dash-table"><table><thead><tr><th>Event</th><th></th><th></th><th>Local note</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <h2>Your local events</h2>
    <p class="small">Events your group runs or recommends that are not in Tergar's listings.</p>
    ${rowList("le", locals, localEventRow, "Add a local event")}`;
  },
  parse(fd, { g, shared }) {
    const errs = [];
    const selections = [];
    let featured = 0;
    for (const e of shared.sharedEventsList) {
      const show = on(fd, `ev-${e.id}-show`), feat = on(fd, `ev-${e.id}-featured`);
      if (!show && !feat) continue;
      if (feat) featured++;
      selections.push(sel("shared", e.id, feat, text(fd, `ev-${e.id}-note`, 300)));
    }
    const existing = Object.fromEntries((g.local_events || []).map((e) => [e.id, e]));
    const taken = new Set([...(g.local_events || []).map((e) => e.id)]);
    const locals = [];
    for (const r of rows(fd, "le")) {
      const id0 = r.get("id", 100);
      if (r.on("remove")) continue;
      const title = r.get("title", 200);
      if (!title) { if (id0) errs.push(`Local event ${r.n}: title is required`); continue; }
      const label = `"${title}"`;
      const start = checkDate(errs, label, r.get("start", 10)), end = checkDate(errs, label, r.get("end", 10));
      if (!start) errs.push(`${label}: start date is required`);
      if (start && end && end < start) errs.push(`${label}: ends before it starts`);
      const time = r.get("time", 5);
      if (time && !/^\d{2}:\d{2}$/.test(time)) errs.push(`${label}: time looks wrong`);
      const id = id0 && existing[id0] ? id0 : uniqueId(title, taken);
      locals.push(mergeKeep(existing[id], { id, title, teachers: r.get("teachers", 200), start, end, time, format: r.get("format", 100),
        place: r.get("place", 200), has_prerequisites: r.on("has_prerequisites") || null,
        subscription: subOf(r.get("subscription", 3)), description: r.get("description", 1200),
        url: checkUrl(errs, label, r.get("url", 300)) }));
      const show = r.on("show") || r.on("featured");
      if (r.on("featured")) featured++;
      if (show) selections.push(sel("local", id, r.on("featured"), r.get("note", 300)));
    }
    const featSeries = [...(g.series || []), ...(g.recurring || [])].filter((e) => e.featured).length;
    if (featured + featSeries > MAX_FEATURED) errs.push(`Too many featured items: ${featured} events plus ${featSeries} featured meeting series; the limit is ${MAX_FEATURED}`);
    if (errs.length) throw new FormError(errs);
    // keep the existing order (smaller commits); new selections go last
    const pos = new Map((g.events || []).map((e, i) => [e.shared ? "s:" + e.shared : "l:" + e.local, i]));
    const at = (e) => { const k = e.shared ? "s:" + e.shared : "l:" + e.local; return pos.has(k) ? pos.get(k) : 1e6; };
    selections.sort((a, b) => at(a) - at(b));
    return [{ path: ["events"], value: selections }, { path: ["local_events"], value: locals }];
  },
};

export const GROUP_BLOCKS = {
  header, announcement, quote, next_meeting: nextMeeting, schedule, community, events,
  from_tergar: pickList("from_tergar", "From Tergar", "Choose items from Tergar to show"),
  resources: pickList("resources", "Resource links", "Choose resource links to show"),
};
export const groupBlockFile = (ctx) => groupFile(ctx.g.path);

// ======================================================= shared library

const review = {
  label: "Event review, labels and links",
  file: SHARED_EVENTS,
  render({ shared, today }) {
    const list = shared.sharedEventsList.filter((e) => !e.last_date || String(e.last_date) >= today);
    return `<p class="small">An event flagged by the collector stays off the live pages until you clear it. A summary stays off until you approve it. If the collector later rewrites a summary, its approval resets.
      "Has prerequisites" comes from the collector (the source page says restricted or prerequisites apply). Set a subscription label by hand. The event link is the page the title, register link and labels open; it is chosen automatically (never the whole Tergar calendar) unless you enter one.</p>
    <div class="dash-table"><table><thead><tr><th>Event</th><th>Flag</th><th>Summary</th><th>Labels and link</th></tr></thead><tbody>
    ${list.map((e) => `<tr><td><a href="${esc(eventLink(e) || "#")}" target="_blank" rel="noopener">${esc(e.title)}</a><div class="small">${esc(e.start || e.date_text || "no dates")}</div>${e.restricted === "yes" ? `<div><span class="badge">has prerequisites</span></div>` : ""}</td>
      <td>${e.needs_review ? `<div class="small">${esc(e.needs_review)}</div>${check(`rv-${esc(e.id)}-cleared`, "Cleared to publish", !!e.review_cleared)}` : `<span class="small">none</span>`}</td>
      <td>${e.summary ? `<div class="small summary-text">${esc(e.summary)}</div>${check(`rv-${esc(e.id)}-approved`, "Approved", !!e.summary_approved)}` : `<span class="small">no summary</span>`}</td>
      <td>${select(`rv-${esc(e.id)}-subscription`, "Subscription", SUBS, e.subscription || "")}
        ${input(`rv-${esc(e.id)}-event_url`, "Event link (optional)", e.event_url || "", { max: 400, placeholder: "automatic", hint: `Now: ${esc(eventLink(e) || "none")}` })}</td></tr>`).join("")}
    </tbody></table></div>`;
  },
  parse(fd, { shared, today }) {
    const ops = [], errs = [];
    for (const e of shared.sharedEventsList.filter((x) => !x.last_date || String(x.last_date) >= today)) {
      if (e.needs_review) {
        const want = on(fd, `rv-${e.id}-cleared`);
        if (want !== !!e.review_cleared) ops.push({ path: ["events", { id: e.id }, "review_cleared"], value: want });
      }
      if (e.summary) {
        const want = on(fd, `rv-${e.id}-approved`);
        if (want !== !!e.summary_approved) ops.push({ path: ["events", { id: e.id }, "summary_approved"], value: want });
      }
      const sub = subOf(text(fd, `rv-${e.id}-subscription`, 3));
      if (sub !== subOf(e.subscription)) ops.push({ path: ["events", { id: e.id }, "subscription"], value: sub || undefined });
      const url = checkUrl(errs, `"${e.title}"`, text(fd, `rv-${e.id}-event_url`, 400)) || null;
      if (url !== (e.event_url || null)) ops.push({ path: ["events", { id: e.id }, "event_url"], value: url || undefined });
    }
    if (errs.length) throw new FormError(errs);
    if (!ops.length) throw new FormError(["Nothing was changed"]);
    return ops;
  },
};

const libRow = {
  quotes: (p, q) => `<input type="hidden" name="${p}-id" value="${v(q.id)}">
    ${textarea(`${p}-text`, "Quote", q.text, { rows: 2, max: 500 })}${input(`${p}-by`, "By", q.by, { wide: true, max: 150 })}
    ${q.id ? `<div class="f wide">${check(`${p}-remove`, "<strong>Remove</strong>", false)}</div>` : ""}`,
  from_tergar: (p, t) => `<input type="hidden" name="${p}-id" value="${v(t.id)}">
    ${input(`${p}-title`, "Title", t.title, { wide: true, max: 200 })}${textarea(`${p}-text`, "Short description (our words)", t.text, { rows: 2, max: 400 })}${input(`${p}-url`, "Link", t.url, { wide: true })}
    ${t.id ? `<div class="f wide">${check(`${p}-remove`, "<strong>Remove</strong>", false)}</div>` : ""}`,
  resources: (p, r) => `<input type="hidden" name="${p}-id" value="${v(r.id)}">
    ${input(`${p}-title`, "Title", r.title, { wide: true, max: 200 })}${input(`${p}-url`, "Link", r.url, { wide: true })}
    ${r.id ? `<div class="f wide">${check(`${p}-remove`, "<strong>Remove</strong>", false)}</div>` : ""}`,
};

const lists = {
  label: "Quotes, From Tergar items and resource links",
  file: LIBRARY,
  render({ shared }) {
    const lib = shared.library;
    return `<p class="small">Groups choose from these lists. Removing an item that a group uses hides it on that group's page.</p>
      <h2>Quotes</h2>${rowList("q", lib.quotes || [], libRow.quotes, "Add a quote")}
      <h2>From Tergar</h2>${rowList("t", lib.from_tergar || [], libRow.from_tergar, "Add an item")}
      <h2>Resource links</h2>${rowList("r", lib.resources || [], libRow.resources, "Add a link")}`;
  },
  parse(fd, { shared }) {
    const errs = [];
    const lib = shared.library;
    const build = (prefix, key, fields, need) => {
      const taken = new Set((lib[key] || []).map((x) => x.id));
      const known = new Set(taken);
      const out = [];
      for (const r of rows(fd, prefix)) {
        if (r.on("remove")) continue;
        const o = {};
        for (const [f, max] of fields) o[f] = r.get(f, max);
        if (!o[need]) continue;
        if (o.url) checkUrl(errs, `"${o.title || o.text}"`, o.url);
        if (fields.some(([f]) => f === "url") && !o.url) errs.push(`"${o.title}": link is required`);
        const id0 = r.get("id", 100);
        const id = id0 && known.has(id0) ? id0 : uniqueId(o.title || o.text.slice(0, 40), taken);
        out.push(mergeKeep((lib[key] || []).find((x) => x.id === id), Object.assign({ id }, o)));
      }
      return out;
    };
    const quotes = build("q", "quotes", [["text", 500], ["by", 150]], "text");
    const from_tergar = build("t", "from_tergar", [["title", 200], ["text", 400], ["url", 300]], "title");
    const resources = build("r", "resources", [["title", 200], ["url", 300]], "title");
    if (errs.length) throw new FormError(errs);
    return [{ path: ["quotes"], value: quotes }, { path: ["from_tergar"], value: from_tergar }, { path: ["resources"], value: resources }];
  },
};

export const LIBRARY_BLOCKS = { review, lists };
