// Draws the social card (public/og.png, 1200 by 630) with headless Chrome and the site's own fonts.
// Run by hand when the name or the wording changes: node scripts/og-image.ts. The PNG is committed, so the build
// never needs Chrome.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../pipeline/lib.ts";
import { MARK } from "../src/ui/brand/index.ts";
import { markSvg } from "../src/ui/brand/marks.ts";
import { SITE_NAME } from "./site.ts";

const fonts = pathToFileURL(join(ROOT, "public/fonts")).href;
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Word; font-weight: 200 900; src: url(${fonts}/literata.woff2) format("woff2"); }
@font-face { font-family: UI; font-weight: 100 900; src: url(${fonts}/archivo-variable.woff2) format("woff2"); }
html, body { margin: 0; width: 1200px; height: 630px; background: #FAF9F4; color: #14130F; }
body { box-sizing: border-box; padding: 92px 96px; display: flex; flex-direction: column; justify-content: space-between; font-family: UI, sans-serif; }
h1 { margin: 0; font-family: Word, serif; font-weight: 560; font-variation-settings: "opsz" 72; letter-spacing: -.05em; font-size: 128px; line-height: .95; }
p { margin: 28px 0 0; font-size: 36px; line-height: 1.3; color: #5A554C; max-width: 900px; }
.line { border-top: 2px solid #14130F; padding-top: 26px; display: flex; gap: 44px; font-size: 28px; font-weight: 600; }
.h { color: #A9461F; } .m { color: #006770; } .b { color: #55692A; }
.name { display: flex; align-items: flex-end; gap: 40px; }
.mark { width: 150px; height: auto; color: #14130F; margin-bottom: 4px; } .mk-ink { fill: currentColor; } .mk-you { fill: #C4552A; }
.star { color: #C4552A; margin-left: .1em; }
</style></head><body>
<div><div class="name">${markSvg(MARK)}<h1>${SITE_NAME}<span class="star">*</span></h1></div><p>Compare any cities on open data: take-home pay, rent, climate, who can move there.</p></div>
<div class="line"><span class="h">Your values</span><span class="m">Sourced figures</span><span class="b">Your verdict</span></div>
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), "og-"));
writeFileSync(join(dir, "og.html"), page);
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = join(ROOT, "public/og.png");
await new Promise<void>((resolve, reject) => {
  const p = spawn(chrome, ["--headless=new", `--user-data-dir=${join(dir, "profile")}`, "--hide-scrollbars", "--window-size=1200,630", "--force-device-scale-factor=1", "--virtual-time-budget=2000", `--screenshot=${out}`, pathToFileURL(join(dir, "og.html")).href], { stdio: "ignore" });
  p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`chrome exited ${code}`))));
});
console.log("wrote", out);
