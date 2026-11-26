// Opens a Borgo link the way the site does: the site's own loadProfile (src/ui/state.ts) reads the address, with the
// page's location and storage stood in for. What comes back is the profile the visitor would land on.
import { loadDataset } from "../src/agent/dataset.ts";
import type { Profile } from "../src/core/types.ts";
import { loadProfile } from "../src/ui/state.ts";

export async function siteOpens(url: string): Promise<{ cities: string[]; profile: Profile }> {
  const u = new URL(url);
  const g = globalThis as Record<string, unknown>;
  const was = { location: Object.getOwnPropertyDescriptor(g, "location"), localStorage: Object.getOwnPropertyDescriptor(g, "localStorage") };
  const set = (k: string, value: unknown) => Object.defineProperty(g, k, { value, configurable: true, writable: true });
  set("location", { href: url, hash: u.hash, search: u.search, pathname: u.pathname });
  set("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 });
  try {
    const profile = loadProfile(loadDataset());
    return { cities: profile.cities, profile };
  } finally {
    for (const [k, d] of Object.entries(was)) d ? Object.defineProperty(g, k, d) : delete g[k];
  }
}
