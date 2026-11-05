// A minimal reader for the first sheet of an .xlsx file (shared strings and plain values), so the
// pipeline needs no spreadsheet dependency. Good enough for the flat tables statistical offices publish.
import { execFileSync } from "node:child_process";

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)![0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function sheetNames(path: string): string[] {
  const wb = execFileSync("unzip", ["-p", path, "xl/workbook.xml"], { maxBuffer: 1 << 26 }).toString();
  return [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => unescape(m[1]!));
}

export function readSheet(path: string, sheet = 1): (string | number | null)[][] {
  const unzip = (entry: string) => {
    try {
      return execFileSync("unzip", ["-p", path, entry], { maxBuffer: 1 << 28 }).toString();
    } catch {
      return "";
    }
  };
  const shared = [...unzip("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unescape([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const xml = unzip(`xl/worksheets/sheet${sheet}.xml`);
  const rows: (string | number | null)[][] = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: (string | number | null)[] = [];
    for (const c of r[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="([^"]+)"/)?.[1];
      const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[2]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      if (!ref) continue;
      let value: string | number | null = null;
      if (v !== undefined) value = type === "s" ? shared[Number(v)] ?? null : type === "str" || type === "inlineStr" ? unescape(v) : Number(v);
      row[colIndex(ref)] = value;
    }
    rows.push(Array.from(row, (x) => x ?? null));
  }
  return rows;
}
