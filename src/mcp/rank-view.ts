// Browser-only renderer, embedded in the existing network-free MCP App document.
// All untrusted result text goes through esc; numeric SVG attributes are checked as finite.
export const RANK_VIEW = `
const number = (n) => typeof n === "number" && Number.isFinite(n) ? n : 0;
const formatValue = (n) => number(n).toLocaleString("en-GB", {maximumFractionDigits: Math.abs(number(n)) >= 100 ? 0 : 1});
const sourceLabel = (r) => [...new Set(r.sources.map((s) => s.label.split(":")[0] + ", " + (s.year ?? "period not recorded") + (s.level && !["city", "metro"].includes(s.level) ? ", " + s.level + " level" : "")))].join("; ");
function renderRanking(r) {
  const rows = r.rows;
  const unit = rows[0]?.unit ?? "";
  const cite = (row) => '<small class="quiet source">' + esc(sourceLabel(row)) + '</small>';
  const max = Math.max(1, ...rows.map((x) => Math.abs(number(x.value))));
  let visual = "";
  if (r.view === "world") {
    const dots = rows.map((row) => {
      const x = 360 + number(row.point?.[0]) * 125, y = 180 - number(row.point?.[1]) * 125;
      return '<circle class="city-dot" cx="' + x + '" cy="' + y + '" r="5" fill="var(--rank-accent)" stroke="var(--color-text-primary)"><title>' + esc(row.name + ": " + formatValue(row.value) + " " + row.unit + ". " + sourceLabel(row)) + '</title></circle>';
    }).join("");
    visual = '<svg class="world-view" role="img" aria-label="Known matching cities on the Equal Earth world map" viewBox="0 0 720 360"><path fill="var(--color-border-primary)" d="' + borgoLand + '"/>' + dots + '</svg><p class="quiet">Equal Earth projection. Dots mark the returned cities, not full worldwide coverage. Land: Natural Earth, public domain; Borgo map grid.</p>';
  } else if (r.view === "months") {
    const labels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const weatherMax = Math.max(1, ...rows.flatMap((x) => x.months ?? []).map((x) => Math.abs(number(x))));
    visual = '<div class="month-view"><table><thead><tr><th>City / source</th>' + labels.map((m) => '<th class="n">' + m + '</th>').join("") + '</tr></thead><tbody>' + rows.map((row) => '<tr><th>' + esc(row.name) + cite(row) + '</th>' + (row.months?.length === 12 ? row.months.map((n, i) => '<td class="n month-cell" style="background:color-mix(in srgb,var(--rank-accent) ' + Math.round(Math.abs(number(n)) / weatherMax * 55) + '%,transparent)" title="' + esc(labels[i] + ": " + formatValue(n)) + '">' + formatValue(n) + '</td>').join("") : '<td colspan="12">Monthly figures unavailable</td>') + '</tr>').join("") + '</tbody></table></div>';
  } else {
    visual = '<div class="ranked-view">' + rows.map((row) => '<div class="bar-row"><div><b>' + row.rank + '. ' + esc(row.name) + '</b><span class="value">' + formatValue(row.value) + ' ' + esc(row.unit) + '</span></div><div class="bar-track"><div class="rank-bar" style="width:' + Math.abs(number(row.value)) / max * 100 + '%"></div></div>' + cite(row) + '</div>').join("") + '<p class="quiet">Bar length shows magnitude; signed values remain labelled.</p></div>';
  }
  const coverage = r.coverage;
  app.innerHTML = '<h2>' + esc(r.label) + '</h2>' +
    '<p class="quiet">' + coverage.matched + ' match from ' + coverage.candidates + ' candidates (' + coverage.known + ' known cities). ' + coverage.missing + ' lack the ranking figure; ' + coverage.filterUnknown + ' cannot pass an unknown filter. Showing ' + coverage.returned + '.</p>' +
    (rows.length ? visual : '<p>No known cities have the requested figure and pass these filters.</p>') +
    '<table class="rank-table"><thead><tr><th>#</th><th>City</th><th class="n">Value</th><th>Unit</th><th>Source and year</th></tr></thead><tbody>' + rows.map((row) => '<tr><td>' + row.rank + '</td><td>' + esc(row.name) + '</td><td class="n">' + formatValue(row.value) + '</td><td>' + esc(row.unit) + '</td><td>' + esc(sourceLabel(row)) + '</td></tr>').join("") + '</tbody></table>' +
    '<details><summary>Sources and calculations</summary><ul>' + [...new Map(rows.flatMap((row) => row.sources).map((s) => [s.id + ":" + s.year, s])).values()].map((s) => '<li>' + (/^https?:\\/\\//.test(s.url) ? '<a href="' + esc(s.url) + '" target="_blank" rel="noreferrer">' + esc(s.label) + '</a>' : esc(s.label)) + ' [' + esc(s.id) + '], ' + esc(s.year ?? 'period not recorded') + '</li>').join('') + '</ul></details>' +
    '<ul>' + [...(r.notes ?? []), ...rows.flatMap((row) => (row.notes ?? []).map((n) => row.name + ": " + n))].map((n) => '<li>' + esc(n) + '</li>').join("") + '</ul>' +
    (/^https:\\/\\/borgo\\.abcastor\\.com\\//.test(r.link) ? '<p><a href="' + esc(r.link) + '" target="_blank" rel="noreferrer">Open these cities in Borgo</a></p>' : '');
}
`;
