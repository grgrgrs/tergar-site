// Living Group Pages dashboard (admin.tergargroups.org).
// Step 1 (this version): sign-in and read-only views.
//   /                 home: your groups
//   /g/<group path>   Group Dashboard: the page in edit mode
//   /approvals        Approvals: pending changes (none yet)
//   /library          Shared Library (coordinator only)
// Editing, pending changes and approval come in the next step.

import { buildGroup, renderGroupBody, todayIn, esc } from "../../lib/render.js";
import { identify } from "./auth.js";
import { loadShared, loadGroup } from "./data.js";
import siteCss from "../../tools/static/site.css";
import siteJs from "../../tools/static/site.js";
import dashCss from "./dashboard.css";
import dashJs from "./dashboard.client.js";

const ASSET_BASE = "https://tergargroups.org/assets"; // artwork served by the public site

const html = (body, status = 200) => new Response(body, {
  status,
  headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
    "content-security-policy": "default-src 'self'; img-src 'self' https://tergargroups.org data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
  },
});
const asset = (body, type) => new Response(body, { headers: { "content-type": type, "cache-control": "max-age=300" } });

function shell(user, active, title, body, extraHead = "") {
  const nav = (href, key, label) => `<a href="${href}"${active === key ? ' class="on"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Group Pages dashboard</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/dashboard.css">
${extraHead}
</head><body class="dash"${extraHead ? "" : ""}>
<header class="dash-top">
  <div class="dash-row">
    <div><strong>Group Pages dashboard</strong><div class="dash-sub">tergargroups.org · signed in as ${esc(user.email)}${user.role === "coordinator" ? " (coordinator)" : ""}</div></div>
    <nav class="dash-nav">
      ${nav("/", "home", "Groups")}
      ${nav("/approvals", "approvals", "Approvals")}
      ${user.role === "coordinator" ? nav("/library", "library", "Shared Library") : ""}
    </nav>
  </div>
</header>
<div class="dash-main">${body}</div>
</body></html>`;
}

