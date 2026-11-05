// Spreadsheets from statistical offices, read in Node: the bytes go to a temporary file for the pipeline's
// dependency-free xlsx reader (it calls `unzip`).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSheet, sheetNames } from "../../../pipeline/xlsx.ts";

export function xlsxRows(bytes: Uint8Array, sheet?: string): (string | number | null)[][] {
  const file = join(mkdtempSync(join(tmpdir(), "wtl-xlsx-")), "book.xlsx");
  writeFileSync(file, bytes);
  const n = sheet ? sheetNames(file).indexOf(sheet) + 1 : 1;
  if (n < 1) throw new Error(`no sheet "${sheet}"`);
  return readSheet(file, n);
}
