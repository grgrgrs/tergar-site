// Living Group Pages dashboard (admin.tergargroups.org).
//   /                          home: your groups
//   /g/<group>                 Group Dashboard: the page in edit mode
//   /g/<group>/edit/<block>    edit one block; saving makes a pending change
//   /approvals                 pending changes for your groups
//   /approvals/<id>            preview a change; approve or reject
//   /library                   Shared Library (coordinator only)
//   /library/edit/<block>      review flags and summaries; edit shared lists
// Approving commits the change to GitHub; a GitHub Action then rebuilds and
// deploys the public site. Nothing reaches the live site without approval.

import yaml from "js-yaml";
import { buildGroup, renderGroupBody, todayIn, esc, isoDate } from "../../lib/render.js";
import { identify } from "./auth.js";
import { loadShared, loadGroup, groupFile, sharedFrom, listPending, getPending, putPending, deletePending, SHARED_EVENTS, LIBRARY } from "./data.js";
import { applyToObject, applyToYaml, getAt } from "./ops.js";
import { updateFile } from "./github.js";
import { GROUP_BLOCKS, LIBRARY_BLOCKS, FormError } from "./forms.js";
import { describeChange, changeListHtml } from "./describe.js";
import siteCss from "../../tools/static/site.css";
import siteJs from "../../tools/static/site.js";
import dashCss from "./dashboard.css";
import dashJs from "./dashboard.client.js";

const ASSET_BASE = "https://tergargroups.org/assets"; // artwork served by the public site

const SECURITY = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex",
  "content-security-policy": "default-src 'self'; img-src 'self' https://tergargroups.org data:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'; frame-ancestors 'none'",
  "referrer-policy": "same-origin",
};
const html = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...SECURITY } });
const redirect = (to) => new Response(null, { status: 303, headers: { location: to, ...SECURITY } });
const asset = (body, type) => new Response(body, { headers: { "content-type": type, "cache-control": "max-age=300" } });

// Compare data ignoring date representation (js-yaml reads dates as Date).
const sameData = (a, b) => {
  const norm = (x) => JSON.stringify(x, (k, v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(v) ? v.slice(0, 10) : v));
  return norm(a) === norm(b);
};
const roleName = (role) => (role === "coordinator" ? "the coordinator" : "the group editor");
const when = (c, s) => (c ? s : "");
const fmtTime = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET";

function shell(user, active, title, body, pendingCount) {
  const nav = (href, key, label) => `<a href="${href}"${active === key ? ' class="on"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Group Pages dashboard</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/dashboard.css">
</head><body class="dash">
<header class="dash-top">
  <div class="dash-row">
    <div><strong>Group Pages dashboard</strong><div class="dash-sub">tergargroups.org · signed in as ${esc(user.email)}${user.role === "coordinator" ? " (coordinator)" : ""}</div></div>
    <nav class="dash-nav">
      ${nav("/", "home", "Groups")}
      ${nav("/approvals", "approvals", `Approvals${pendingCount ? ` <span class="count">${pendingCount}</span>` : ""}`)}
      ${user.role === "coordinator" ? nav("/library", "library", "Shared Library") : ""}
    </nav>
  </div>
</header>
<div class="dash-main">${body}</div>
<script src="/assets/dashboard.js"></script>
</body></html>`;
}

