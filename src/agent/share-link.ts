// The Borgo site's share link, built the way the site reads it (src/ui/state.ts: shareUrl, loadProfile): the profile
// rides in the fragment after #share=, as base64url JSON, so it never reaches a server. Self-contained on purpose (no
// imports): the MCP App view inlines this very file, type-stripped, to open cities in Borgo from a chat.

export const BORGO_ORIGIN = "https://borgo.abcastor.com";

export function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A link that opens exactly these cities on the site with this profile. `profile` is the shared part of a profile (no
 * pay, passports or spending: see src/agent/share.ts). `places` names each city as "Name, CC", so a place the visitor's
 * browser lacks is read as written and offered for fetching, not dropped.
 */
export function shareLink(profile: Record<string, unknown>, cities: { id: string; name: string; country: string }[]): string {
  const places = Object.fromEntries(cities.map((c) => [c.id, `${c.name}, ${c.country}`]));
  return `${BORGO_ORIGIN}/#share=${toBase64Url(JSON.stringify({ ...profile, cities: cities.map((c) => c.id), places }))}`;
}
