// Read the site data. Source of truth: the GitHub repository (main branch).
// The repository is public, so reading needs no token. Contact addresses are
// private and come from the CONTACTS secret, never from the repository.

import yaml from "js-yaml";

const RAW = (env, file) => `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${env.GITHUB_BRANCH || "main"}/${file}`;

async function getYaml(env, file) {
  const res = await fetch(RAW(env, file), { cf: { cacheTtl: 30, cacheEverything: true } });
  if (!res.ok) throw new Error(`Could not read ${file} (HTTP ${res.status})`);
  return yaml.load(await res.text()) || {};
}

export const groupFile = (path) => `data/groups/${path.replace(/\//g, "-")}.yaml`;

export async function loadShared(env) {
  const [shared, series, library] = await Promise.all([
    getYaml(env, "data/shared-events.yaml"),
    getYaml(env, "data/shared/series.yaml"),
    getYaml(env, "data/shared/library.yaml"),
  ]);
  return {
    sharedEventsList: shared.events || [],
    sharedEvents: Object.fromEntries((shared.events || []).map((e) => [e.id, e])),
    sharedSeriesList: series.series || [],
    sharedSeries: Object.fromEntries((series.series || []).map((s) => [s.id, s])),
    library,
    generated: shared.generated,
    contacts: (() => { try { return (yaml.load(env.CONTACTS || "") || {}).contacts || {}; } catch { return {}; } })(),
  };
}

export async function loadGroup(env, path) {
  return getYaml(env, groupFile(path));
}
