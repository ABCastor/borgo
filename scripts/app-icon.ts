// Draws Borgo's app icon (the mark with the Castor mark at its top right) as SVG and as PNGs with headless Chrome:
// public/root/icon.svg, icon-512.png, icon-192.png and apple-touch-icon.png (180). Run by hand when the mark changes:
// node scripts/app-icon.ts. The files are committed, so the build never needs Chrome.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../pipeline/lib.ts";
import { MARK } from "../src/ui/brand/index.ts";
import { appIconSvg } from "../src/ui/brand/marks.ts";

const svg = appIconSvg(MARK, readFileSync(join(ROOT, "src/ui/brand/castor-mark.svg"), "utf8"));
const out = join(ROOT, "public/root");
writeFileSync(join(out, "icon.svg"), svg);
const dir = mkdtempSync(join(tmpdir(), "icon-"));
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
for (const [size, name] of [[512, "icon-512.png"], [192, "icon-192.png"], [180, "apple-touch-icon.png"]] as const) {
  const page = join(dir, `${size}.html`);
  writeFileSync(page, `<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(chrome, ["--headless=new", `--user-data-dir=${join(dir, "profile")}`, "--hide-scrollbars", `--window-size=${size},${size}`, "--force-device-scale-factor=1", `--screenshot=${join(out, name)}`, `file://${page}`], { stdio: "ignore" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`chrome exited ${code}`))));
  });
  console.log("wrote", join(out, name));
}
