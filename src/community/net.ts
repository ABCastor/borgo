// The checks a proposal needs the network for: the cited page answers, and a quote given is on it. Node only.
// The pages are untrusted: only http(s) on the usual ports, never an address inside a private network, redirects
// followed by hand and checked again, a time limit and a size limit. Nothing on a page is run or followed beyond that.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { USER_AGENT } from "../fetch/context.ts";
import { shown, type Proposal } from "./proposal.ts";

export interface Page {
  status: number;
  /** The content type, lower case, without parameters. */
  type: string;
  text: string;
  url: string;
}

/** Reads a page; throws with a readable reason when it cannot. */
export type Http = (url: string) => Promise<Page>;

const MAX_BYTES = 6_000_000;
const TIMEOUT_MS = 20_000;

/** True for loopback, private, link-local, carrier-grade NAT, multicast and reserved addresses, v4 and v6. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

async function safeUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("not an http or https address");
  if (u.username || u.password) throw new Error("an address with a user name or password");
  if (u.port && u.port !== "443" && u.port !== "80") throw new Error(`port ${u.port} is not a web port`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("a local address");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error("an address inside a private network");
  return u;
}

/** The real network, guarded. */
export const nodeHttp: Http = async (start) => {
  let url = await safeUrl(start);
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.5" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await safeUrl(new URL(res.headers.get("location")!, url).href);
      await res.body?.cancel();
      continue;
    }
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    let text = "";
    if (res.body && /^(text\/|application\/(xhtml\+xml|xml|json))/.test(type)) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      text = new TextDecoder().decode(Buffer.concat(chunks));
    } else await res.body?.cancel();
    return { status: res.status, type, text, url: url.href };
  }
  throw new Error("too many redirects");
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "...", sect: "§", euro: "€", pound: "£" };

/** A page or quote reduced to its words, for a forgiving comparison: no markup, entities, case or spacing. */
export function plainText(s: string): string {
  return s
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .normalize("NFKC")
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Refusals that mean "a server is there but will not serve a program": a person can still open the page. */
const REFUSED = new Set([401, 403, 405, 406, 429, 451, 503]);

/** Checks every cited address answers, and that a quote is on its page. Problems block; warnings go to the reviewer. */
export async function checkCitations(p: Proposal, http: Http = nodeHttp): Promise<{ problems: string[]; warnings: string[] }> {
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const c of p.citations) {
    const label = c.primary ? "The official source" : "The lead";
    let page: Page;
    try {
      page = await http(c.url);
    } catch (e) {
      const why = e instanceof Error ? (e.name === "TimeoutError" ? "it did not answer within 20 seconds" : e.message) : String(e);
      (c.primary ? problems : warnings).push(`${label} ${shown(c.url)} could not be read: ${why}.`);
      continue;
    }
    if (page.status === 404 || page.status === 410) {
      (c.primary ? problems : warnings).push(`${label} ${shown(c.url)} answers ${page.status}: the page is not there. Check the address.`);
      continue;
    }
    if (REFUSED.has(page.status) || page.status >= 500) {
      warnings.push(`${label} ${shown(c.url)} answered ${page.status} to an automated check; a reviewer opens it by hand${c.quote ? " and looks for the quote" : ""}.`);
      continue;
    }
    if (page.status >= 400) {
      (c.primary ? problems : warnings).push(`${label} ${shown(c.url)} answers ${page.status}.`);
      continue;
    }
    if (!c.quote) continue;
    if (!page.text) {
      warnings.push(`${label} is ${page.type || "not text"} (${shown(c.url)}); the quote cannot be checked automatically, so a reviewer checks it.`);
      continue;
    }
    const want = plainText(c.quote).replace(/^["']|["']$/g, "").replace(/\.\.\.$/, "").trim();
    if (want.length < 8) problems.push("The quote is too short to check: copy a sentence that states the value.");
    else if (!plainText(page.text).includes(want)) {
      // A page drawn by a script has no text until a browser runs it: say so, rather than call the quote wrong.
      const thin = plainText(page.text).length < 1500;
      (thin ? warnings : problems).push(thin ? `${shown(c.url)} has almost no text without a browser; a reviewer looks for the quote.` : `The quote is not on ${shown(c.url)}. Copy it exactly from the page, or leave the quote out.`);
    }
  }
  return { problems, warnings };
}
