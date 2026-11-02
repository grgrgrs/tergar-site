// Identify the signed-in user.
// In production, Cloudflare Access signs every request that reaches the
// Worker with a JWT (Cf-Access-Jwt-Assertion). We verify it ourselves as a
// second lock: signature (team certs), audience (this app), expiry.
// Locally (wrangler dev), DEV_EMAIL in .dev.vars stands in for sign-in.

let certCache = { at: 0, keys: [] };

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function teamKeys(teamDomain) {
  if (Date.now() - certCache.at < 3600_000 && certCache.keys.length) return certCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("Could not load Access certificates");
  const { keys } = await res.json();
  certCache = { at: Date.now(), keys };
  return keys;
}

async function verifyAccessJwt(token, env) {
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return null;
  const header = decodeJson(h);
  const payload = decodeJson(p);
  const jwk = (await teamKeys(env.TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.POLICY_AUD)) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  if (payload.iss !== `https://${env.TEAM_DOMAIN}`) return null;
  return payload;
}

/** Returns { email, role, groups } or null. */
export async function identify(request, env) {
  let email = null;
  // DEV_EMAIL exists only in dashboard/.dev.vars (local wrangler dev); it is
  // never set as a production secret.
  if (env.DEV_EMAIL) {
    email = env.DEV_EMAIL;
  } else {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token || !env.TEAM_DOMAIN || !env.POLICY_AUD) return null;
    const payload = await verifyAccessJwt(token, env).catch(() => null);
    email = payload && payload.email;
  }
  if (!email) return null;
  // USERS (secret): {"someone@example.org": {"role": "coordinator"},
  //                  "editor@example.org": {"groups": ["us/venice-fl"]}}
  let users = {};
  try { users = JSON.parse(env.USERS || "{}"); } catch { users = {}; }
  const u = users[email.toLowerCase()];
  if (!u) return { email, role: "none", groups: [] };
  const all = JSON.parse(env.GROUPS || "[]");
  return u.role === "coordinator"
    ? { email, role: "coordinator", groups: all }
    : { email, role: "editor", groups: (u.groups || []).filter((g) => all.includes(g)) };
}
