import { ENGINE_VERSION } from "../core/engine.ts";
import { CRITERIA } from "../core/criteria.ts";
import { resolve } from "../core/lookup.ts";
import { html, raw, type Raw } from "./dom.ts";
import footer from "./castor/footer.html";
import { local, num } from "./format.ts";
import type { AppState } from "./state.ts";
import { manifestOf, PARTS } from "../registry/licences.ts";

export function dataPage(s: AppState): Raw {
  const metrics = Object.values(s.data.metrics);
  // The figures' sources, plus the two the world map draws on (its land, towns and monthly highs).
  const used = new Set([...Object.values(s.data.observations).flat().map((o) => o.source), "natural-earth", "nasa-power"]);
  const sources = Object.values(s.data.sources).filter((x) => used.has(x.id));
  const cities = s.data.cities.slice().sort((a, b) => a.name.localeCompare(b.name));
  const manifest = manifestOf(s.data)?.sources ?? [];
  return html`<div class="sheet doc">
    <h1>Where the numbers come from</h1>
    <p class="lede">Every figure carries its source, the period it describes, whether it describes the city or only its country, and its licence. We store only data we are allowed to share; closed sources are linked from each city, never copied.</p>

    <h2>Sources</h2>
    <table class="doc-table"><thead><tr><th>Source</th><th>Publisher</th><th>Licence</th></tr></thead><tbody>
      ${sources.map((x) => html`<tr><td><a href="${x.url}" target="_blank" rel="noopener">${x.name}</a></td><td>${x.publisher}</td><td>${x.licenceUrl ? html`<a href="${x.licenceUrl}" target="_blank" rel="noopener">${x.licence}</a>` : x.licence}</td></tr>`)}
    </tbody></table>
    <p class="hint">Exchange rates: ${s.data.fx.date}, European Central Bank. Dataset ${s.data.version}, built ${s.data.builtAt.slice(0, 10)}. Engine and tax models ${ENGINE_VERSION}. The command line and the MCP server name the same four in every answer: with the same profile and figures, the same four give the same ranking.</p>

    <h2>Licences and attribution</h2>
    <p>The figures are published in files that each carry one set of terms:</p>
    <ul class="plain">${Object.values(PARTS)
      .filter((p) => p.id === "open" || manifest.some((m) => m.part === p.id && m.observations > 0))
      .map((p) => html`<li><a href="${p.file}" target="_blank" rel="noopener">${p.file}</a>: <a href="${p.licence.url}" target="_blank" rel="noopener license">${p.licence.name}</a>. ${p.notice}</li>`)}</ul>
    <p>Each source's required credit, as its terms ask for wherever its figures are shown. The edition read and the terms page for each are in <a href="data/licences.json" target="_blank" rel="noopener">data/licences.json</a>.</p>
    <ul class="plain credits">${manifest.map((m) => html`<li>${m.attribution}${m.notices.length ? html` ${m.notices.join(" ")}` : ""} <small>(<a href="${m.licenceUrl}" target="_blank" rel="noopener license">${m.licence}</a>)</small></li>`)}</ul>

    <h2>Coverage</h2>
    <p class="hint">A filled dot is a figure for the city itself; a ring is a country figure standing in for it; empty means no open data yet.</p>
    <div class="cov-wrap"><table class="cov-table"><thead><tr><th>City</th>${metrics.map((m) => html`<th><span>${m.label}</span></th>`)}</tr></thead><tbody>
      ${cities.map(
        (c) => html`<tr><th scope="row">${c.name}</th>${metrics.map((m) => {
          const r = resolve(s.data, null, c, m.id);
          return html`<td>${r ? (r.level === "country" ? html`<i class="dot ring" title="country figure"></i>` : html`<i class="dot" title="${r.level}"></i>`) : ""}</td>`;
        })}</tr>`,
      )}
    </tbody></table></div>

    <h2>How the score works</h2>
    <p>Each line turns a figure into a score from 0 to 1 against a fixed worst and best (or, if you choose, against the best and worst of your own cities). Your weight decides how many of the 100 points each line can give. Where a city has no data on a line, it gets the average score of your other cities on that line, so missing data neither helps nor hurts; the ranking shows how much of each score comes from real data. A line marked "must pass" rules a city out when it fails.</p>
    <table class="doc-table"><thead><tr><th>Line</th><th>Worst</th><th>Best</th><th>Question</th></tr></thead><tbody>
      ${CRITERIA.map((c) => {
        const [w, b] = c.scale(s.profile, s.data);
        return html`<tr><td>${c.label}</td><td class="num">${num(w, w % 1 ? 1 : 0)}</td><td class="num">${num(b, b % 1 ? 1 : 0)}</td><td>${local(c.question)}</td></tr>`;
      })}
    </tbody></table>

    <h2>Add to it</h2>
    <p>A city is one line in a file, a source is one script, a scoring line is one entry, a country's tax is one module. The repository explains each step; every addition has to say where its numbers come from and under what licence.</p>
  </div>`;
}

