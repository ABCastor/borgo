// The proposal workflow's check (.github/workflows/proposals.yml): reads the issue from the event file GitHub writes,
// checks it, labels it, and leaves one comment saying what to fix or what happens next. The issue's text is only ever
// data here: it is parsed, never run, and never reaches a shell.
// Locally, without GitHub: node scripts/proposals/check-issue.ts --body issue.md [--offline]
import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkIssueBody } from "../../src/community/check.ts";
import { gitHub, setLabels, upsertComment } from "../../src/community/github.ts";
import { isProposalBody } from "../../src/community/proposal.ts";
import { repoView } from "../../src/community/repo.ts";
import { verdictMarkdown } from "../../src/community/report.ts";

const { values } = parseArgs({ options: { body: { type: "string" }, offline: { type: "boolean" } } });

function output(key: string, value: string): void {
  // Only fixed words go to the step's outputs, never text from the issue.
  if (!/^[a-z]+$/.test(value)) throw new Error(`refusing output ${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

if (values.body) {
  const body = readFileSync(values.body, "utf8");
  if (!isProposalBody(body)) {
    console.log("Not a proposal: the body lacks the form's headings.");
    process.exit(0);
  }
  const { verdict } = await checkIssueBody(body, { repo: repoView(), offline: values.offline });
  console.log(verdictMarkdown(verdict));
  console.log(`\nlabels: ${verdict.labels.join(", ")}\nroute: ${verdict.route}`);
  process.exit(verdict.ok ? 0 : 1);
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as { issue: { number: number; body: string | null; state: string; pull_request?: unknown; labels: { name: string }[] }; repository: { full_name: string } };
const issue = event.issue;
if (issue.pull_request || issue.state !== "open" || !isProposalBody(issue.body)) {
  output("route", "none");
  process.exit(0);
}
const repo = event.repository.full_name;
const { verdict } = await checkIssueBody(issue.body ?? "", { repo: repoView() });
const gh = gitHub(process.env.GITHUB_TOKEN ?? "", process.env.GITHUB_API_URL);
await setLabels(gh, repo, issue.number, issue.labels.map((l) => l.name), verdict.labels);
await upsertComment(gh, repo, issue.number, "<!-- borgo-proposal-check -->", verdictMarkdown(verdict, { forGitHub: true }));
output("route", verdict.ok ? verdict.route : "none");
console.log(`#${issue.number}: ${verdict.ok ? "valid" : "needs changes"}, route ${verdict.route}${verdict.locked ? ", locked" : ""}`);
