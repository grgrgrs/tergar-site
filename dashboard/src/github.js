// GitHub access. Reads come from the GitHub API when GITHUB_TOKEN is set
// (fresh, no CDN delay after an approval), otherwise from the public raw URL.
// Writes (approved changes) need GITHUB_TOKEN: a fine-grained token limited
// to this repository with Contents read/write.

const API = "https://api.github.com";

function headers(env, accept = "application/vnd.github+json") {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: accept,
    "User-Agent": "tergar-dashboard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
const branch = (env) => env.GITHUB_BRANCH || "main";

function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function readText(env, file) {
  if (env.GITHUB_TOKEN) {
    const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/contents/${file}?ref=${branch(env)}`, { headers: headers(env, "application/vnd.github.raw+json") });
    if (!res.ok) throw new Error(`Could not read ${file} (GitHub ${res.status})`);
    return res.text();
  }
  const res = await fetch(`https://raw.githubusercontent.com/${env.GITHUB_REPO}/${branch(env)}/${file}`, { cf: { cacheTtl: 30, cacheEverything: true } });
  if (!res.ok) throw new Error(`Could not read ${file} (HTTP ${res.status})`);
  return res.text();
}

async function readWithSha(env, file) {
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/contents/${file}?ref=${branch(env)}`, { headers: headers(env) });
  if (!res.ok) throw new Error(`Could not read ${file} for update (GitHub ${res.status})`);
  const j = await res.json();
  return { text: b64ToUtf8(j.content), sha: j.sha };
}

/**
 * Read the current file, transform it, and commit the result.
 * Retries once if someone else committed in between (GitHub 409).
 * Returns { changed, commitUrl }.
 */
export async function updateFile(env, file, transform, message) {
  if (!env.GITHUB_TOKEN) throw new Error("Publishing isn't set up yet: the dashboard has no GitHub token (GITHUB_TOKEN secret).");
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, sha } = await readWithSha(env, file);
    const next = transform(text);
    if (next === text) return { changed: false };
    const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/contents/${file}`, {
      method: "PUT",
      headers: { ...headers(env), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: utf8ToB64(next), sha, branch: branch(env) }),
    });
    if (res.status === 409 && attempt === 0) continue;
    if (!res.ok) throw new Error(`GitHub refused the commit (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return { changed: true, commitUrl: j.commit && j.commit.html_url };
  }
  throw new Error("The file kept changing while saving; please try again.");
}
