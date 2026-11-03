// Read the site data. Source of truth: the GitHub repository (main branch).
// Contact addresses are private and come from the CONTACTS secret, never
// from the repository. Pending changes live in Workers KV (binding PENDING),
// never in the public repository.

import yaml from "js-yaml";
import { readText } from "./github.js";

export const SHARED_EVENTS = "data/shared-events.yaml";
export const SHARED_SERIES = "data/shared/series.yaml";
export const LIBRARY = "data/shared/library.yaml";
export const groupFile = (path) => `data/groups/${path.replace(/\//g, "-")}.yaml`;

const getYaml = async (env, file) => yaml.load(await readText(env, file)) || {};

export function sharedFrom(sharedDoc, seriesDoc, library, env) {
  return {
    sharedDoc,
    sharedEventsList: sharedDoc.events || [],
    sharedEvents: Object.fromEntries((sharedDoc.events || []).map((e) => [e.id, e])),
    sharedSeriesList: seriesDoc.series || [],
    sharedSeries: Object.fromEntries((seriesDoc.series || []).map((s) => [s.id, s])),
    seriesDoc,
    library,
    generated: sharedDoc.generated,
    contacts: (() => { try { return (yaml.load(env.CONTACTS || "") || {}).contacts || {}; } catch { return {}; } })(),
  };
}

export async function loadShared(env) {
  const [shared, series, library] = await Promise.all([
    getYaml(env, SHARED_EVENTS), getYaml(env, SHARED_SERIES), getYaml(env, LIBRARY),
  ]);
  return sharedFrom(shared, series, library, env);
}

export async function loadGroup(env, path) {
  return getYaml(env, groupFile(path));
}

// ------------------------------------------------------ pending changes
// One KV record holds all pending changes (small during the pilot, and a
// single key avoids KV's delayed listings). One pending change per block:
// saving a block again replaces its earlier pending change.

const KEY = "pending-v1";

export async function listPending(env) {
  return (await env.PENDING.get(KEY, "json")) || {};
}
export async function getPending(env, id) {
  return (await listPending(env))[id] || null;
}
export async function putPending(env, change) {
  const all = await listPending(env);
  all[change.id] = change;
  await env.PENDING.put(KEY, JSON.stringify(all));
}
export async function deletePending(env, id) {
  const all = await listPending(env);
  delete all[id];
  await env.PENDING.put(KEY, JSON.stringify(all));
}