/** Where the project lives in public: issues and discussions are the only way to reach it. */
export const REPO = "https://github.com/ABCastor/borgo";

export function aboutPage(s: AppState): Raw {
  const countries = new Set(s.data.cities.map((c) => c.country)).size;
  return html`<div class="sheet doc">
    <h1>About</h1>
    <p class="lede">Borgo, Italian for a village: an open comparison of the places you might live, weighted by what you value, with every number traceable to its source.</p>
    <h2>What it does</h2>
    <p>You pick the cities you are weighing and say how much each thing matters to you. It ranks them for you, and says in words where each one wins and loses: climate day by day, air, safety, health, research, and whether everyone in your household can move there without a visa.</p>
    <h2>What you would earn, pay and keep</h2>
    <p>Money is worked out for your household, not an average person. Each earner's salary, the same everywhere or different in each city, goes through that country's income tax and payroll contributions, line by line, with your age, your children and your pension where the law uses them, and a married couple filed jointly where that is how the country works. Then rent, everyday spending scaled by local prices, childcare after public support and health care come off, and what is left is what you keep. Set where you live now and every other city tells you the salary you would need there to keep the same.</p>
    <p>Paid holiday by law, public holidays and parental leave sit beside it. Where a figure is missing, it shows as missing; nothing is guessed to fill the gap.</p>
    <h2>Open data, and only open data</h2>
    <p>${s.data.cities.length} cities in ${countries} countries ship with it, and any other place can be fetched on demand. Every figure comes from a source we may share (national statistics offices, the OECD, the World Bank, Eurostat, ECMWF's climate reanalysis and others), with its period, its level (city, region or country) and its licence one tap away on the <a href="#/data">Data</a> page. Closed sources are linked from each city, never copied.</p>
    <h2>Private by design</h2>
    <p>There are no accounts, no server and no tracking. Your comparison stays in this browser's storage and the page requests only its own files. A share link shows what it carries before you copy it: the cities, the weights, the nice-day range and the settings, with your pay, the people moving and their passports, your own numbers, your own lines and your stances left out unless you tick them. It carries them after the #, which browsers never send to a server, so it reaches only whoever you give it to. Fetching a new place sends only its name or coordinates to the data providers.</p>
    <h2>For agents too</h2>
    <p>The same engine runs as a command-line tool and as an MCP server, so an AI assistant can answer "where should I live?" with the same sourced numbers you see here, salary by salary and line by line.</p>
    <h2>Licences</h2>
    <p>Code under the Apache License 2.0. Our compiled data under CC BY 4.0, with each source's own licence and attribution kept beside its figures. Fonts under the SIL Open Font License. The source is on <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>; to say something, see <a href="#/contact">Contact</a>.</p>
    ${raw(footer)}
  </div>`;
}

export function contactPage(): Raw {
  const ways = [
    { href: `${REPO}/issues/new?template=proposal.yml`, title: "Correct a figure, a rule or a source", text: "Give the new value and the official text it comes from: the statute, the gazette or the official table. Suggest a correction, under any figure's sources, fills in the rest." },
    { href: `${REPO}/issues/new`, title: "Report a bug", text: "What you did, what you expected and what happened. A wrong tax line is a bug too: give the gross, the country and the line." },
    { href: `${REPO}/issues/new`, title: "Ask for a city, a source or a country's tax", text: "Say which, and point to an open source for it if you know one. Only data we may share can be added." },
    { href: `${REPO}/discussions`, title: "Ask a question or share an idea", text: "How a number is worked out, what the ranking means for you, what you would like it to do next." },
    { href: `${REPO}/security/advisories/new`, title: "Report a security problem", text: "Privately, through GitHub's security advisories, not in a public issue." },
  ];
  return html`<div class="sheet doc contact">
    <h1>Contact</h1>
    <p class="lede">Everything happens in the open, on GitHub. There is no email address and no form: an issue or a discussion reaches the people who can fix it, and helps the next person with the same question.</p>
    <ul class="ways">${ways.map((w) => html`<li><a href="${w.href}" target="_blank" rel="noopener"><b>${w.title}</b><span>${w.text}</span></a></li>`)}</ul>
    <p class="hint">You need a free GitHub account to post. Please leave out anything personal: your salary or household are not needed to report a figure.</p>
  </div>`;
}
