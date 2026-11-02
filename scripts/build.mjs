// Build the Living Group Pages from the data files.
//
//   node scripts/build.mjs --mode preview   -> site-preview/  (everything, with review badges; never deploy)
//   node scripts/build.mjs --mode publish   -> site/          (reviewed content only)
//   options: --today YYYY-MM-DD (testing), --out DIR
//
// Reads data/shared-events.yaml, data/shared/*.yaml, data/groups/*.yaml and,
// if present, data/private/contacts.yaml (never committed). On GitHub Actions
// the contacts come from the CONTACTS_YAML secret instead.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { buildGroup, renderGroupPage, renderIndex, todayIn } from "../lib/render.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const ASSETS = path.join(ROOT, "tools", "static");

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return acc;
}, []));
const mode = args.mode === "publish" ? "publish" : "preview";
const outDir = path.resolve(ROOT, args.out || (mode === "publish" ? "site" : "site-preview"));

const load = (p) => yaml.load(fs.readFileSync(p, "utf8")) || {};
const shared = load(path.join(DATA, "shared-events.yaml"));
const sharedEvents = Object.fromEntries((shared.events || []).map((e) => [e.id, e]));
const sharedSeries = Object.fromEntries((load(path.join(DATA, "shared", "series.yaml")).series || []).map((s) => [s.id, s]));
const library = load(path.join(DATA, "shared", "library.yaml"));

let contacts = {};
const privatePath = path.join(DATA, "private", "contacts.yaml");
if (process.env.CONTACTS_YAML) contacts = (yaml.load(process.env.CONTACTS_YAML) || {}).contacts || {};
else if (fs.existsSync(privatePath)) contacts = load(privatePath).contacts || {};

const built = todayIn("America/New_York");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
for (const f of fs.readdirSync(ASSETS)) fs.copyFileSync(path.join(ASSETS, f), path.join(outDir, "assets", f));

const report = [`Build report (${mode}) for ${args.today || "today"}`, ""];
const groups = [];
for (const f of fs.readdirSync(path.join(DATA, "groups")).filter((x) => x.endsWith(".yaml")).sort()) {
  const group = load(path.join(DATA, "groups", f));
  const today = args.today || todayIn(group.time_zone);
  const page = buildGroup({ group, sharedEvents, sharedSeries, library, contacts }, { today, mode });
  report.push(`${group.name} (${group.path})`);
  report.push(...(page.issues.length ? page.issues.map((i) => "  - " + i) : ["  no issues"]), "");
  const depth = "../".repeat(group.path.split("/").length);
  const target = path.join(outDir, ...group.path.split("/"), "index.html");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderGroupPage(page, { assets: depth + "assets", built, editable: false }));
  groups.push({ name: group.name, full_name: group.full_name, path: group.path, location: group.location });
}
fs.writeFileSync(path.join(outDir, "index.html"), renderIndex(groups, { assets: "assets", preview: mode === "preview" }));

if (!args.out) fs.writeFileSync(path.join(DATA, `build-report-${mode}.txt`), report.join("\n") + "\n");
console.log(report.join("\n"));
console.log(`Wrote ${outDir}`);
