// A minimal reader for OpenDocument spreadsheets (.ods), as pipeline/xlsx.ts is for .xlsx: each named table's rows of
// plain values (numbers as numbers, text as text), with repeated cells expanded. Enough for statistical offices' tables.
import { execFileSync } from "node:child_process";

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Every table in the file, by name, as rows of cells. Long runs of empty repeated cells (column padding) are cut. */
export function readOds(path: string): Record<string, (string | number | null)[][]> {
  const xml = execFileSync("unzip", ["-p", path, "content.xml"], { maxBuffer: 1 << 28 }).toString();
  const out: Record<string, (string | number | null)[][]> = {};
  for (const t of xml.matchAll(/<table:table table:name="([^"]+)"[^>]*>([\s\S]*?)<\/table:table>/g)) {
    const rows: (string | number | null)[][] = [];
    for (const r of t[2]!.matchAll(/<table:table-row([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
      const row: (string | number | null)[] = [];
      for (const c of (r[2] ?? "").matchAll(/<table:(?:covered-)?table-cell([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
        const attrs = c[1]!;
        const repeat = Math.min(Number(attrs.match(/table:number-columns-repeated="(\d+)"/)?.[1] ?? 1), 64);
        const num = attrs.match(/office:value="([^"]+)"/)?.[1];
        const text = unescape([...(c[2] ?? "").matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g)].map((p) => p[1]!.replace(/<[^>]+>/g, "")).join(" ")).trim();
        const value = num !== undefined ? Number(num) : text || null;
        for (let i = 0; i < repeat; i++) row.push(value);
      }
      while (row.length && row.at(-1) === null) row.pop();
      rows.push(row);
    }
    out[unescape(t[1]!)] = rows;
  }
  return out;
}
