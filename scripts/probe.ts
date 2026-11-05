// Drives headless Chrome over the DevTools protocol to measure the built page: elements wider than the
// viewport, and an optional expression. Usage: node scripts/probe.ts <url> <width> [expression]
// SHOT=file.png saves a screenshot (DARK=1 for dark mode, FULL=1 for the whole page, CLICK=<selector> first, HOVER=<selector> to point at an element).
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, widthArg, expr] = process.argv.slice(2);
const width = Number(widthArg ?? 390);
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "probe-"))}`, `--window-size=${width},1200`, "about:blank"], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ws: WebSocket | null = null;
try {
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(150);
    try {
      target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("Chrome did not start");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws!.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map<number, (v: unknown) => void>();
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) pending.get(d.id)!(d.result);
  });
  const send = (method: string, params: object = {}) => new Promise<any>((r) => { const n = ++id; pending.set(n, r); ws!.send(JSON.stringify({ id: n, method, params })); });
  await send("Emulation.setDeviceMetricsOverride", { width, height: 1200, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(2500);
  const probe = `(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")].filter(e => { const r = e.getBoundingClientRect(); return r.right > vw + 1 && r.width > 0 && getComputedStyle(e).position !== "fixed"; })
      .filter(e => ![...e.children].some(c => c.getBoundingClientRect().right > vw + 1))
      .slice(0, 12).map(e => (e.tagName.toLowerCase() + "." + [...e.classList].join(".")) + " right=" + Math.round(e.getBoundingClientRect().right) + " w=" + Math.round(e.getBoundingClientRect().width));
    return JSON.stringify({ viewport: vw, scrollWidth: document.documentElement.scrollWidth, overflowing: wide${expr ? `, expr: (${expr})` : ""} }, null, 1);
  })()`;
  const res = await send("Runtime.evaluate", { expression: probe, returnByValue: true });
  console.log(res.result?.value ?? JSON.stringify(res));
  if (process.env.SHOT) {
    if (process.env.DARK) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    else await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    if (process.env.CLICK) await send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(process.env.CLICK)})?.click()` });
    if (process.env.HOVER) {
      const box = await send("Runtime.evaluate", { expression: `(() => { const r = document.querySelector(${JSON.stringify(process.env.HOVER)})?.getBoundingClientRect(); return r ? JSON.stringify([r.x + r.width / 2, r.y + r.height / 2]) : "null"; })()`, returnByValue: true });
      const xy = JSON.parse(box.result.value);
      if (xy) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: xy[0], y: xy[1] });
    }
    await sleep(600);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!process.env.FULL });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.SHOT, Buffer.from(shot.data, "base64"));
    console.log("saved", process.env.SHOT);
  }
} finally {
  ws?.close();
  proc.kill();
}