function denied(email) {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>No access</title><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/dashboard.css"></head>
<body class="dash"><div class="dash-main"><div class="dash-card"><h1>No access yet</h1>
<p>${email ? `You are signed in as <strong>${esc(email)}</strong>, but this address isn't set up as a group editor.` : "Please sign in."}</p>
<p>Ask the site coordinator to add you.</p></div></div></body></html>`, 403);
}

function home(user) {
  const groups = user.groups.map((p) => `<li><a href="/g/${esc(p)}">${esc(p)}</a> · <a href="https://tergargroups.org/${esc(p)}/">live page</a></li>`).join("");
  return shell(user, "home", "Groups", `
  <div class="dash-card">
    <h1>Your group${user.groups.length === 1 ? "" : "s"}</h1>
    <ul class="dash-list">${groups || "<li>No groups assigned yet.</li>"}</ul>
    <p class="small">The dashboard is the page itself: each block has an Edit button. Changes wait in Approvals until approved, and only approved changes reach the live page.</p>
  </div>`);
}

async function groupView(user, env, path) {
  if (!user.groups.includes(path)) return denied(user.email);
  const [shared, group] = await Promise.all([loadShared(env), loadGroup(env, path)]);
  const today = todayIn(group.time_zone);
  const page = buildGroup({ group, ...shared }, { today, mode: "preview" });
  const body = renderGroupBody(page, { assets: ASSET_BASE, editable: true, built: today });
  const issues = page.issues.length ? `<details class="dash-issues"><summary>${page.issues.length} item${page.issues.length === 1 ? "" : "s"} to review on this page</summary><ul>${page.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></details>` : "";
  return shell(user, "home", group.name, `
  <div class="dash-card dash-note">
    <strong>${esc(group.name)}</strong>: Group Dashboard. This is the page with an Edit button on each block.
    Editing arrives in the next step; for now this view is read-only.
    <a href="https://tergargroups.org/${esc(path)}/">Open the live page</a>.
    ${issues}
  </div>
  <div data-zone="${esc(group.time_zone)}" id="page-wrap">${body}</div>
  <script src="/assets/site.js"></script><script src="/assets/dashboard.js"></script>`);
}

function approvalsView(user) {
  return shell(user, "approvals", "Approvals", `
  <div class="dash-card">
    <h1>Approvals</h1>
    <p>No pending changes.</p>
    <p class="small">Each change made on a Group Dashboard will appear here with a preview of what it will publish, to approve or reject. Approving commits the change to the site's history and updates the live page.</p>
  </div>`);
}

async function libraryView(user, env) {
  if (user.role !== "coordinator") return denied(user.email);
  const shared = await loadShared(env);
  const groupData = await Promise.all(user.groups.map((p) => loadGroup(env, p).catch(() => null)));
  const usedBy = {};
  groupData.filter(Boolean).forEach((g) => (g.events || []).forEach((e) => {
    if (e.shared) (usedBy[e.shared] = usedBy[e.shared] || []).push(g.name + (e.featured ? " (featured)" : ""));
  }));
  const yes = (b) => (b ? "yes" : "no");
  const rows = shared.sharedEventsList.map((e) => `<tr>
    <td><a href="${esc(e.source_url || "#")}">${esc(e.title)}</a></td>
    <td>${esc(e.start || e.date_text || "no dates")}${e.end && e.end !== e.start ? " to " + esc(e.end) : ""}</td>
    <td>${esc(e.restricted)}</td>
    <td>${e.needs_review ? `<span class="badge warn">${esc(e.needs_review)}</span>` : "no"}${e.needs_review ? `<div class="small">cleared: ${yes(e.review_cleared)}</div>` : ""}</td>
    <td>${e.summary ? yes(e.summary_approved) : "none"}</td>
    <td>${esc((usedBy[e.id] || []).join(", ") || "-")}</td></tr>`).join("");
  const series = shared.sharedSeriesList.map((s) => `<li><strong>${esc(s.title)}</strong> · ${esc(s.weekday)} ${esc(s.start_time)} · ${esc(s.format)}${s.requires ? " · requires " + esc(s.requires) : ""}</li>`).join("");
  const lib = shared.library;
  return shell(user, "library", "Shared Library", `
  <div class="dash-card">
    <h1>Shared Library</h1>
    <p class="small">Tergar records that groups choose from. Groups can't change these. Events come from the collector (last export ${esc(shared.generated || "?")}).</p>
    <h2>Shared events</h2>
    <div class="dash-table"><table><thead><tr><th>Event</th><th>Dates</th><th>Restricted</th><th>Needs review</th><th>Summary approved</th><th>Selected by</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2>Meeting series</h2><ul class="dash-list">${series}</ul>
    <h2>Quotes</h2><ul class="dash-list">${(lib.quotes || []).map((q) => `<li>“${esc(q.text)}” — ${esc(q.by)}</li>`).join("")}</ul>
    <h2>From Tergar</h2><ul class="dash-list">${(lib.from_tergar || []).map((t) => `<li><a href="${esc(t.url)}">${esc(t.title)}</a></li>`).join("")}</ul>
    <h2>Resource links</h2><ul class="dash-list">${(lib.resources || []).map((r) => `<li><a href="${esc(r.url)}">${esc(r.title)}</a></li>`).join("")}</ul>
  </div>`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/assets/site.css") return asset(siteCss, "text/css; charset=utf-8");
    if (url.pathname === "/assets/dashboard.css") return asset(dashCss, "text/css; charset=utf-8");
    if (url.pathname === "/assets/site.js") return asset(siteJs, "text/javascript; charset=utf-8");
    if (url.pathname === "/assets/dashboard.js") return asset(dashJs, "text/javascript; charset=utf-8");

    const user = await identify(request, env);
    if (!user || user.role === "none") return denied(user && user.email);
    try {
      if (url.pathname === "/") return html(home(user));
      if (url.pathname.startsWith("/g/")) return html(await groupView(user, env, url.pathname.slice(3).replace(/\/$/, "")));
      if (url.pathname === "/approvals") return html(approvalsView(user));
      if (url.pathname === "/library") return html(await libraryView(user, env));
      return html(shell(user, "", "Not found", `<div class="dash-card"><p>Page not found.</p></div>`), 404);
    } catch (err) {
      return html(shell(user, "", "Error", `<div class="dash-card"><h1>Something went wrong</h1><p>${esc(err.message)}</p></div>`), 500);
    }
  },
};
