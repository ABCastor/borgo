import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const UA = "borgo-data-pipeline/0.1 (open-source city comparison; contact via repository issues)";

export async function getText(url: string, init: RequestInit = {}): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers ?? {}) } });
    if (res.ok) return res.text();
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

export async function getJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  return JSON.parse(await getText(url, init)) as T;
}

export async function readJson<T = unknown>(rel: string): Promise<T> {
  return JSON.parse(await readFile(join(ROOT, rel), "utf8")) as T;
}

export async function writeJson(rel: string, value: unknown): Promise<void> {
  const path = join(ROOT, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface SeedCity {
  id: string;
  name: string;
  aliases?: string[];
  country: string;
  region?: string;
  wikidataHint?: string;
}

/** One source's output: observations by city, plus when and how they were fetched. */
export interface ObservationFile {
  source: string;
  retrieved: string;
  observations: Record<string, import("../src/core/types.ts").Observation[]>;
}
