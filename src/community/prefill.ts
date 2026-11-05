// The "Suggest a correction" link under a figure's sources: the issue form, filled in with what the figure is, so a
// person only types the new value and the official source. Pure, for the app's bundle.
import { unitFor } from "../core/metrics.ts";
import type { City, Metric, Observation } from "../core/types.ts";
import { issueUrl, proposalTitle, type Fields } from "./proposal.ts";

const show = (v: Observation["value"]) => (Array.isArray(v) ? v.map((x) => Math.round(x * 10) / 10).join(" ") : String(v));

export function correctionFields(city: City, m: Metric, o: Observation, currency: string): Fields {
  return {
    kind: "correction",
    city: city.id,
    metric: m.id,
    source: o.source,
    current: `${show(o.value)} (${o.period}, ${o.level})`.slice(0, 1500),
    unit: unitFor(m, currency),
    period: o.period,
    level: o.level,
  };
}

export function correctionUrl(city: City, m: Metric, o: Observation, currency: string): string {
  return issueUrl(correctionFields(city, m, o, currency), proposalTitle({ kind: "correction", target: { city: city.id, metric: m.id } }, { metric: m.label, city: city.name }));
}
