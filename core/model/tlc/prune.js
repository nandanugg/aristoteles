// Preload (node -r): quint serializes the whole file table (GBs) with the main module;
// keep only the table, types and effects entries whose ids occur in the modules, then
// stringify as usual.
const jb = require(process.env.HOME + "/aristoteles/node_modules/json-bigint");
const orig = jb.stringify;
const rep = v => v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? Array.from(v) : v;
jb.stringify = function (obj, replacer, space) {
  if (!obj || typeof obj !== "object" || !("modules" in obj) || !("table" in obj))
    return orig.call(this, obj, replacer, space);
  const ids = new Set(), seen = new Set();
  (function collect(v) {
    v = rep(v);
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach(collect); return; }
    if ("id" in v && (typeof v.id === "bigint" || typeof v.id === "number")) ids.add(String(v.id));
    for (const k of Object.keys(v)) collect(v[k]);
  })(obj.modules);
  const prune = m => {
    const r = {};
    if (!m) return r;
    for (const [k, x] of (m instanceof Map ? m.entries() : Object.entries(m)))
      if (ids.has(String(k))) r[String(k)] = x;
    return r;
  };
  const o = { ...obj, table: prune(obj.table), types: prune(obj.types), effects: prune(obj.effects) };
  console.error(`[prune] ids ${ids.size}`);
  return orig.call(this, o, replacer, space);
};
