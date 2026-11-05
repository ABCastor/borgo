// Types into the built app in headless Chrome the way a person does (real pointer and key events) and fails if a
// redraw loses what was typed, the focus, or lets a refused figure through. The sequences are the ones a re-test
// found broken: a field saves on blur and the save redrew the panel, so the next field's keystrokes were lost.
// Usage: node scripts/probe-input.ts   (build first: node scripts/build.ts)
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../pipeline/lib.ts";
import { serveDir } from "./site.ts";

const port = 9800 + Math.floor(Math.random() * 150);
const server = await serveDir(join(ROOT, "dist"), port);
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const debug = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${debug}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "probe-input-"))}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; detail: string }[] = [];
let ws: WebSocket | null = null;
const origin = `http://127.0.0.1:${port}`;

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
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) pending.get(d.id)!(d.result ?? d.error);
  });
  const send = (method: string, params: object = {}) =>
    new Promise<any>((r) => {
      const n = ++id;
      pending.set(n, r);
      ws!.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.enable");

  const js = async <T>(expression: string): Promise<T> => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value as T;
  const open = async (path: string) => {
    await send("Page.navigate", { url: `${origin}/` });
    await sleep(400);
    await js(`localStorage.clear()`);
    await send("Page.navigate", { url: `${origin}${path}` });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if (await js<boolean>(`!!document.querySelector(".cchip, .answer")`)) break;
    }
    await sleep(300);
  };
  /** A real click: the pointer goes down and up at the element's centre. */
  const click = async (selector: string) => {
    const at = await js<{ x: number; y: number } | null>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!at) throw new Error(`no ${selector}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
    await sleep(30);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
    await sleep(60);
  };
  const KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
    Tab: { key: "Tab", code: "Tab", vk: 9 },
    Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  };
  const press = async (name: string) => {
    const k = KEYS[name]!;
    await send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, ...(k.text ? { text: k.text } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk });
    await sleep(60);
  };
  /** Types character by character, quickly, as a person does right after moving to a field. */
  const type = async (text: string) => {
    for (const ch of text) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    }
  };
  const selectAll = () => js(`document.activeElement && document.activeElement.select && document.activeElement.select()`);
  const profile = () => js<any>(`JSON.parse(localStorage.getItem("borgo:profile:v1") || "{}")`);
  const focused = () =>
    js<string>(`(() => { const e = document.activeElement; if (!e || e === document.body) return "body"; const name = e.id ? "#" + e.id : e.tagName.toLowerCase(); const label = e.getAttribute("aria-label") || (e.textContent || "").trim().slice(0, 40); return label ? name + " (" + label + ")" : name; })()`);
  const check = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

  // 1. For You: Age 34, then a click on Children's ages and 2 typed at once.
  for (const how of ["click", "Tab"] as const) {
    await open("/?cities=lisbon-pt,berlin-de");
    await click("button.who");
    await sleep(300);
    await click("#p0-age");
    await type("34");
    if (how === "click") await click("#p0-kids");
    else await press("Tab");
    const at = await focused();
    await type("2");
    await press("Tab");
    await sleep(500);
    const p = await profile();
    check(`For You (${how}): Age 34 then Children's ages 2`, JSON.stringify(p.children) === "[2]" && p.household?.[0]?.newcomer?.age === 34 && at === "#p0-kids", `children=${JSON.stringify(p.children)} age=${p.household?.[0]?.newcomer?.age} focus after moving=${at}`);
  }

  // 2. Money: gross 60000, then a click on spending and 1500, then savings 20000.
  await open("/?cities=lisbon-pt,berlin-de#/money");
  await click("#pay-0");
  await type("60000");
  await click("#m-every");
  await selectAll();
  await type("1500");
  await click("#m-save");
  await selectAll();
  await type("20000");
  await press("Tab");
  await sleep(600);
  {
    const p = await profile();
    check("Money: gross 60000, spending 1500, savings 20000", p.income?.gross === 60000 && p.income?.everyday?.amount === 1500 && p.income?.savings === 20000, `gross=${p.income?.gross} spending=${p.income?.everyday?.amount} savings=${p.income?.savings}`);
  }

  // 3. Keyboard focus stays on the next control (WCAG 2.4.3): salary, rent, then removing a city.
  await open("/?cities=lisbon-pt,berlin-de");
  await js(`document.getElementById("verdict-salary").focus()`);
  const nextAfterSalary = await js<string>(`(() => { const all = [...document.querySelectorAll("a[href], button, input, select, textarea")].filter((e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length); const i = all.indexOf(document.activeElement); const n = all[i + 1]; return n.id ? "#" + n.id : n.tagName.toLowerCase() + (n.getAttribute("aria-label") ? "[" + n.getAttribute("aria-label") + "]" : ""); })()`);
  await type("60000");
  await press("Tab");
  await sleep(500);
  {
    const f = await focused();
    // The salary's block goes once money counts; focus moves on to the first control after it, never back up the page.
    const onward = await js<boolean>(`!!(document.querySelector("button.share-btn").compareDocumentPosition(document.activeElement) & Node.DOCUMENT_POSITION_FOLLOWING)`);
    // What stands in its place, the next step ("Add your rent for Lisbon"), takes focus.
    check("Salary typed, then Tab: focus moves to what replaced the field", f !== "body" && onward && /Add your rent/.test(f), `focus=${f} (next before the redraw: ${nextAfterSalary})`);
  }
  const rent = await js<boolean>(`!!document.getElementById("rent-lisbon-pt")`);
  if (rent) {
    await js(`document.getElementById("rent-lisbon-pt").focus()`);
    await type("900");
    await press("Tab");
    await sleep(500);
    const f = await focused();
    const p = await profile();
    // Tab from the rent goes to the card's "Open dossier", not the Lisbon chip at the top that has the same address.
    check("Rent typed, then Tab: saved, and focus on the next control", /Open dossier/.test(f) && p.overrides?.["lisbon-pt"]?.rent_1bed === 900, `focus=${f} rent=${p.overrides?.["lisbon-pt"]?.rent_1bed}`);
  } else check("Rent typed, then Tab: saved, and focus on the next control", false, "no #rent-lisbon-pt after the salary");
  await js(`document.querySelector('[aria-label="Remove Berlin"]').focus()`);
  await press("Enter");
  await sleep(500);
  {
    const f = await focused();
    const p = await profile();
    // The button went with its city: focus goes to the next control, the city search.
    check("Remove Berlin by keyboard: focus on the next control", f.startsWith("#add-city") && !(p.cities ?? []).includes("berlin-de"), `focus=${f} cities=${JSON.stringify(p.cities)}`);
  }

  // 4. A negative salary is refused beside the field, and not stored.
  await open("/?cities=lisbon-pt,berlin-de");
  await click("#verdict-salary");
  await type("-50000");
  await press("Tab");
  await sleep(500);
  {
    const p = await profile();
    // The message sits in the same block as the field.
    const said = await js<string>(`(() => { const f = document.getElementById("verdict-salary"); const box = f && f.closest(".v-next, label, div"); return ((box && box.parentElement && box.parentElement.querySelector(".fld-err")) || document.querySelector(".fld-err"))?.textContent?.trim() || ""; })()`);
    const kept = await js<string>(`document.getElementById("verdict-salary")?.value ?? "gone"`);
    check("Salary -50000: refused beside the field, kept there, not stored", p.income?.gross !== -50000 && said.length > 0 && kept === "-50000", `gross=${p.income?.gross} field="${kept}" message="${said.slice(0, 120)}"`);
  }
} finally {
  ws?.close();
  proc.kill();
  server.close();
}
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}: ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length} input sequences: ${failed ? `${failed} failed` : "all held"}`);
if (failed) process.exit(1);
