import { html, type Raw } from "./dom.ts";

export const SETUP_STEPS = [
  { title: "Cities", text: "Add the places you are considering. Start with two, or any city in the world, then return here for the next step.", target: "add-city" },
  { title: "What matters", text: "Set how much each priority counts compared with the others. Percentages are shares of your score, not savings rates. Open a group to split its share.", target: "wg-money" },
  { title: "Money", text: "Add your gross yearly salary, currency and spending. Leave unknowns blank. You can give different pay and your own rent for each city.", target: "verdict-salary" },
  { title: "People and right to live", text: "Add everyone moving, including a partner, their passports and any residence or work rights they already hold. Ruling a city out is separate from scoring it.", target: "e0-pass" },
  { title: "Nice days: the weather", text: "Define your temperature range and which weather tests a day must pass. Your choices change the weather count and ranking, not just the description.", target: "wg-climate" },
];

export const AI_PROMPT = `Help me compare places to live with Borgo. Connect to https://borgo.abcastor.com/mcp (remote HTTP MCP, no account or API key).
Use what I have already told you, but confirm it with me before using it. Ask only for missing facts:
1. Which cities am I considering? Use search_cities for published cities. If a city is missing, explain that the remote server only has published cities; I can add any city in the web app, or connect the local MCP with command npx and arguments -y @abcastor/borgo mcp to use fetch_city. Never call fetch_city on the remote server.
2. What matters to me compared with the other priorities? Use list_metrics_and_sources to find criterion ids. Propose weights (0-100 relative importance, not money percentages), and explain the resulting shares of the score. Ask about my kind of work.
3. What are my gross yearly salary (same or per city), currency, housing size, monthly spending and home city? Leave unknowns out, never invent them.
4. Who is moving with me, including a partner or children? Which passports and existing residence/work rights does each person hold? Which criteria should rule a city out regardless of score (dealBreakers)?
5. What weather makes a nice day for me: temperature min/max in Celsius, air or feels-like, dry, sunny (clear), not muggy, calm wind, minimum daylight? Explain that all enabled tests must pass, not weighted averages.
Call compare_cities with the confirmed cities, weights, work, salary or salaryByCity, displayCurrency, housing, spending, household, children, dealBreakers and comfort. Only include facts I confirmed. Cite sources, explain missing figures, why wind or another weather test changes the result, and compare a work-heavy with a weather-heavy scenario. Do not claim this updates my browser: MCP comparisons are separate. Give me the confirmed settings to enter in Borgo.`;

export function aiSetup(): Raw {
  return html`<details class="ai-setup"><summary>Ask your AI to help</summary><p>Your assistant may already know what matters to you. In an assistant that supports remote MCP, open its connectors or MCP settings, add <strong>Borgo</strong>, and use this server URL:</p><code>https://borgo.abcastor.com/mcp</code><p>Choose HTTP / Streamable HTTP if asked. No account or API key is needed. If your assistant cannot add remote MCP servers, use a compatible client instead. Review its privacy policy before sharing personal information.</p><label for="ai-prompt">Copy these questions into your connected assistant</label><textarea id="ai-prompt" readonly rows="7">${AI_PROMPT}</textarea><button class="pill-btn" data-act="copy-ai">Copy prompt</button><span id="ai-copy-status" role="status"></span><p class="hint">MCP does not change this browser's comparison. Enter your agreed settings here. Anything you send your assistant follows that assistant's privacy policy.</p></details>`;
}
