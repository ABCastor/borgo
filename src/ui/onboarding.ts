import { html, type Raw } from "./dom.ts";

export const SETUP_STEPS = [
  { title: "Cities", text: "Add two places to compare, or any city in the world.", target: "add-city" },
  { title: "What matters", text: "Set relative importance. Percentages are shares of your score, not money. Open a group to tune its lines.", target: "wg-money" },
  { title: "Money", text: "Add gross yearly pay, currency and spending. Leave unknowns blank; pay and rent can differ by city.", target: "verdict-salary" },
  { title: "People and right to live", text: "Add everyone moving, their passports and existing residence or work rights.", target: "e0-pass" },
  { title: "Nice days", text: "Choose your temperature range and weather tests. Every enabled test must pass on the same day.", target: "wg-climate" },
];

export const AI_PROMPT = `Help me find cities with Borgo: https://borgo.abcastor.com/mcp (remote HTTP MCP). Confirm my priorities, kind of work, pay, spending, household, passports/rights, requirements and nice-day weather before using them. Only include facts I confirmed; leave unknowns blank. Use suggest_cities and compare_cities; explain sources and gaps. Remote MCP only has published cities; Never call fetch_city on the remote server; use the local MCP: npx -y @abcastor/borgo mcp. MCP does not change my browser comparison. Give me settings to enter there.`;

import { OPENAI_MARK, CLAUDE_MARK } from "./assistant-marks.ts";

export function aiSetup(): Raw {
  return html`<section class="ai-setup" aria-label="Use your AI assistant"><h2>Use your AI assistant</h2><p>Connect Borgo in your assistant\'s MCP settings, then use this prompt.</p><p id="ai-prompt" class="assistant-prompt" aria-label="AI prompt">${AI_PROMPT}</p><div class="setup-controls"><a class="pill-btn" href="${`https://chatgpt.com/?q=${encodeURIComponent(AI_PROMPT)}`}" target="_blank" rel="noopener noreferrer">${OPENAI_MARK}Open in ChatGPT</a><a class="pill-btn" href="${`https://claude.ai/new?q=${encodeURIComponent(AI_PROMPT)}`}" target="_blank" rel="noopener noreferrer">${CLAUDE_MARK}Open in Claude</a><button class="pill-btn" data-act="copy-ai">Copy prompt</button><button class="pill-btn" data-act="copy-mcp">Copy MCP URL</button></div><span id="ai-copy-status" role="status"></span><p class="connection-row"><span>Remote MCP</span><code>https://borgo.abcastor.com/mcp</code></p><p class="connection-row"><span>Local install</span><code>npx -y @abcastor/borgo mcp</code></p><details><summary>Connection details</summary><p>No account or API key; choose HTTP / Streamable HTTP. Opening a chat does not install the connector. Anything you send follows your assistant\'s privacy policy; MCP does not update this browser.</p></details></section>`;
}
