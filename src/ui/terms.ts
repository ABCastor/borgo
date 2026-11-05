import { html, type Raw } from "./dom.ts";

// Every term the interface uses, defined once in plain words. A dotted underline marks a defined term;
// pointing at it, focusing it or tapping it shows the definition (main.ts owns the one floating tip).

export const TERMS: Record<string, string> = {
  air: "Air temperature: what a thermometer reads in the shade, 2 m above the ground.",
  feels: "Feels like: the air temperature corrected for humidity, wind and sun, as a person would feel it (the apparent temperature Open-Meteo computes from ERA5).",
  comfortable:
    "Nice day: a day that is dry (under 1 mm of rain from 8 am to 8 pm), mostly clear (half the sky or less clouded on average) and whose daytime temperature, feels-like or air as you choose, sits in your range. Nice days are yours to define: the range starts at 18 to 30 °C feels-like, and you change it at the head of Climate in What matters or on any nice-days line.",
  sunshine:
    "Sunshine: hours when the sun is strong enough to cast a sharp shadow (direct sunlight above 120 W/m², the World Meteorological Organization's definition), measured by a sunshine recorder at a weather station.",
  daylight: "Daylight: time from sunrise to sunset, worked out from the city's latitude. Cloudy or clear, it counts.",
  cloud: "Cloud cover: the share of the sky hidden by cloud, averaged over every hour of the month, day and night (ERA5 reanalysis).",
  wet: "Wet day: a day with at least 1 mm of rain (or snow, counted as water).",
  era5: "ERA5: a reconstruction of past weather, every hour, made by the European Centre for Medium-Range Weather Forecasts from millions of observations. Here: the five full years 2021 to 2025 at the city's coordinates.",
  score: "Score out of 100: each line's result from 0 to 1, multiplied by your share for that line, added up.",
  share: "Share: how much of the 100-point score a line controls. Shares always add up to 100%; move one and the others make room.",
  real: "Real data: the part of the score that rests on figures for this city, among the lines that count for your cities. A line with no figure here scores as the lowest of your other cities on it, so a gap can cost a city a place but never win it one.",
  kept: "Kept: take-home pay minus rent, everyday spending, childcare and health, each month. \"At most\" marks a figure that leaves out a cost that is due (a premium, childcare with no figure): add it and the figure is whole.",
  net: "Take-home pay: everyone's salary after income tax, employee social contributions and what goes into a pension.",
  everyday: "Everyday spending: what you spend in a month on everything except housing, childcare and health, scaled from where you live now by each country's price level (World Bank).",
  pension: "Pension: the share of gross pay you put into a pension, the same share in every city. It leaves take-home pay but stays yours. Each country's plan (a 401(k), a pillar 3a, a fondo pensione) and its tax relief are modelled where the money sheet names them; elsewhere the share is counted as saving, with no relief.",
  breakeven: "Break-even pay: the gross salary you would need in this city to keep the same each month as where you live now, after its tax, rent, spending, childcare and health. Found by trying salaries until the two match.",
  childcare: "Childcare: full-time care for children under 6, after childcare benefits and tax breaks, from the OECD's tax-benefit model for a two-earner couple or a single parent. A country figure, priced in one reference place.",
  health: "Health: what people pay for care themselves (deductibles, co-payments, care not covered), the country's average per person (WHO via the World Bank). Insurance bought outside pay (US, Swiss, Dutch) is yours to add.",
  leave: "Paid days off: the paid holiday the law guarantees a full-time employee, plus public holidays that fall on a weekday this year. Contracts often give more.",
  joint: "Joint filing: a married couple taxed together. Used where the law requires it, or where the couple may choose it and it costs less.",
  regime: "Newcomer regime: a tax arrangement for people moving into a country. Counted only when you switch it on: as established when your answers meet every condition, as a scenario while some are yours to confirm.",
  hourly: "Every hour of the year: the average air temperature at each hour of the local day (down) through the year (across), in your own bands, from ERA5 2021 to 2025.",
  wins: "Where it wins and loses: the lines where this city earns more (or fewer) points than the average of your other cities, in points of the 100-point score.",
  ruler: "The points ruler: one segment per value, as wide as your share of it, filled as far as this city scores on it. The filled length adds up to the score.",
  mustpass: "Must pass: a line that rules a city out when it fails, whatever the rest of its score.",
  record: "Lowest and highest: the coldest and hottest air temperature reached in that month over the five years shown; older records can be more extreme.",
  typical: "One day in ten beyond: one night in ten is colder than the bottom of the pale bar, one afternoon in ten hotter than its top (the 10th percentile of daily lows and the 90th of daily highs).",
};

export function term(key: string, label: string | Raw): Raw {
  return html`<button type="button" class="term" data-term="${key}">${label}</button>`;
}
