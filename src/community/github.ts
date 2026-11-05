// The few GitHub REST calls the proposal workflow makes, with the workflow's own GITHUB_TOKEN. Every value from an
// issue travels as JSON data in a request body, never through a shell.
import { Buffer } from "node:buffer";

export interface GitHub {
  call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }>;
}

export function gitHub(token: string, base?: string): GitHub {
  // GitHub sets GITHUB_API_URL in a workflow; tests point it at a recorded server.
  const api = base || "https://api.github.com";
  return {
    async call(method, path, body) {
      const res = await fetch(`${api}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "borgo-proposals", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (res.status >= 400 && res.status !== 404) throw new Error(`GitHub ${method} ${path}: ${res.status} ${(data as { message?: string } | null)?.message ?? ""}`);
      return { status: res.status, data };
    },
  };
}

/** Leaves one check comment per issue, updated in place on every edit. */
export async function upsertComment(gh: GitHub, repo: string, issue: number, marker: string, body: string): Promise<void> {
  const { data } = await gh.call<{ id: number; body: string; user: { type: string } }[]>("GET", `/repos/${repo}/issues/${issue}/comments?per_page=100`);
  const mine = (data ?? []).find((c) => c.user?.type === "Bot" && c.body?.includes(marker));
  if (mine) await gh.call("PATCH", `/repos/${repo}/issues/comments/${mine.id}`, { body });
  else await gh.call("POST", `/repos/${repo}/issues/${issue}/comments`, { body });
}

/** The labels this workflow manages; labels a maintainer added are left alone. */
export const MANAGED_LABELS = ["valid", "needs changes", "rule", "data", "locked"];

export async function setLabels(gh: GitHub, repo: string, issue: number, current: string[], wanted: string[]): Promise<void> {
  for (const l of current.filter((x) => MANAGED_LABELS.includes(x) && !wanted.includes(x))) await gh.call("DELETE", `/repos/${repo}/issues/${issue}/labels/${encodeURIComponent(l)}`);
  const add = wanted.filter((x) => !current.includes(x));
  if (add.length) await gh.call("POST", `/repos/${repo}/issues/${issue}/labels`, { labels: add });
}

/**
 * Puts one file change on a branch made from `base` and opens (or updates) its pull request. The branch belongs to
 * the workflow: it is reset to `base` on every run, so an edited issue replaces the change rather than stacking.
 */
export async function proposePullRequest(gh: GitHub, o: { repo: string; base: string; branch: string; path: string; content: string; message: string; title: string; body: string }): Promise<{ number: number; url: string }> {
  // number 0: the branch is ready but the pull request could not be opened; url is then the comparison page.
  const ref = await gh.call<{ object: { sha: string } }>("GET", `/repos/${o.repo}/git/ref/heads/${o.base}`);
  const sha = ref.data.object.sha;
  const existing = await gh.call("GET", `/repos/${o.repo}/git/ref/heads/${o.branch}`);
  if (existing.status === 404) await gh.call("POST", `/repos/${o.repo}/git/refs`, { ref: `refs/heads/${o.branch}`, sha });
  else await gh.call("PATCH", `/repos/${o.repo}/git/refs/heads/${o.branch}`, { sha, force: true });
  const file = await gh.call<{ sha: string }>("GET", `/repos/${o.repo}/contents/${o.path}?ref=${encodeURIComponent(o.branch)}`);
  await gh.call("PUT", `/repos/${o.repo}/contents/${o.path}`, {
    message: o.message,
    content: Buffer.from(o.content, "utf8").toString("base64"),
    branch: o.branch,
    ...(file.status === 404 ? {} : { sha: file.data.sha }),
  });
  const owner = o.repo.split("/")[0]!;
  const open = await gh.call<{ number: number; html_url: string }[]>("GET", `/repos/${o.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${o.branch}`)}`);
  if (open.data?.length) {
    const pr = open.data[0]!;
    await gh.call("PATCH", `/repos/${o.repo}/pulls/${pr.number}`, { title: o.title, body: o.body });
    return { number: pr.number, url: pr.html_url };
  }
  try {
    const pr = await gh.call<{ number: number; html_url: string }>("POST", `/repos/${o.repo}/pulls`, { title: o.title, head: o.branch, base: o.base, body: o.body, maintainer_can_modify: true });
    return { number: pr.data.number, url: pr.data.html_url };
  } catch (e) {
    // The repository may not let workflows open pull requests ("Allow GitHub Actions to create pull requests"):
    // the change is on its branch, and a maintainer opens the pull request from the comparison page.
    console.error(e instanceof Error ? e.message : e);
    return { number: 0, url: `https://github.com/${o.repo}/compare/${o.base}...${o.branch}?expand=1` };
  }
}