function denied(email) {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>No access</title><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/dashboard.css"></head>
<body class="dash"><div class="dash-main"><div class="dash-card"><h1>No access</h1>
<p>${email ? `You are signed in as <strong>${esc(email)}</strong>, but this address isn't set up for this page.` : "Please sign in."}</p>
<p>Ask the site coordinator if you need access.</p><p><a href="/">Back to the dashboard</a></p></div></div></body></html>`, 403);
}

const canSee = (user, scope) => (scope === "shared" ? user.role === "coordinator" : user.groups.includes(scope));
const visiblePending = async (env, user) => Object.values(await listPending(env)).filter((c) => canSee(user, c.scope))
  .sort((a, b) => a.created.localeCompare(b.created));
const changeUrl = (id) => `/approvals/${encodeURIComponent(id)}`;

// A Next meeting whose date has passed (hidden on the live page) and no
// replacement waiting. Groups that don't use the block never see this.
function staleMeeting(group, pending, path) {
  const nm = group && group.next_meeting;
  const d = nm ? isoDate(nm.date) : null;
  if (!d || d >= todayIn(group.time_zone)) return null;
  if (pending.some((c) => c.scope === path && c.block === "next_meeting")) return null;
  return d;
}

const fmtDayShort = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// ------------------------------------------------------------------ views

async function home(user, env) {
  const pending = await visiblePending(env, user);
  const count = (p) => pending.filter((c) => c.scope === p).length;
  const data = await Promise.all(user.groups.map((p) => loadGroup(env, p).catch(() => null)));
  const groups = user.groups.map((p, i) => `<li><a href="/g/${esc(p)}"><strong>${esc(p)}</strong></a>
    ${when(count(p), ` · <a href="/approvals">${count(p)} change${count(p) === 1 ? "" : "s"} waiting</a>`)}
    ${when(staleMeeting(data[i], pending, p), ` · <a class="remind" href="/g/${esc(p)}/edit/next_meeting">Next meeting needs updating</a>`)}
    · <a href="https://tergargroups.org/${esc(p)}/" target="_blank" rel="noopener">live page</a></li>`).join("");
  return shell(user, "home", "Groups", `
  <div class="dash-card">
    <h1>Your group${user.groups.length === 1 ? "" : "s"}</h1>
    <ul class="dash-list">${groups || "<li>No groups assigned yet.</li>"}</ul>
    <p class="small">Open a group to see its page with an Edit button on each block. Saved edits wait in Approvals, with a preview, until they are approved. Only approved changes reach the live page, a minute or two after approval.</p>
  </div>`, pending.length);
}

async function groupView(user, env, path) {
  const [shared, group, pending] = await Promise.all([loadShared(env), loadGroup(env, path), visiblePending(env, user)]);
  const mine = pending.filter((c) => c.scope === path);
  const today = todayIn(group.time_zone);
  const page = buildGroup({ group, ...shared }, { today, mode: "preview" });
  const body = renderGroupBody(page, { assets: ASSET_BASE, editable: true, built: today, pending: mine.map((c) => c.block) });
  const issues = page.issues.length ? `<details class="dash-issues"><summary>${page.issues.length} item${page.issues.length === 1 ? "" : "s"} to review on this page</summary><ul>${page.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></details>` : "";
  return shell(user, "home", group.name, `
  ${when(staleMeeting(group, pending, path), `<div class="dash-card remind-note"><strong>Your next meeting date (${esc(fmtDayShort(staleMeeting(group, pending, path)))}) has passed</strong>, so the Next meeting block is hidden on the live page.
    <a class="btn-primary" href="/g/${esc(path)}/edit/next_meeting">Add the next meeting</a>
    <div class="small">If your group doesn't post a topic each week, open the form and tick "No next meeting block" to stop this reminder.</div></div>`)}
  <div class="dash-card dash-note">
    <strong>${esc(group.name)}</strong>: this is the page as it is now (draft summaries and flagged events included and marked). Click <strong>Edit</strong> on any block.
    ${when(mine.length, `<div class="pend-note">${mine.length} change${mine.length === 1 ? "" : "s"} waiting for approval: ${mine.map((c) => `<a href="${changeUrl(c.id)}">${esc(c.label)}</a>`).join(", ")}</div>`)}
    <div class="small"><a href="https://tergargroups.org/${esc(path)}/" target="_blank" rel="noopener">Open the live page</a> ·
      Missing a block? Empty blocks show here with an Edit button; they're hidden on the live page.</div>
    ${issues}
  </div>
  <div data-zone="${esc(group.time_zone)}" data-path="${esc(path)}" id="page-wrap">${body}</div>
  <script src="/assets/site.js"></script>`, pending.length);
}

function formPage(user, title, intro, formHtml, action, cancel, pendingCount, existing) {
  return shell(user, "home", title, `
  <div class="dash-card">
    <h1>${esc(title)}</h1>
    ${intro}
    ${when(existing, `<p class="pend-note">A change to this block is already waiting for approval; this form shows it. Saving replaces it.</p>`)}
    <form method="post" action="${esc(action)}" class="edit-form">
      ${formHtml}
      <div class="form-actions"><button type="submit" class="btn-primary">Save as a pending change</button> <a href="${esc(cancel)}">Cancel</a></div>
      <p class="small">Saving doesn't change the live page. The change waits in Approvals with a preview.</p>
    </form>
  </div>`, pendingCount);
}

function errorPage(user, errs, pendingCount) {
  return html(shell(user, "", "Please check", `<div class="dash-card"><h1>Please check these</h1>
    <ul class="errors">${errs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
    <p><button type="button" class="btn-primary" data-back>Go back to the form</button></p></div>`, pendingCount), 400);
}

async function editGroupBlock(user, env, request, path, key) {
  const block = GROUP_BLOCKS[key];
  if (!block) return html(shell(user, "", "Not found", `<div class="dash-card"><p>Unknown block.</p></div>`), 404);
  const [shared, group0, pending] = await Promise.all([loadShared(env), loadGroup(env, path), visiblePending(env, user)]);
  const id = `${path}:${key}`;
  const existing = pending.find((c) => c.id === id);
  const g = existing ? applyToObject(group0, existing.ops) : group0;
  const ctx = { g, shared, today: todayIn(group0.time_zone) };
  if (request.method === "POST") {
    let ops;
    try { ops = block.parse(await request.formData(), ctx); }  // whole-block state; replaces any earlier pending change
    catch (e) { if (e instanceof FormError) return errorPage(user, e.list, pending.length); throw e; }
    if (sameData(applyToObject(group0, ops), group0)) {
      if (existing) await deletePending(env, id); // edited back to the current page: nothing pending
      return html(shell(user, "", "No change", `<div class="dash-card"><h1>Nothing to change</h1><p>The form matches the current page, so no change was saved.</p><p><a href="/g/${esc(path)}">Back to ${esc(group0.name)}</a></p></div>`, pending.length));
    }
    await putPending(env, { id, scope: path, block: key, label: `${group0.name}: ${block.label}`, file: groupFile(path),
      ops, author: user.email, authorRole: user.role, created: new Date().toISOString() });
    return redirect(changeUrl(id) + "?saved=1");
  }
  return html(formPage(user, `${group0.name}: ${block.label}`, "", block.render(ctx), `/g/${path}/edit/${key}`, `/g/${path}`, pending.length, existing));
}

async function editLibraryBlock(user, env, request, key) {
  if (user.role !== "coordinator") return denied(user.email);
  const block = LIBRARY_BLOCKS[key];
  if (!block) return html(shell(user, "", "Not found", `<div class="dash-card"><p>Unknown section.</p></div>`), 404);
  const [shared0, pending] = await Promise.all([loadShared(env), visiblePending(env, user)]);
  const id = `shared:${key}`;
  const existing = pending.find((c) => c.id === id);
  const shared = existing ? applyShared(shared0, existing, env) : shared0;
  const ctx = { shared, today: todayIn("America/New_York") };
  if (request.method === "POST") {
    let ops;
    try { ops = block.parse(await request.formData(), { ...ctx, shared: shared0 }); }
    catch (e) { if (e instanceof FormError) return errorPage(user, e.list, pending.length); throw e; }
    await putPending(env, { id, scope: "shared", block: key, label: `Shared Library: ${block.label}`, file: block.file,
      ops, author: user.email, authorRole: user.role, created: new Date().toISOString() });
    return redirect(changeUrl(id) + "?saved=1");
  }
  return html(formPage(user, `Shared Library: ${block.label}`, "", block.render(ctx), `/library/edit/${key}`, "/library", pending.length, existing));
}

function applyShared(shared, change, env) {
  if (change.file === SHARED_EVENTS) return sharedFrom(applyToObject(shared.sharedDoc, change.ops), shared.seriesDoc, shared.library, env);
  if (change.file === LIBRARY) return sharedFrom(shared.sharedDoc, shared.seriesDoc, applyToObject(shared.library, change.ops), env);
  return shared;
}

// --------------------------------------------------------------- approvals

async function approvalsView(user, env, url) {
  const pending = await visiblePending(env, user);
  const ok = url.searchParams.get("ok"), commit = url.searchParams.get("c"), gone = url.searchParams.get("rejected");
  const items = pending.map((c) => `<li class="pend-item">
      <a href="${changeUrl(c.id)}"><strong>${esc(c.label)}</strong></a>
      <div class="small">Proposed by ${esc(c.author)} · ${esc(fmtTime(c.created))}</div></li>`).join("");
  return shell(user, "approvals", "Approvals", `
  ${when(ok, `<div class="dash-card ok-note">Published: <strong>${esc(ok)}</strong>. The live page updates within a couple of minutes.
      ${when(commit && /^https:\/\/github\.com\//.test(commit), ` <a href="${esc(commit)}" target="_blank" rel="noopener">See the change record (GitHub)</a>.`)}</div>`)}
  ${when(gone, `<div class="dash-card dash-note">Discarded: <strong>${esc(gone)}</strong>.</div>`)}
  <div class="dash-card">
    <h1>Approvals</h1>
    ${items ? `<ul class="dash-list plain">${items}</ul>` : "<p>Nothing waiting. Every saved change has been published or discarded.</p>"}
    <p class="small">Changes listed here are saved but not live yet. Open one to check it, then publish or discard it.</p>
  </div>`, pending.length);
}

function describeOps(before, ops) {
  const label = (path) => path.map((p) => (typeof p === "object" ? p.id : p)).join(" › ").replace(/_/g, " ");
  const dump = (x) => (x === undefined || x === null || x === "" ? "(empty)" : typeof x === "string" ? x : yaml.dump(x, { lineWidth: 100 }).trim());
  // Show values as they read, not as they are typed: dates as YYYY-MM-DD,
  // and no "featured: false" (the default), so only real changes differ.
  const norm = (x) => {
    if (x instanceof Date) return isoDate(x);
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      const o = {};
      for (const [k, v] of Object.entries(x)) if (!(k === "featured" && v === false)) o[k] = norm(v);
      return o;
    }
    return x;
  };
  return ops.map((op) => {
    let was = getAt(before, op.path), now = op.value;
    if (op.listReplace) {
      const pick = op.listReplace === "community" ? (s) => s && s.cadence_text : (s) => s && !s.cadence_text;
      was = (was || []).filter(pick);
      now = op.items;
    }
    was = norm(was); now = norm(now);
    const same = JSON.stringify(was ?? null) === JSON.stringify(now ?? null);
    return `<div class="diff${same ? " same" : ""}"><div class="diff-h">${esc(label(op.path))}${same ? " (unchanged)" : ""}</div>
      ${same ? "" : `<div class="diff-cols"><div><div class="small">Now</div><pre>${esc(dump(was))}</pre></div><div><div class="small">After approval</div><pre>${esc(dump(now))}</pre></div></div>`}</div>`;
  }).join("");
}

async function changeView(user, env, url, id) {
  const [change, pending] = await Promise.all([getPending(env, id), visiblePending(env, user)]);
  if (!change || !canSee(user, change.scope)) return html(shell(user, "approvals", "Not found", `<div class="dash-card"><p>This change is no longer pending (already approved or rejected).</p><p><a href="/approvals">Back to Approvals</a></p></div>`, pending.length), 404);
  const shared0 = await loadShared(env);
  let groupPath, before, groupData, shared = shared0;
  if (change.scope === "shared") {
    shared = applyShared(shared0, change, env);
    before = change.file === LIBRARY ? shared0.library : shared0.sharedDoc;
    const choice = url.searchParams.get("g");
    groupPath = user.groups.includes(choice) ? choice : user.groups[0];
    groupData = await loadGroup(env, groupPath);
  } else {
    groupPath = change.scope;
    before = await loadGroup(env, groupPath);
    groupData = applyToObject(before, change.ops);
  }
  const today = todayIn(groupData.time_zone);
  const page = buildGroup({ group: groupData, ...shared }, { today, mode: "publish" });
  const body = renderGroupBody(page, { assets: ASSET_BASE, editable: false, built: today });
  const held = page.issues.length ? `<details class="dash-issues"><summary>${page.issues.length} note${page.issues.length === 1 ? "" : "s"} about what the live page holds back</summary><ul>${page.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></details>` : "";
  const groupSwitch = change.scope === "shared" && user.groups.length > 1
    ? `<p class="small">Preview with: ${user.groups.map((p) => p === groupPath ? `<strong>${esc(p)}</strong>` : `<a href="${changeUrl(id)}?g=${encodeURIComponent(p)}">${esc(p)}</a>`).join(" · ")}</p>` : "";
  const editLink = change.scope === "shared" ? `/library/edit/${change.block}` : `/g/${change.scope}/edit/${change.block}`;
  const after = change.scope === "shared" ? (change.file === LIBRARY ? shared.library : shared.sharedDoc) : groupData;
  const lines = describeChange(change, { before, after, sharedBefore: shared0, sharedAfter: shared, groupAfter: groupData });
  const saved = url.searchParams.get("saved");
  const who = change.author === user.email ? "you" : change.author;
  return html(shell(user, "approvals", change.label, `
  <div class="dash-card review-card">
    ${saved
      ? `<p class="review-step">Saved. <strong>Not on the live page yet.</strong></p><h1>Check your change, then publish it</h1>`
      : `<p class="review-step">Waiting for approval</p><h1>${esc(change.label)}</h1>`}
    <p class="small">${saved ? esc(change.label) + " · " : ""}Saved by ${esc(who)} · ${esc(fmtTime(change.created))}</p>
    <h2>What this change does</h2>
    ${changeListHtml(lines)}
    <div class="form-actions review-actions">
      <form method="post" action="${changeUrl(id)}/approve" class="inline"><button type="submit" class="btn-primary btn-big">Publish to the live page</button></form>
      <a class="btn-plain" href="${esc(editLink)}">Make more edits</a>
      <form method="post" action="${changeUrl(id)}/reject" class="inline"><button type="submit" class="btn-reject">Discard this change</button></form>
    </div>
    <p class="small">Publishing updates the live page within a couple of minutes. Discarding throws this change away; the live page stays as it is.</p>
    ${when(user.role === "coordinator", `<details class="tech"><summary>Technical details</summary>${describeOps(before, change.ops)}</details>`)}
  </div>
  <div class="dash-card dash-note"><strong>Preview: how ${esc(groupData.name)} will look after publishing</strong>
    ${groupSwitch}${held}</div>
  <div data-zone="${esc(groupData.time_zone)}" id="page-wrap">${body}</div>
  <script src="/assets/site.js"></script>`, pending.length));
}

async function decide(user, env, id, action) {
  const change = await getPending(env, id);
  if (!change || !canSee(user, change.scope)) return redirect("/approvals");
  if (action === "reject") {
    await deletePending(env, id);
    return redirect(`/approvals?rejected=${encodeURIComponent(change.label)}`);
  }
  const message = `${change.label}\n\nProposed by ${roleName(change.authorRole)} and approved by ${roleName(user.role)} in the dashboard (admin.tergargroups.org).`;
  const result = await updateFile(env, change.file, (text) => {
    const next = applyToYaml(text, change.ops);
    yaml.load(next); // must still be valid YAML
    return next;
  }, message);
  await deletePending(env, id);
  return redirect(`/approvals?ok=${encodeURIComponent(change.label)}${result.commitUrl ? `&c=${encodeURIComponent(result.commitUrl)}` : ""}`);
}

// ---------------------------------------------------------------- library

async function libraryView(user, env) {
  if (user.role !== "coordinator") return denied(user.email);
  const [shared, pending] = await Promise.all([loadShared(env), visiblePending(env, user)]);
  const groupData = await Promise.all(user.groups.map((p) => loadGroup(env, p).catch(() => null)));
  const usedBy = {};
  groupData.filter(Boolean).forEach((g) => (g.events || []).forEach((e) => {
    if (e.shared) (usedBy[e.shared] = usedBy[e.shared] || []).push(g.name + (e.featured ? " (featured)" : ""));
  }));
  const yes = (b) => (b ? "yes" : "no");
  const rows = shared.sharedEventsList.map((e) => `<tr>
    <td><a href="${esc(e.source_url || "#")}" target="_blank" rel="noopener">${esc(e.title)}</a></td>
    <td>${esc(e.start || e.date_text || "no dates")}${e.end && e.end !== e.start ? " to " + esc(e.end) : ""}</td>
    <td>${esc(e.restricted)}</td>
    <td>${e.needs_review ? `<span class="badge warn">${esc(e.needs_review)}</span><div class="small">cleared: ${yes(e.review_cleared)}</div>` : "no"}</td>
    <td>${e.summary ? yes(e.summary_approved) : "none"}</td>
    <td>${esc((usedBy[e.id] || []).join(", ") || "-")}</td></tr>`).join("");
  const series = shared.sharedSeriesList.map((s) => `<li><strong>${esc(s.title)}</strong> · ${esc(s.weekday)} ${esc(s.start_time)} · ${esc(s.format)}${s.requires ? " · requires " + esc(s.requires) : ""}</li>`).join("");
  const lib = shared.library;
  const pend = (k) => when(pending.some((c) => c.id === `shared:${k}`), ` <a class="pend" href="${changeUrl(`shared:${k}`)}">change pending</a>`);
  return shell(user, "library", "Shared Library", `
  <div class="dash-card">
    <h1>Shared Library</h1>
    <p class="small">Tergar records that groups choose from. Groups can't change these. Events come from the collector (last export ${esc(shared.generated || "?")}).</p>
    <h2>Shared events</h2>
    <p><a class="btn-primary" href="/library/edit/review">Review flags and approve summaries</a>${pend("review")}</p>
    <div class="dash-table"><table><thead><tr><th>Event</th><th>Dates</th><th>Restricted</th><th>Needs review</th><th>Summary approved</th><th>Selected by</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2>Quotes, From Tergar, resource links</h2>
    <p><a class="btn-primary" href="/library/edit/lists">Edit these lists</a>${pend("lists")}</p>
    <h3>Quotes</h3><ul class="dash-list">${(lib.quotes || []).map((q) => `<li>“${esc(q.text)}” — ${esc(q.by)}</li>`).join("")}</ul>
    <h3>From Tergar</h3><ul class="dash-list">${(lib.from_tergar || []).map((t) => `<li><a href="${esc(t.url)}">${esc(t.title)}</a></li>`).join("")}</ul>
    <h3>Resource links</h3><ul class="dash-list">${(lib.resources || []).map((r) => `<li><a href="${esc(r.url)}">${esc(r.title)}</a></li>`).join("")}</ul>
    <h2>Meeting series</h2>
    <p class="small">Edited in the data file for now (data/shared/series.yaml); ask Claude to add or change one.</p>
    <ul class="dash-list">${series}</ul>
  </div>`, pending.length);
}

// ------------------------------------------------------------------ router

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === "/assets/site.css") return asset(siteCss, "text/css; charset=utf-8");
    if (p === "/assets/dashboard.css") return asset(dashCss, "text/css; charset=utf-8");
    if (p === "/assets/site.js") return asset(siteJs, "text/javascript; charset=utf-8");
    if (p === "/assets/dashboard.js") return asset(dashJs, "text/javascript; charset=utf-8");

    const user = await identify(request, env);
    if (!user || user.role === "none") return denied(user && user.email);

    // Changes only by POST from this site's own pages.
    if (request.method === "POST") {
      const origin = request.headers.get("Origin");
      // (local wrangler dev rewrites the URL to the production host, so the
      // check is skipped there; DEV_EMAIL exists only in .dev.vars)
      if (origin !== url.origin && !env.DEV_EMAIL) return new Response("Forbidden", { status: 403 });
    } else if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      if (p === "/") return html(await home(user, env));
      let m;
      if ((m = p.match(/^\/g\/([a-z]{2}\/[a-z0-9-]+)\/edit\/([a-z_]+)\/?$/))) {
        if (!user.groups.includes(m[1])) return denied(user.email);
        return await editGroupBlock(user, env, request, m[1], m[2]);
      }
      if ((m = p.match(/^\/g\/([a-z]{2}\/[a-z0-9-]+)\/?$/))) {
        if (!user.groups.includes(m[1])) return denied(user.email);
        return html(await groupView(user, env, m[1]));
      }
      if (p === "/approvals") return html(await approvalsView(user, env, url));
      if ((m = p.match(/^\/approvals\/([^/]+)\/(approve|reject)$/)) && request.method === "POST") return await decide(user, env, decodeURIComponent(m[1]), m[2]);
      if ((m = p.match(/^\/approvals\/([^/]+)$/))) return await changeView(user, env, url, decodeURIComponent(m[1]));
      if (p === "/library") return html(await libraryView(user, env));
      if ((m = p.match(/^\/library\/edit\/([a-z_]+)$/))) return await editLibraryBlock(user, env, request, m[1]);
      return html(shell(user, "", "Not found", `<div class="dash-card"><p>Page not found.</p></div>`), 404);
    } catch (err) {
      return html(shell(user, "", "Error", `<div class="dash-card"><h1>Something went wrong</h1><p>${esc(err.message)}</p><p><a href="/">Back to the dashboard</a></p></div>`), 500);
    }
  },
};
