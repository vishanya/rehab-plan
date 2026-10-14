// Pulls named top-level declarations out of index.html's inline <script> and
// evaluates them in an isolated vm context, so pure helpers can be unit tested
// without a browser or a build step.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const src = scripts.reduce((a, b) => (b.length > a.length ? b : a), "");

function extract(name) {
  const m = new RegExp(`(?:^|[;\\s])((?:async\\s+)?function\\s+${name}\\s*\\(|const\\s+${name}\\s*=)`).exec(src);
  if (!m) throw new Error(`declaration not found in index.html: ${name}`);
  const start = m.index + m[0].length - m[1].length;
  const isFn = /function/.test(m[1]);
  let depth = 0, opened = false, quote = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) { depth++; if (ch === "{") opened = true; }
    else if (")]}".includes(ch)) {
      depth--;
      if (isFn && opened && depth === 0 && ch === "}") return src.slice(start, i + 1);
    } else if (!isFn && depth === 0 && (ch === ";" || ch === "\n")) return src.slice(start, i);
  }
  throw new Error(`could not find end of declaration: ${name}`);
}

export function loadApp(names, globals = {}, prelude = "") {
  const ctx = vm.createContext({ URLSearchParams, ...globals });
  if (!("window" in globals)) ctx.window = ctx;
  const body = names.map(extract).join(";\n");
  vm.runInContext(`${prelude}\n${body};\nglobalThis.__api={${names.join(",")}};`, ctx);
  return ctx.__api;
}

export function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}
