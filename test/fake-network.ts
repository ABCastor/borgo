// A recorded network for fetch tests: each request is answered by the first route whose pattern matches its URL,
// and every URL asked for is kept so tests can check provenance. Unknown URLs fail like a 404.
import { makeCtx, type FetchCtx } from "../src/fetch/context.ts";
import type { Runtime } from "../src/registry/schema.ts";

export type Route = [RegExp, (url: string) => unknown | Response];

export function fakeFetch(routes: Route[]): { fetch: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const route = routes.find(([re]) => re.test(url));
    if (!route) return new Response("not found", { status: 404, statusText: "Not Found" });
    const body = route[1](url);
    if (body instanceof Response) return body;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, asked };
}

export const NOW = new Date("2026-10-27T10:00:00Z");

export function fakeCtx(routes: Route[], runtime: Runtime = "node"): { ctx: FetchCtx; asked: string[] } {
  const { fetch, asked } = fakeFetch(routes);
  return { ctx: makeCtx({ runtime, fetch, now: () => NOW, backoff: 0 }), asked };
}

/** Five years (2021-2025) of hourly weather with a simple seasonal shape: warm in July, cold in January. */
export function archiveResponse(): unknown {
  const days: string[] = [];
  for (let d = Date.UTC(2021, 0, 1); d <= Date.UTC(2025, 11, 31); d += 86_400_000) days.push(new Date(d).toISOString().slice(0, 10));
  const season = (t: string) => -Math.cos(((Number(t.slice(5, 7)) - 1) / 12) * 2 * Math.PI); // -1 in January, +1 in July
  const hourly = days.flatMap((d) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, "0")}:00`));
  const air = (t: string) => 18 + 8 * season(t) + 4 * Math.sin(((Number(t.slice(11, 13)) - 9) / 24) * 2 * Math.PI);
  return {
    elevation: 14,
    hourly: {
      time: hourly,
      temperature_2m: hourly.map(air),
      apparent_temperature: hourly.map((t) => air(t) + 1 + 2 * season(t)),
      dew_point_2m: hourly.map((t) => 10 + 6 * season(t)),
      precipitation: hourly.map((t) => (Number(t.slice(8, 10)) % 4 === 0 && t.slice(11, 13) === "14" ? 3 : 0)),
      snowfall: hourly.map(() => 0),
      cloud_cover: hourly.map((t) => 40 - 30 * season(t)),
      wind_speed_10m: hourly.map(() => 12),
    },
  };
}

/** The WMO normals CSV: a station 24 km from Palermo, one 68 km away on an island, and one far away. */
export const WMO_CSV = [
  "Elem,Rgn,ID,      WIGOS_ID        ,Latitude,Longitude,Elevation,   Country,                 Station                        , Jan  , Feb   , Mar   , Apr   , May   , Jun   , Jul   , Aug   , Sep   , Oct   , Nov   , Dec   , Annual",
  "008,6,00016405,0-20000-0-16405     ,  38.180,  13.100,   21.0,Italy                         ,Palermo_Punta_Raisi           ,   140.0,   160.0,   205.0,   230.0,   290.0,   310.0,   350.0,   320.0,   240.0,   200.0,   150.0,   130.0,  2725.0",
  "008,6,00016400,0-20000-0-16400     ,  38.708,  13.177,  242.0,Italy                         ,Ustica                        ,   134.0,   154.0,   201.0,   223.0,   283.0,   301.0,   342.0,   317.0,   237.0,   199.0,   145.0,   128.0,  2664.0",
  "008,6,00003772,0-20000-0-03772     ,  51.478,  -0.461,   25.0,United_Kingdom                ,Heathrow                      ,    62.0,    80.0,   118.0,   167.0,   201.0,   199.0,   211.0,   196.0,   148.0,   111.0,    72.0,    58.0,  1623.0",
].join("\n");

export const PALERMO_GEO = {
  results: [
    { id: 2523920, name: "Palermo", latitude: 38.1166, longitude: 13.3636, elevation: 14, feature_code: "PPLA", country_code: "IT", admin1_id: 2523119, admin1: "Sicily", timezone: "Europe/Rome", population: 648260 },
    { id: 3430234, name: "Palermo", latitude: -34.58856, longitude: -58.43053, elevation: 14, feature_code: "PPLX", country_code: "AR", admin1_id: 3433955, admin1: "Buenos Aires F.D.", timezone: "America/Argentina/Buenos_Aires", population: 249016 },
  ],
};

/** OECD net childcare cost rows for Italy: the couple and single-parent cases, fees and net cost, two years. */
export const NCC_CSV = [
  "REF_AREA,HOUSEHOLD_TYPE,INCOME_PART,CHILDCARE_COST,TIME_PERIOD,OBS_VALUE",
  ...["2025", "2026"].flatMap((y) => [
    `ITA,C_C1,AW67,CF,${y},5919`,
    `ITA,C_C2,AW67,CF,${y},11838`,
    `ITA,C_C1,AW67,_T,${y},${y === "2026" ? 1200 : 1500}`,
    `ITA,C_C2,AW67,_T,${y},2000`,
    `ITA,S_C1,_Z,_T,${y},600`,
    `ITA,S_C2,_Z,_T,${y},`,
    `ITA,C_C1,AW100,_T,${y},99999`,
  ]),
].join("\n");

/** Nager.Date for Italy in 2026: a weekend holiday and a regional one elsewhere are not counted. */
export const NAGER_IT = [
  { date: "2026-01-01", global: true, counties: null, types: ["Public"] },
  { date: "2026-01-06", global: true, counties: null, types: ["Public"] },
  { date: "2026-04-05", global: true, counties: null, types: ["Public"] },
  { date: "2026-04-06", global: true, counties: null, types: ["Public"] },
  { date: "2026-06-24", global: false, counties: ["IT-25"], types: ["Public"] },
  { date: "2026-07-15", global: false, counties: ["IT-82"], types: ["Public"] },
  { date: "2026-12-25", global: true, counties: null, types: ["Public"] },
  { date: "2026-12-08", global: true, counties: null, types: ["Observance"] },
];

export function worldBankResponse(url: string): unknown {
  const code = /indicator\/([A-Z0-9.]+)/.exec(url)![1]!;
  const value: Record<string, number> = { "PA.NUS.PRVT.PP": 0.6, "PA.NUS.FCRF": 0.9, "VC.IHR.PSRC.P5": 0.57, "SP.DYN.LE00.IN": 83.7, "SH.XPD.OOPC.PC.CD": 1_100 };
  return [{ page: 1 }, [{ date: "2024", value: value[code] }, { date: "2023", value: value[code]! * 0.98 }]];
}

/** Every source answering for Palermo, except those named in `fail`. */
export function palermoRoutes(fail: string[] = []): Route[] {
  const down = (host: string) => (fail.includes(host) ? () => new Response("down", { status: 503, statusText: "Service Unavailable" }) : null);
  const r = (re: RegExp, host: string, body: (url: string) => unknown): Route => [re, (u) => down(host)?.() ?? body(u)];
  return [
    r(/geocoding-api\.open-meteo\.com\/v1\/search/, "geocoding", () => PALERMO_GEO),
    r(/query\.wikidata\.org/, "wikidata", () => ({ results: { bindings: [{ iso: { value: "IT-82" } }] } })),
    r(/archive-api\.open-meteo\.com/, "archive", () => archiveResponse()),
    r(/air-quality-api\.open-meteo\.com/, "cams", () => ({ hourly: { time: Array.from({ length: 8760 }, (_, i) => String(i)), pm2_5: Array.from({ length: 8760 }, () => 11) } })),
    r(/wmo_normals_9120_TSUN\.csv/, "wmo", () => WMO_CSV),
    r(/api\.worldbank\.org/, "worldbank", worldBankResponse),
    r(/sdmx\.oecd\.org.*DF_NCC/, "oecd", () => NCC_CSV),
    r(/sdmx\.oecd\.org/, "oecd", () => "REF_AREA,TIME_PERIOD,OBS_VALUE\nITA,2023,7.0\nITA,2025,7.1\n"),
    r(/date\.nager\.at/, "nager", () => NAGER_IT),
    r(/api\.openalex\.org/, "openalex", () => ({ meta: { count: 2 }, results: [{ counts_by_year: [2025, 2024, 2023].map((year) => ({ year, works_count: 3000 })) }, { counts_by_year: [2025, 2024, 2023].map((year) => ({ year, works_count: 4000 })) }] })),
  ];
}
