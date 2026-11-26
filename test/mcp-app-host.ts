// An MCP Apps host in a page: the real view in a sandboxed iframe, a JSON-RPC peer over postMessage that records every
// message the view sends, answers the way a host does (tools/call goes to Borgo's real remote handler), and delivers
// results the way a host does (tool-input, then tool-result). The frame runs under the spec's default CSP. The browser comes from Playwright, which is optional
// (PLAYWRIGHT_MODULE, as scripts/probe-mcp-app.mjs): a machine without it skips the browser tests and says so.
import { remoteHarness } from "./mcp-harness.ts";

export interface HostCaps {
  /** hostCapabilities as the host lists them. */
  capabilities: Record<string, unknown>;
  /** hostContext.availableDisplayModes. */
  displayModes?: string[];
}
export const FULL_HOST: HostCaps = { capabilities: { openLinks: {}, serverTools: {}, serverResources: {}, logging: {}, updateModelContext: { text: {}, structuredContent: {} }, message: { text: {} } }, displayModes: ["inline", "fullscreen"] };
export const BARE_HOST: HostCaps = { capabilities: {} };

export interface Sent { id?: number; method: string; params: any }

/** The CSP a host must apply to a view that declares no domains (MCP Apps 2026-01-26, "Restrictive Default"). */
export const DEFAULT_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'";
/** The view document as a host frames it: under the default CSP, with a recorder of anything the policy blocks. */
export const framed = (html: string) => html.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${DEFAULT_CSP}"><script>window.__violations=[];document.addEventListener("securitypolicyviolation",(e)=>window.__violations.push(e.violatedDirective+" "+e.blockedURI))</script>`);

export async function loadPlaywright(): Promise<any | null> {
  try {
    return await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
  } catch {
    return null;
  }
}

export async function launch(playwright: any) {
  const engine = process.env.BROWSER ?? "chromium";
  return playwright[engine].launch({ headless: true, executablePath: engine === "chromium" ? process.env.CHROME || undefined : undefined });
}

/** Borgo's remote server, reached the way a host reaches it, with the view document it serves. */
export async function borgoServer() {
  const remote = await remoteHarness();
  const html = String(((await remote.client.readResource({ uri: "ui://borgo/compare.html" })).contents[0] as { text?: string }).text);
  const call = async (name: string, args: Record<string, unknown>) => remote.client.callTool({ name, arguments: args });
  return { remote, html, call, close: () => remote.close() };
}
export type Server = Awaited<ReturnType<typeof borgoServer>>;

export interface Opened {
  page: any;
  frame: any;
  errors: string[];
  requests: string[];
  /** Every message the view sent, in order (requests, responses to the host's requests, notifications). */
  sent(): Promise<Sent[]>;
  /** The view's requests of one method, with their params. */
  calls(method: string): Promise<any[]>;
  /** Delivers a tool call the way a host does: its arguments, then its result. */
  deliver(args: Record<string, unknown>, result: unknown, opts?: { name?: string; withInput?: boolean }): Promise<void>;
  /** Sends the view any host message. */
  push(message: unknown): Promise<void>;
  close(): Promise<void>;
}

export async function openHost(browser: any, server: Server, o: { theme?: "light" | "dark"; host?: HostCaps; viewport?: { width: number; height: number }; refuse?: string[]; echo?: boolean } = {}): Promise<Opened> {
  const theme = o.theme ?? "light";
  const host = o.host ?? FULL_HOST;
  const page = await browser.newPage({ viewport: o.viewport ?? { width: 1000, height: 850 }, colorScheme: theme });
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on("request", (r: any) => requests.push(r.url()));
  await page.exposeFunction("serverCall", async (name: string, args: Record<string, unknown>) => JSON.parse(JSON.stringify(await server.call(name, args))));
  await page.setContent('<!doctype html><html><body style="margin:0"><iframe id="view" sandbox="allow-scripts" style="border:0;width:100%;height:100px"></iframe></body></html>');
  await page.evaluate(({ html, theme, host, refuse, echo }: any) => {
    document.body.style.background = theme === "dark" ? "#181715" : "#fff";
    const iframe = document.getElementById("view") as HTMLIFrameElement;
    const w = window as any;
    w.sent = [];
    w.ready = false;
    w.mode = "inline";
    const reply = (id: number, result: unknown) => iframe.contentWindow!.postMessage({ jsonrpc: "2.0", id, result }, "*");
    const fail = (id: number, message: string) => iframe.contentWindow!.postMessage({ jsonrpc: "2.0", id, error: { code: -32000, message } }, "*");
    w.push = (m: unknown) => iframe.contentWindow!.postMessage(m, "*");
    window.addEventListener("message", async (event) => {
      if (event.source !== iframe.contentWindow) return;
      const m = event.data;
      w.sent.push({ id: m.id, method: m.method, params: m.params, response: m.method ? undefined : m });
      if (!m.method) return;
      if (m.method === "ui/initialize") reply(m.id, { protocolVersion: "2026-01-26", hostInfo: { name: "Borgo test host", version: "1" }, hostCapabilities: host.capabilities, hostContext: { theme, displayMode: "inline", availableDisplayModes: host.displayModes } });
      else if (m.method === "ui/notifications/initialized") w.ready = true;
      else if (m.method === "ui/notifications/size-changed") iframe.style.height = Math.min(5000, m.params.height) + "px";
      else if (refuse.includes(m.method)) fail(m.id, "denied by the test host");
      else if (m.method === "tools/call") {
        try {
          const result = await w.serverCall(m.params.name, m.params.arguments);
          reply(m.id, result);
          // Some hosts also deliver an app's own call as a tool call: its arguments, then its result.
          if (echo) {
            w.push({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: m.params.arguments } });
            w.push({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result });
          }
        } catch (e) { fail(m.id, String(e)); }
      } else if (m.method === "ui/request-display-mode") { w.mode = host.displayModes?.includes(m.params.mode) ? m.params.mode : w.mode; reply(m.id, { mode: w.mode }); }
      else if (m.id !== undefined) reply(m.id, {});
    });
    iframe.srcdoc = html;
  }, { html: framed(server.html), theme, host, refuse: o.refuse ?? [], echo: o.echo ?? false });
  await page.waitForFunction(() => (window as any).ready === true);
  return {
    page, frame: page.frameLocator("#view"), errors, requests,
    sent: () => page.evaluate(() => (window as any).sent),
    calls: async (method: string) => (await page.evaluate(() => (window as any).sent)).filter((m: Sent) => m.method === method).map((m: Sent) => m.params),
    push: (message: unknown) => page.evaluate((m: unknown) => (window as any).push(m), message),
    async deliver(args, result, opts = {}) {
      if (opts.withInput !== false) await page.evaluate((a: unknown) => (window as any).push({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: a } }), args);
      await page.evaluate((r: unknown) => (window as any).push({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: r }), result);
    },
    close: () => page.close(),
  };
}
