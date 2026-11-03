// Living Group Pages renderer.
// One module used by both the site build (scripts/build.mjs, Node) and the
// dashboard (Cloudflare Worker), so previews match what publishes.
// Pure functions: no file or network access. Dates are 'YYYY-MM-DD' strings.
//
// Rules: docs/living-group-pages-handoff.md and CLAUDE.md
// ("Decisions since the handoff" take precedence).

export const MAX_FEATURED = 10;

const ZONE_ABBR = {
  "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT",
  "America/Phoenix": "MST", "America/Los_Angeles": "PT",
};
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ORD = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const FORMAT_TEXT = { in_person: "In person", zoom: "Zoom", both: "In person and Zoom" };

// ---------------------------------------------------------------- helpers

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const pad = (n) => String(n).padStart(2, "0");

/** 'YYYY-MM-DD' (or Date / YAML date) -> 'YYYY-MM-DD' or null */
export function isoDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function parts(iso) { const [y, m, d] = iso.split("-").map(Number); return { y, m, d }; }
function utcDate(iso) { const { y, m, d } = parts(iso); return new Date(Date.UTC(y, m - 1, d)); }
function addDays(iso, n) { const t = utcDate(iso); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function weekdayIndex(iso) { return (utcDate(iso).getUTCDay() + 6) % 7; } // Monday = 0
function daysBetween(a, b) { return Math.round((utcDate(b) - utcDate(a)) / 86400000); }

/** Today's date in a time zone. */
export function todayIn(zone, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Wall-clock fields of an instant in a zone. */
function wall(ms, zone) {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms))
    .forEach((x) => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute };
}
/** Instant (ms) for a wall-clock time in a zone (handles daylight saving). */
function zonedToUtc(iso, hhmm, zone) {
  const { y, m, d } = parts(iso);
  const [h, mi] = String(hhmm).split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const w = wall(t, zone);
    const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
    t += guess - asUtc;
  }
  return t;
}
function fmt12(h, mi) { return `${((h + 11) % 12) + 1}:${pad(mi)} ${h >= 12 ? "pm" : "am"}`; }
function zoneAbbr(zone, ms) {
  if (ZONE_ABBR[zone]) return ZONE_ABBR[zone];
  const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(ms));
  return (p.find((x) => x.type === "timeZoneName") || {}).value || zone;
}

/** '10:00 am ET / 15:00 UTC': the group's zone first, then UTC. */
export function timeLabel(dayIso, hhmm, srcZone, groupZone) {
  if (!hhmm || !dayIso) return null;
  const ms = zonedToUtc(dayIso, hhmm, srcZone || groupZone);
  const local = wall(ms, groupZone);
  const u = new Date(ms);
  let label = `${fmt12(local.h, local.mi)} ${zoneAbbr(groupZone, ms)} / ${pad(u.getUTCHours())}:${pad(u.getUTCMinutes())} UTC`;
  const localIso = `${local.y}-${pad(local.m)}-${pad(local.d)}`;
  const utcIso = u.toISOString().slice(0, 10);
  if (utcIso > localIso) label += " (next day)";
  else if (utcIso < localIso) label += " (previous day)";
  return label;
}

