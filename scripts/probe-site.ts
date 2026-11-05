// Opens every page in dist/sitemap.xml in one headless Chrome at a phone width and fails if any page is wider
// than the viewport. Usage: node scripts/probe-site.ts [width=390]   (build first: node scripts/build.ts)
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../pipeline/lib.ts";
import { serveDir, SITE_ORIGIN } from "./site.ts";

const width = Number(process.argv[2] ?? 390);
const dist = join(ROOT, "dist");
const paths = [...(await readFile(join(dist, "sitemap.xml"), "utf8")).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.slice(SITE_ORIGIN.length));
const port = 9800 + Math.floor(Math.random() * 150);
const server = await serveDir(dist, port);
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const debug = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${debug}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "probe-site-"))}`, `--window-size=${width},900`, "about:blank"], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];
let ws: WebSocket | null = null;
try {
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(150);
    try {
      target = ((await (await fetch(`http://127.0.0.1:${debug}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("Chrome did not start");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws!.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  let loaded: (() => void) | null = null;
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) pending.get(d.id)!(d.result);
    if (d.method === "Page.loadEventFired") loaded?.();
  });
  const send = (method: string, params: object = {}) => new Promise<any>((r) => { const n = ++id; pending.set(n, r); ws!.send(JSON.stringify({ id: n, method, params })); });
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.enable");
  const probe = `(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")].filter(e => { const r = e.getBoundingClientRect(); return r.right > vw + 1 && r.width > 0 && getComputedStyle(e).position !== "fixed"; })
      .filter(e => ![...e.children].some(c => c.getBoundingClientRect().right > vw + 1))
      .slice(0, 5).map(e => e.tagName.toLowerCase() + "." + [...e.classList].join(".") + " right=" + Math.round(e.getBoundingClientRect().right));
    return JSON.stringify({ vw, sw: document.documentElement.scrollWidth, wide, title: document.title });
  })()`;
  for (const path of paths) {
    const done = new Promise<void>((r) => (loaded = r));
    await send("Page.navigate", { url: `http://127.0.0.1:${port}${path}` });
    await Promise.race([done, sleep(5000)]);
    if (path === "/") await sleep(800); // the app renders after its data arrives
    const res = await send("Runtime.evaluate", { expression: probe, returnByValue: true });
    const r = JSON.parse(res.result.value) as { vw: number; sw: number; wide: string[]; title: string };
    if (r.sw > r.vw || r.wide.length) failures.push(`${path}: scrollWidth ${r.sw} > ${r.vw} ${r.wide.join(", ")}`);
    if (!r.title || r.title === "Not found") failures.push(`${path}: no page`);
  }
} finally {
  ws?.close();
  proc.kill();
  server.close();
}
console.log(`${paths.length} pages at ${width}px: ${failures.length ? `${failures.length} overflow` : "none overflow"}`);
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
