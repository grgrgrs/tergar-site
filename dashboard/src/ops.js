// Changes are stored as small operations on one data file, so approving
// applies them to the CURRENT file (not a stale copy) and keeps the file's
// comments and layout.
//
// op = { path: [...], value }                       set (value undefined = delete)
// op = { path: [...], listReplace: "meetings"|"community", items: [...] }
//        replace only the matching items of a list (meeting series without
//        cadence_text, or community entries with cadence_text), so two
//        pending changes to different parts of local_series don't clobber.
// A path segment {id: "x"} selects the list item whose id is x.

import YAML from "yaml";

const matches = {
  meetings: (it) => it && typeof it === "object" && !it.cadence_text,
  community: (it) => it && typeof it === "object" && !!it.cadence_text,
};

// ---------------------------------------------------------- plain objects

function resolve(obj, path, create) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    let next;
    if (typeof seg === "object") next = Array.isArray(cur) ? cur.find((x) => x && x.id === seg.id) : undefined;
    else {
      next = cur[seg];
      if ((next === undefined || next === null) && create) next = cur[seg] = {};
    }
    if (next === undefined || next === null) return null;
    cur = next;
  }
  return cur;
}

export function getAt(obj, path) {
  const parent = resolve(obj, path, false);
  if (!parent) return undefined;
  const last = path[path.length - 1];
  if (typeof last === "object") return Array.isArray(parent) ? parent.find((x) => x && x.id === last.id) : undefined;
  return parent[last];
}

/** Apply ops to a plain object (returns a new object). */
export function applyToObject(obj, ops) {
  const out = structuredClone(obj || {});
  for (const op of ops) {
    if (op.listReplace) {
      const parent = resolve(out, op.path, true);
      const key = op.path[op.path.length - 1];
      const list = Array.isArray(parent[key]) ? parent[key] : [];
      parent[key] = mergeList(list, op.items, matches[op.listReplace]);
      continue;
    }
    const parent = resolve(out, op.path, true);
    if (!parent) continue;
    const last = op.path[op.path.length - 1];
    if (op.value === undefined) delete parent[last];
    else parent[last] = structuredClone(op.value);
  }
  return out;
}

function mergeList(list, items, isMatch) {
  const first = list.findIndex(isMatch);
  const kept = list.filter((x) => !isMatch(x));
  const at = first < 0 ? kept.length : list.slice(0, first).filter((x) => !isMatch(x)).length;
  return [...kept.slice(0, at), ...items, ...kept.slice(at)];
}

// ------------------------------------------------------- YAML documents

function docPath(doc, path) {
  const out = [];
  let node = doc.contents;
  for (const seg of path) {
    if (typeof seg === "object") {
      if (!YAML.isSeq(node)) throw new Error(`Expected a list at ${out.join(".")}`);
      const i = node.items.findIndex((it) => YAML.isMap(it) && it.get("id") === seg.id);
      if (i < 0) throw new Error(`No item with id ${seg.id}`);
      out.push(i);
      node = node.items[i];
    } else {
      out.push(seg);
      node = YAML.isMap(node) ? node.get(seg, true) : undefined;
    }
  }
  return out;
}

// Strings that YAML 1.1 readers (js-yaml, used by the site build) would read
// as something else: times like 16:00 (sexagesimal numbers), yes/no, etc.
const AMBIGUOUS = /^(\d+(:[0-5]?\d)+(\.\d*)?|y|n|yes|no|on|off|true|false|null|~)$/i;

function makeNode(doc, value) {
  const node = doc.createNode(value);
  if (!YAML.isNode(node)) return node;
  YAML.visit(node, {
    Scalar(_, s) { if (typeof s.value === "string" && AMBIGUOUS.test(s.value)) s.type = "QUOTE_DOUBLE"; },
    Seq(_, q) { if (q.items.length && q.items.every((i) => YAML.isScalar(i) && typeof i.value === "number")) q.flow = true; },
  });
  return node;
}
const STRINGIFY = { lineWidth: 80, flowCollectionPadding: false };

/**
 * Apply ops to YAML text; returns new text. Only the fields and list items
 * whose values change are rewritten; every other line, comment and blank
 * line stays exactly as it was, so the commit shows just the change.
 */