export function fmtDay(iso) {
  const { m, d } = parts(iso);
  return `${WEEKDAYS[weekdayIndex(iso)].slice(0, 3)}, ${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

export function dateRange(start, end, today) {
  if (!start) return null;
  end = end || start;
  const ys = parts(start).y, ye = parts(end).y, yt = parts(today).y;
  const showYear = !(ys === yt && ye === yt);
  if (end === start) return fmtDay(start) + (showYear ? `, ${ys}` : "");
  if (ys !== ye) return `${fmtDay(start)}, ${ys} – ${fmtDay(end)}, ${ye}`;
  return `${fmtDay(start)} – ${fmtDay(end)}${showYear ? `, ${ys}` : ""}`;
}

// ---------------------------------------------------------- meeting series

export function seriesDates(s, today, count = 10) {
  const wd = WEEKDAYS.indexOf(s.weekday);
  const start = isoDate(s.start_date), end = isoDate(s.end_date);
  let d = start && start > today ? start : today;
  const out = [];
  for (let k = 0; k < 800; k++) {
    if (end && d > end) break;
    let ok = weekdayIndex(d) === wd;
    if (ok && s.cadence === "monthly_weeks") ok = (s.weeks || []).includes(Math.floor((parts(d).d - 1) / 7) + 1);
    if (ok && s.cadence === "every_other_week") ok = Math.floor(daysBetween(isoDate(s.anchor_date), d) / 7) % 2 === 0;
    if (ok) { out.push(d); if (out.length >= count) break; }
    d = addDays(d, 1);
  }
  return out;
}

export function cadenceText(s) {
  if (s.cadence === "weekly") return `Every ${s.weekday}`;
  if (s.cadence === "every_other_week") return `Every other ${s.weekday}`;
  const w = (s.weeks || []).map((n) => ORD[n]);
  const joined = w.length <= 2 ? w.join(" and ") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
  return `${joined} ${s.weekday}s of the month`;
}

// ----------------------------------------------------------- access lines

const GENERIC_PREREQ = /^Prerequisites apply( \(details not shown on calendar\)| \(see (linked )?page\))?$/;

/** [kind, text]. Never 'Open to everyone' for a gated or unknown event. */
export function accessLine(restricted, prerequisites) {
  if (restricted === "yes") {
    if (!prerequisites || GENERIC_PREREQ.test(prerequisites))
      return ["requires", "Requires: prerequisites set by the organizer; see the event page for details."];
    return ["requires", "Requires: " + prerequisites];
  }
  if (restricted === "no") return ["open", "Open to everyone"];
  return ["unknown", "Access not stated, check the event page."];
}

export function tidyPlace(place, fmt) {
  if (!place) return null;
  let p = String(place).split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean)
    .map((x) => (/^online( event)?$/i.test(x) ? "Online" : x));
  if (p.length === 1 && p[0] === "Online" && fmt && /online/i.test(fmt)) return null;
  return p.join("; ");
}

/** Months already passed this year, named without a year. */
export function staleMonths(text, today) {
  const out = [];
  const re = new RegExp(`\\b(${MONTHS.join("|")})\\b(?!,?\\s+\\d{4})`, "g");
  let m;
  const month = parts(today).m;
  while ((m = re.exec(text || "")) !== null) if (MONTHS.indexOf(m[1]) + 1 < month) out.push(m[1]);
  return out;
}

// ------------------------------------------------------------ page model

/**
 * Build the page model for one group.
 * data = { group, sharedEvents: {id: ev}, sharedSeries: {id: s}, library, contacts: {path: addr} }
 * opts = { today, mode: 'preview'|'publish' }
 */
export function buildGroup(data, opts) {
  const { group: g, sharedEvents, sharedSeries, library: lib } = data;
  const contacts = data.contacts || {};
  const today = opts.today;
  const preview = opts.mode === "preview";
  const zone = g.time_zone;
  const page = { g, preview, issues: [] };
  const issue = (t) => page.issues.push(t);

  // Contact (role address, only with the group's consent)
  const c = Object.assign({}, g.contact || {});
  if (!c.address) c.address = contacts[g.path];
  page.contact = null;
  if (c.address) {
    if (c.consent) page.contact = { address: c.address, draft: false };
    else if (preview) { page.contact = { address: c.address, draft: true }; issue(`Contact ${c.address} is shown in preview only: group consent not yet recorded`); }
    else issue("Contact not published: group consent not yet recorded");
  }

  const quotes = Object.fromEntries((lib.quotes || []).map((q) => [q.id, q]));
  page.quote = g.quote ? quotes[g.quote] || null : null;
  if (g.quote && !page.quote) issue(`Quote id '${g.quote}' not found in the shared library`);

  page.announcement = g.first_announcement || null;
  page.announcementFlags = page.announcement ? staleMonths(page.announcement, today) : [];
  for (const mname of page.announcementFlags)
    issue(`First announcement mentions ${mname} with no year, and ${mname} has passed: please correct`);

  // Meeting series:
  //   series    -> Meeting schedule (the group's own meetings only)
  //   recurring -> Program announcements, "Recurring" (other Tergar series)
  //   community -> Program announcements, "Community events (non-Tergar)"
  const localSeries = Object.fromEntries((g.local_series || []).map((s) => [s.id, s]));
  const seriesItem = (entry) => {
    const s = entry.shared ? sharedSeries[entry.shared] : localSeries[entry.local];
    if (!s) { issue(`Meeting series ${JSON.stringify(entry)} not found`); return null; }
    if (s.cadence_text) {
      return { title: s.title, host: s.host, cadence: s.cadence_text, place: s.place, url: s.url,
        notes: s.notes, links: s.links || [], featured: false };
    }
    const dates = seriesDates(s, today);
    if (!dates.length) return null; // ended series are hidden
    const fmt = s.format || "zoom";
    let zoomText = null, zoomUrl = null;
    if (fmt === "zoom" || fmt === "both") {
      if (s.zoom_access === "shown" && s.zoom_url) { zoomText = "Join on Zoom"; zoomUrl = s.zoom_url; }
      else zoomText = "Zoom link on request";
    }
    return {
      id: s.id, title: s.title, host: s.host, cadence: cadenceText(s),
      time: timeLabel(dates[0], s.start_time, s.time_zone, zone),
      format: FORMAT_TEXT[fmt] || fmt, place: s.place,
      next: fmtDay(dates[0]), nextDate: dates[0],
      datesJson: JSON.stringify(dates.map((d) => [d, fmtDay(d), timeLabel(d, s.start_time, s.time_zone, zone)])),
      zoomText, zoomUrl, requires: s.requires ? "Requires: " + s.requires : null,
      notes: s.notes, description: s.description, links: s.links || [], url: s.url,
      featured: !!entry.featured,
    };
  };
  page.schedule = (g.series || []).map(seriesItem).filter(Boolean);
  page.recurring = (g.recurring || []).map(seriesItem).filter(Boolean);
  page.community = (g.community || []).map(seriesItem).filter(Boolean);
  page.communityNote = g.community_note || null;
  page.zoomOnRequest = [...page.schedule, ...page.recurring].some((x) => x.zoomText && !x.zoomUrl);

  // Next meeting (hidden once its date has passed)
  const nm = g.next_meeting;
  const nmDate = nm ? isoDate(nm.date) : null;
  page.nextMeeting = nm && (!nmDate || nmDate >= today) ? Object.assign({}, nm, { date: nmDate, day: nmDate ? fmtDay(nmDate) : null }) : null;

  // Events
  const localEvents = Object.fromEntries((g.local_events || []).map((e) => [e.id, e]));
  const items = [];
  for (const sel of g.events || []) {
    let item;
    if (sel.shared) {
      const ev = sharedEvents[sel.shared];
      if (!ev) { issue(`Shared event id not found (maybe renamed by the collector): ${sel.shared}`); continue; }
      const start = isoDate(ev.start), end = isoDate(ev.end);
      const badges = [];
      if (ev.needs_review && !ev.review_cleared) {
        if (!preview) { issue(`Not published (needs review): ${ev.title} - ${ev.needs_review}`); continue; }
        badges.push("Needs review: " + ev.needs_review);
        issue(`Needs review (hidden in publish build): ${ev.title}`);
      }
      let summary = ev.summary || null, summaryDraft = false;
      if (summary && !ev.summary_approved) { if (preview) summaryDraft = true; else summary = null; }
      const [kind, access] = accessLine(ev.restricted, ev.prerequisites);
      item = {
        id: ev.id, title: ev.title, local: false, start, end,
        sort: isoDate(ev.sort_date), last: isoDate(ev.last_date),
        dateText: dateRange(start, end, today) || ev.date_text || "Dates not listed",
        time: ev.time ? timeLabel(start, ev.time, ev.time_zone, zone) : null,
        teachers: ev.teachers, format: ev.format, place: tidyPlace(ev.place, ev.format), languages: ev.languages,
        accessKind: kind, access, summary, summaryDraft,
        sourceUrl: ev.source_url, registrationUrl: ev.registration_url,
        attribution: ev.attribution || "Event information from Tergar", badges,
      };
    } else {
      const ev = localEvents[sel.local];
      if (!ev) { issue(`Local event id not found: ${sel.local}`); continue; }
      const start = isoDate(ev.start), end = isoDate(ev.end);
      item = {
        id: ev.id, title: ev.title, local: true, start, end, sort: start, last: end || start,
        dateText: dateRange(start, end, today) || "Dates not listed",
        time: ev.time ? timeLabel(start, ev.time, zone, zone) : null,
        teachers: ev.teachers, format: ev.format, place: ev.place, languages: null,
        accessKind: ev.requires ? "requires" : null, access: ev.requires ? "Requires: " + ev.requires : null,
        summary: ev.description, summaryDraft: false,
        sourceUrl: null, registrationUrl: ev.url, attribution: null, badges: [],
      };
    }
    if (item.last && item.last < today) continue; // past events drop off
    if (!item.sort) {
      if (preview) item.badges.push("No dates: hidden from the publish build");
      else { issue(`Not published (no dates): ${item.title}`); continue; }
    }
    item.featured = !!sel.featured;
    item.note = sel.note || null;
    items.push(item);
  }
  const drafts = items.filter((x) => x.summaryDraft && x.featured).map((x) => x.title);
  if (drafts.length) issue(`${drafts.length} featured summar${drafts.length === 1 ? "y" : "ies"} not yet approved (hidden in publish build): ${drafts.join("; ")}`);

  const byDate = (a, b) => ((a.sort || "9999") + a.title < (b.sort || "9999") + b.title ? -1 : 1);
  items.sort(byDate);
  // Featured: events and series together, closest first (a series by its next
  // meeting). Column placement happens in the browser by measured height
  // (each block goes into the shorter column); 'side' is the no-JS fallback.
  let featured = items.filter((x) => x.featured).map((x) => Object.assign({ kind: "event" }, x));
  for (const s of [...page.schedule, ...page.recurring]) if (s.featured) featured.push(Object.assign({ kind: "series", sort: s.nextDate }, s));
  featured.sort(byDate);
  if (featured.length > MAX_FEATURED) {
    issue(`${featured.length} items featured; only the first ${MAX_FEATURED} (by date) are shown as blocks`);
    featured = featured.slice(0, MAX_FEATURED);
  }
  featured.forEach((x, i) => { x.featIndex = i; x.side = i % 2 === 0 ? "L" : "R"; });
  page.announcements = items;
  page.featured = featured;

  const ft = Object.fromEntries((lib.from_tergar || []).map((x) => [x.id, x]));
  const rs = Object.fromEntries((lib.resources || []).map((x) => [x.id, x]));
  page.fromTergar = (g.from_tergar || []).filter((i) => ft[i]).map((i) => ft[i]);
  page.resources = (g.resources || []).filter((i) => rs[i]).map((i) => rs[i]);
  (g.from_tergar || []).filter((i) => !ft[i]).forEach((i) => issue(`From Tergar id not found: ${i}`));
  (g.resources || []).filter((i) => !rs[i]).forEach((i) => issue(`Resource id not found: ${i}`));
  return page;
}

// ---------------------------------------------------------------- HTML

const when = (cond, html) => (cond ? html : "");

function featuredHtml(x, ed = () => "") {
  if (x.kind === "series") {
    return `<section class="blk feat series" data-feat="${x.featIndex}" data-dates='${esc(x.datesJson)}' style="order:${10 + x.featIndex}">
  <div class="kicker">Featured</div>${ed("schedule")}
  <h3 class="title-blue">${esc(x.title)}</h3>
  <div class="with">${esc(x.cadence)} · <span class="s-time">${esc(x.time)}</span></div>
  <div class="meta">${esc(x.format)}${when(x.place, ` · ${esc(x.place)}`)}${when(x.host, ` · hosted by ${esc(x.host)}`)}</div>
  <div class="meta">Next: <span class="s-next">${esc(x.next)}</span></div>
  ${when(x.requires, `<div class="requires">${esc(x.requires)}</div>`)}
  ${when(x.description, `<p class="summary">${esc(x.description)}</p>`)}
  ${when(x.notes, `<p class="summary">${esc(x.notes)}</p>`)}
  ${x.links.map((l) => `<div><a href="${esc(l.url)}">${esc(l.title)}</a></div>`).join("")}
  ${x.zoomUrl ? `<div><a class="cta" href="${esc(x.zoomUrl)}">${esc(x.zoomText)}</a></div>` : when(x.zoomText, `<div class="meta">${esc(x.zoomText)}</div>`)}
</section>`;
  }
  const access = x.accessKind === "requires" ? `<div class="requires">${esc(x.access)}</div>`
    : x.accessKind === "unknown" ? `<div class="requires unknown">${esc(x.access)}</div>`
    : x.accessKind === "open" ? `<div class="meta">${esc(x.access)}</div>` : "";
  return `<section class="blk feat" data-feat="${x.featIndex}" data-last="${esc(x.last || "")}" style="order:${10 + x.featIndex}">
  <div class="kicker">Featured event</div>${ed("events")}
  <h3 class="title-blue">${esc(x.title)}</h3>
  ${when(x.teachers, `<div class="with">with ${esc(x.teachers)}</div>`)}
  <div class="meta"><strong>${esc(x.dateText)}</strong>${when(x.time, ` · ${esc(x.time)}`)}</div>
  <div class="meta">${esc(x.format || "")}${when(x.place && x.place !== x.format, ` · ${esc(x.place)}`)}</div>
  ${when(x.languages, `<div class="meta">Language: ${esc(x.languages)}</div>`)}
  ${access}
  ${when(x.summary, `<p class="summary">${esc(x.summary)}</p>${when(x.summaryDraft, `<div class="badge warn">Draft summary: not yet reviewed (hidden in the publish build)</div>`)}`)}
  ${when(x.note, `<div class="localnote"><strong>Local note:</strong> ${esc(x.note)}</div>`)}
  ${when(x.registrationUrl, `<div><a class="cta" href="${esc(x.registrationUrl)}">More information and registration</a></div>`)}
  ${when(x.sourceUrl, `<div class="attrib">${esc(x.attribution)}: <a href="${esc(x.sourceUrl)}">source page</a></div>`)}
  ${x.badges.map((b) => `<div class="badge warn">${esc(b)}</div>`).join("")}
</section>`;
}

/**
 * The page body (everything inside <body>), used by the full page and by
 * dashboard previews. ctx = { assets, editable } ; editable adds Edit buttons.
 */
export function renderGroupBody(page, ctx) {
  const g = page.g;
  const a = ctx.assets;
  // Edit buttons (dashboard only); ctx.pending lists blocks with a change awaiting approval.
  const ed = (key) => (ctx.editable ? `<button type="button" class="ed" data-edit="${key}">Edit${(ctx.pending || []).includes(key) ? ' <span class="pend">change pending</span>' : ""}</button>` : "");
  const art = `url('${a}/indras-net.jpg')`;

  const schedule = page.schedule.length ? `<section class="blk sched" style="order:3">
    <h2 class="band band-green">Meeting schedule</h2>${ed("schedule")}
    ${page.schedule.map((s) => `<div class="item series" data-dates='${esc(s.datesJson)}'>
      <h3>${esc(s.title)}</h3>
      <div class="meta">${esc(s.cadence)} · <span class="s-time">${esc(s.time)}</span></div>
      <div class="meta">${esc(s.format)}${when(s.place, ` · ${esc(s.place)}`)}${when(s.host, ` · hosted by ${esc(s.host)}`)}</div>
      <div class="meta">Next: <span class="s-next">${esc(s.next)}</span></div>
      ${when(s.requires, `<div class="requires">${esc(s.requires)}</div>`)}
      ${when(s.notes, `<div class="meta">${esc(s.notes)}</div>`)}
      ${s.zoomUrl ? `<div><a class="cta" href="${esc(s.zoomUrl)}">${esc(s.zoomText)}</a></div>` : when(s.zoomText, `<div class="meta">Zoom link on request</div>`)}
      ${s.links.map((l) => `<div><a href="${esc(l.url)}">${esc(l.title)}</a></div>`).join("")}
    </div>`).join("")}
    <p class="small">Times are shown in the group's local time, then UTC.
    ${when(page.zoomOnRequest, `To request a Zoom link, ${page.contact ? `email <a href="mailto:${esc(page.contact.address)}">${esc(page.contact.address)}</a>.` : "contact the group."}`)}</p>
  </section>` : (ctx.editable ? `<section class="blk sched empty" style="order:3"><h2 class="band band-green">Meeting schedule</h2>${ed("schedule")}<p class="small">No meetings listed. Hidden on the public page.</p></section>` : "");

  const hasPa = page.announcements.length || page.recurring.length || page.community.length;
  const pa = hasPa ? `<section class="blk pa" style="order:5" id="pa">
    <h2 class="band band-aqua">Program announcements</h2>${ed("events")}
    ${page.announcements.length ? `${when(page.recurring.length || page.community.length, `<div class="pa-sub">Upcoming events</div>`)}
    <ul class="pa-list" id="pa-events">
      ${page.announcements.map((x) => `<li data-last="${esc(x.last || "")}">
        <span class="pa-date">${esc(x.dateText)}</span>
        ${x.sourceUrl ? `<a href="${esc(x.sourceUrl)}">${esc(x.title)}</a>` : x.registrationUrl ? `<a href="${esc(x.registrationUrl)}">${esc(x.title)}</a>` : esc(x.title)}
        ${when(x.time, `<span class="meta"> · ${esc(x.time)}</span>`)}
        ${when(!x.local, `<span class="meta"> · from Tergar</span>`)}
        ${when(x.note, `<span class="tag">local note</span>`)}
        ${when(x.accessKind === "requires" || x.accessKind === "unknown", `<div class="requires small">${esc(x.access)}</div>`)}
        ${x.badges.map((b) => `<div class="badge warn">${esc(b)}</div>`).join("")}
      </li>`).join("")}
    </ul>` : ""}
    ${page.recurring.length ? `<div class="pa-sub">Recurring</div>
    <ul class="pa-list">
      ${page.recurring.map((s) => `<li class="series" data-dates='${esc(s.datesJson)}'>
        <strong>${esc(s.title)}</strong>${when(s.host, ` with ${esc(s.host)}`)}.
        ${esc(s.cadence)}, <span class="s-time">${esc(s.time)}</span>. ${esc(s.format)}${when(s.zoomText && !s.zoomUrl, " (Zoom link on request)")}.
        <span class="meta">Next: <span class="s-next">${esc(s.next)}</span></span>
        ${when(s.requires, `<div class="requires small">${esc(s.requires)}</div>`)}
      </li>`).join("")}
    </ul>` : ""}
    ${page.community.length ? `<div class="pa-sub">Community events (non-Tergar)${ctx.editable ? `<button type="button" class="ed ed-inline" data-edit="community">Edit${(ctx.pending || []).includes("community") ? ' <span class="pend">change pending</span>' : ""}</button>` : ""}</div>
    ${when(page.communityNote, `<p class="small">${esc(page.communityNote)}</p>`)}
    <ul class="pa-list">
      ${page.community.map((s) => `<li><strong>${esc(s.title)}</strong>. ${esc(s.cadence)}${when(s.place, `, ${esc(s.place)}`)}.
        ${when(s.url, `<a href="${esc(s.url)}">More information</a>`)}</li>`).join("")}
    </ul>` : ""}
  </section>` : (ctx.editable ? `<section class="blk pa empty" style="order:5" id="pa"><h2 class="band band-aqua">Program announcements</h2>${ed("events")}<p class="small">No events selected. Hidden on the public page.</p></section>` : "");

  const ann = page.announcement ? `<section class="blk ann" style="order:2">
    <h2 class="band band-cream">Announcement</h2>${ed("announcement")}
    <p>${esc(page.announcement)}</p>
    ${when(page.preview && page.announcementFlags.length, `<p class="badge warn">Flag: mentions ${esc(page.announcementFlags.join(", "))} with no year, and that month has passed.</p>`)}
  </section>` : (ctx.editable ? `<section class="blk ann empty" style="order:2"><h2 class="band band-cream">Announcement</h2>${ed("announcement")}<p class="small">None. Hidden on the public page.</p></section>` : "");

  const nm = page.nextMeeting;
  const next = nm ? `<section class="blk next" style="order:4" data-date="${esc(nm.date || "")}">
    <h2 class="band band-green">Next meeting${when(nm.day, `: ${esc(nm.day)}`)}</h2>${ed("next_meeting")}
    <h3 class="title-blue">${esc(nm.title)}</h3>
    ${when(nm.description, `<p>${esc(nm.description)}</p>`)}
    ${when(nm.reading, `<div class="sub-h">Reading</div><p>${esc(nm.reading)}</p>`)}
    ${when(nm.contemplation, `<div class="contemplation"><div class="sub-h">Contemplation</div><p>${esc(nm.contemplation)}</p></div>`)}
  </section>` : (ctx.editable ? `<section class="blk next empty" style="order:4"><h2 class="band band-green">Next meeting</h2>${ed("next_meeting")}<p class="small">None. Hidden on the public page.</p></section>` : "");

  const tergar = page.fromTergar.length ? `<section class="blk tergar" style="order:40">
    <h2 class="band band-cream">From Tergar</h2>${ed("from_tergar")}
    ${page.fromTergar.map((t) => `<div class="item"><h3><a href="${esc(t.url)}">${esc(t.title)}</a></h3>${when(t.text, `<div class="meta">${esc(t.text)}</div>`)}</div>`).join("")}
  </section>` : (ctx.editable ? `<section class="blk tergar empty" style="order:40"><h2 class="band band-cream">From Tergar</h2>${ed("from_tergar")}<p class="small">Nothing chosen. Hidden on the public page.</p></section>` : "");

  const res = page.resources.length ? `<section class="blk res" style="order:41">
    <h2 class="band band-lavender">Resource links</h2>${ed("resources")}
    <ul class="res-list">${page.resources.map((r) => `<li><a href="${esc(r.url)}">${esc(r.title)}</a></li>`).join("")}</ul>
  </section>` : (ctx.editable ? `<section class="blk res empty" style="order:41"><h2 class="band band-lavender">Resource links</h2>${ed("resources")}<p class="small">Nothing chosen. Hidden on the public page.</p></section>` : "");

  const quote = page.quote ? `<section class="blk quote" style="order:1">
    <blockquote>“${esc(page.quote.text)}”</blockquote><div class="by">— ${esc(page.quote.by)}</div>${ed("quote")}
  </section>` : (ctx.editable ? `<section class="blk quote empty" style="order:1"><p class="small">No quote chosen. Hidden on the public page.</p>${ed("quote")}</section>` : "");

  const featL = page.featured.filter((x) => x.side === "L").map((x) => featuredHtml(x, ed)).join("");
  const featR = page.featured.filter((x) => x.side === "R").map((x) => featuredHtml(x, ed)).join("");

  return `<main class="page${ctx.editable ? " editing" : ""}">
  <header class="blk hdr" style="order:0;background-image:linear-gradient(90deg,rgba(12,22,34,.86),rgba(12,22,34,.55)),${art}">
    <h1>${esc(g.name)}</h1>
    <p class="hdr-sub">${esc(g.full_name)} · ${esc(g.location)}</p>${ed("header")}
  </header>
  ${when(g.about, `<section class="blk intro" style="order:1"><p>${esc(g.about)}</p></section>`)}
  ${quote}
  <div class="cols">
    <div class="col colL">
      ${ann}${schedule}${pa}${featL}
      <div class="feat-anchor" data-side="L" hidden></div>
      ${tergar}
      <div class="filler" aria-hidden="true" style="background-image:${art}"></div>
    </div>
    <div class="col colR">
      ${next}${featR}
      <div class="feat-anchor" data-side="R" hidden></div>
      ${res}
      <div class="filler" aria-hidden="true" style="background-image:${art}"></div>
    </div>
  </div>
  <footer class="blk foot" style="order:50">
    <p><strong>tergargroups.org is an independent site and is not an official Tergar site.</strong>
      It carries practice and community information only.</p>
    <p>Event information comes from Tergar and links to its source page. Event summaries are written for this site.</p>
    ${when(page.contact, `<p>Contact: <a href="mailto:${esc(page.contact && page.contact.address)}">${esc(page.contact && page.contact.address)}</a>${when(page.contact && page.contact.draft, ` <span class="badge warn">preview only: group consent not yet recorded</span>`)}</p>`)}
    <p class="small">Updated ${esc(ctx.built)}</p>
  </footer>
</main>`;
}

export function renderGroupPage(page, ctx) {
  const g = page.g;
  const bar = page.preview ? `<div class="preview-bar">
  <strong>Preview: not for publishing.</strong> Built ${esc(ctx.built)}.
  ${page.issues.length ? `<details><summary>${page.issues.length} item${page.issues.length === 1 ? "" : "s"} to review</summary>
    <ul>${page.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></details>` : "No review items."}
</div>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(g.name)}${page.preview ? " (preview)" : ""}</title>
<meta name="description" content="${esc(g.full_name)}, ${esc(g.location)}: meeting schedule and upcoming events.">
${page.preview ? '<meta name="robots" content="noindex">' : ""}
<link rel="stylesheet" href="${ctx.assets}/site.css">
</head>
<body data-zone="${esc(g.time_zone)}">
${bar}
${renderGroupBody(page, ctx)}
<script src="${ctx.assets}/site.js"></script>
</body>
</html>
`;
}

export function renderIndex(groups, ctx) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tergar Groups${ctx.preview ? " (preview)" : ""}</title>
${ctx.preview ? '<meta name="robots" content="noindex">' : ""}
<link rel="stylesheet" href="${ctx.assets}/site.css">
</head>
<body>
<main class="page">
  <header class="blk hdr" style="background-image:linear-gradient(90deg,rgba(12,22,34,.86),rgba(12,22,34,.55)),url('${ctx.assets}/indras-net.jpg')">
    <h1>Tergar Groups</h1>
    <p class="hdr-sub">Local meditation group pages</p>
  </header>
  <section class="blk">
    <ul class="res-list">
      ${groups.map((g) => `<li><a href="${esc(g.path)}/">${esc(g.full_name)}</a> · ${esc(g.location)}</li>`).join("")}
    </ul>
  </section>
  <footer class="blk foot">
    <p><strong>tergargroups.org is an independent site and is not an official Tergar site.</strong>
      It carries practice and community information only.</p>
  </footer>
</main>
</body>
</html>
`;
}