export function applyToYaml(text, ops) {
  const orig = YAML.parseDocument(text);
  const doc = YAML.parseDocument(text);
  for (const op of ops) {
    const p = docPath(doc, op.path);
    if (op.listReplace) {
      const isMatch = matches[op.listReplace];
      const seq = doc.getIn(p, true);
      const nodes = YAML.isSeq(seq) ? seq.items : [];
      const merged = mergeList(nodes.map((n) => ({ n, v: n.toJSON() })), op.items.map((v) => ({ n: makeNode(doc, v), v })), (x) => isMatch(x.v));
      const newSeq = doc.createNode([]);
      newSeq.items = merged.map((x) => x.n);
      doc.setIn(p, newSeq);
      continue;
    }
    const cur = doc.getIn(p, true);
    if (op.value === undefined) doc.deleteIn(p);
    else if (YAML.isScalar(cur) && typeof op.value === "string" && typeof cur.value === "string") cur.value = op.value;
    else doc.setIn(p, makeNode(doc, op.value));
  }
  const want = JSON.stringify(doc.toJSON());
  try {
    const out = splice(text, orig, doc);
    if (JSON.stringify(YAML.parse(out)) === want) return out;
  } catch { /* fall through */ }
  return doc.toString(STRINGIFY);
}

// --------------------------------------------------- minimal text edits

const json = (node) => JSON.stringify(node && node.toJSON ? node.toJSON() : node ?? null);
const keyOf = (pair) => (pair.key && pair.key.value !== undefined ? pair.key.value : pair.key);
const findPair = (map, k) => map.items.find((it) => keyOf(it) === k);
const identity = (it) => (YAML.isMap(it) ? json(it.get("id") ?? it.get("shared") ?? it.get("local") ?? null) : json(it));
const isBlockMap = (n) => YAML.isMap(n) && !n.flow && n.items.length > 0;

function splice(text, orig, doc) {
  const edits = [];
  const colOf = (pos) => pos - (text.lastIndexOf("\n", pos - 1) + 1);
  const pairEnd = (pair) => { const s = pair.key.range[0]; return s + text.slice(s, (pair.value || pair.key).range[1]).replace(/\s+$/, "").length; };

  function diffMap(o, n, edits) {
    const col = colOf(o.items[0].key.range[0]);
    const added = [];
    for (const np of n.items) {
      const op = findPair(o, keyOf(np));
      if (!op) added.push(np);
      else if (json(op.value) !== json(np.value)) diffPair(op, np, edits);
    }
    for (const op of o.items) {
      if (!findPair(n, keyOf(op))) {
        const start = op.key.range[0];
        if (text.slice(start - colOf(start), start).trim()) throw new Error("first key of a list item");
        let end = text.indexOf("\n", pairEnd(op)); // include any comment on the same line
        end = end < 0 ? text.length : end + 1;
        edits.push({ start: start - colOf(start), end, text: "" });
      }
    }
    if (added.length) {
      const at = pairEnd(o.items[o.items.length - 1]);
      edits.push({ start: at, end: at, text: added.map((np) => "\n" + " ".repeat(col) + pairText(np, col)).join("") });
    }
  }

  function diffPair(op, np, edits) {
    const ov = op.value, nv = np.value;
    const sub = [];
    try {
      if (isBlockMap(ov) && YAML.isMap(nv) && nv.items.length) { diffMap(ov, nv, sub); edits.push(...sub); return; }
      if (YAML.isSeq(ov) && YAML.isSeq(nv) && !ov.flow && ov.items.length && ov.items.length === nv.items.length
          && ov.items.every((it, i) => identity(it) === identity(nv.items[i]))) {
        ov.items.forEach((oi, i) => {
          const ni = nv.items[i];
          if (json(oi) === json(ni)) return;
          if (isBlockMap(oi) && YAML.isMap(ni) && ni.items.length) diffMap(oi, ni, sub);
          else throw new Error("unsupported list change");
        });
        edits.push(...sub);
        return;
      }
    } catch { /* rewrite the whole entry instead */ }
    const start = op.key.range[0], col = colOf(start);
    edits.push({ start, end: pairEnd(op), text: pairText(np, col) });
  }

  if (!isBlockMap(orig.contents) || !YAML.isMap(doc.contents)) throw new Error("not a map document");
  diffMap(orig.contents, doc.contents, edits);
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function pairText(pair, col) {
  if (YAML.isNode(pair.key)) { pair.key.commentBefore = undefined; pair.key.spaceBefore = false; }
  const d = new YAML.Document({});
  d.contents.items.push(pair);
  return d.toString({ ...STRINGIFY, lineWidth: Math.max(40, 100 - col) })
    .replace(/^\s*\n/, "").replace(/\s+$/, "").split("\n").join("\n" + " ".repeat(col));
}
