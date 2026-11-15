// Rents in Tokyo from the Statistics Bureau of Japan's 2023 Housing and Land Survey (住宅・土地統計調査, October
// 2023), e-Stat database table 0004021532: the average monthly rent of privately rented homes (民営借家, used only for
// living) in the 23 special wards (特別区部), by floor area, leaving out homes let for nothing. A one-bedroom home is
// the 30-49 m² band and a three-bedroom home the 70-99 m² band. Every tenancy, however long ago it began.
// e-Stat's terms (Government of Japan Standard Terms of Use 2.0) are compatible with CC BY 4.0.
// The table is read through e-Stat's own table viewer, which answers a form naming the rows and columns wanted.
import { gzipSync } from "node:zlib";
import { isMain, readJson, today, UA, writeJson, type ObservationFile } from "../lib.ts";
import type { City, Observation } from "../../src/core/types.ts";

export const SID = "0004021532";
export const VIEWER = `https://www.e-stat.go.jp/dbview?sid=${SID}`;
const API = `https://www.e-stat.go.jp/dbview/api_get_result?sid=${SID}`;
/** The floor-area bands asked for, in the order the reply lists them. */
export const BANDS = { rent_1bed: { code: "2", label: "30-49 m²" }, rent_3bed: { code: "4", label: "70-99 m²" } } as const;
export const WARDS = "13100";

const dim = (matterId: number, tableName: string, part: string, positionNum: number, codes: string[]) => ({
  matterId,
  tableName,
  dispTableName: `S4AQ2_${SID}_${part}`,
  positionNum,
  listData: codes.map((code) => ({ name: "", code, unit: "", explanation: "" })),
  allSelected: 0,
});
const enc = (o: unknown) => gzipSync(Buffer.from(JSON.stringify(o))).toString("base64");

/** The viewer's form: every building type, the two floor-area bands, the special wards, rents above zero. */
export function form(): URLSearchParams {
  const tops = [dim(18, "MH_HS4AQ2_0000000001", "HS", 1, ["41-2023"]), dim(2, "MH_TMY4AQ2_0000080001", "TIME", 2, ["2023000000"])];
  return new URLSearchParams({
    rows: enc([dim(3, "MH_BU4AQ2_0001212978", "BUN01", 2, ["0"]), dim(4, "MH_BU4AQ2_0001212926", "BUN02", 3, [BANDS.rent_1bed.code, BANDS.rent_3bed.code]), dim(1, "MH_AR4AQ2_0001100981", "AREA", 1, [WARDS])]),
    cols: enc([dim(5, "MH_BU4AQ2_0001212980", "BUN03", 1, ["2"])]),
    tops: enc(tops),
    apiTops: enc(tops),
    annotationFlg: "1",
    rowNoDataDispFlg: "0",
    colNoDataDispFlg: "0",
    commaType: "0",
    replaceSpChars: "0",
    inputNumberOfCols: "100",
    inputNumberOfRows: "100",
    movementId: "0",
    leftMoveFlg: "0",
    rightMoveFlg: "0",
    underMoveFlg: "0",
    upMoveFlg: "0",
    mode: "table",
  });
}

/** The two rents, yen a month, from the viewer's reply (its table holds one cell per band, in band order). */
export function estatRents(reply: { table: string; requestData?: { rowItemList1?: string; rowItemList3?: string } }): { rent_1bed: number; rent_3bed: number } {
  if (reply.requestData && (reply.requestData.rowItemList3 !== WARDS || reply.requestData.rowItemList1 !== `${BANDS.rent_1bed.code},${BANDS.rent_3bed.code}`)) throw new Error("e-Stat answered for other rows than asked");
  const cells = [...reply.table.matchAll(/<td[^>]*class="stat-dbview-value"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => Number(m[1]!.replace(/[^\d.]/g, "")));
  if (cells.length !== 2 || cells.some((v) => !(v > 0))) throw new Error(`e-Stat ${SID}: expected two rents, got ${cells.join(", ")}`);
  return { rent_1bed: cells[0]!, rent_3bed: cells[1]! };
}

export function estatObservations(reply: Parameters<typeof estatRents>[0], cities: City[], retrieved: string): ObservationFile {
  const out: ObservationFile = { source: "jp-estat-housing", retrieved, observations: {} };
  if (!cities.some((c) => c.id === "tokyo-jp")) return out;
  const r = estatRents(reply);
  out.observations["tokyo-jp"] = (["rent_1bed", "rent_3bed"] as const).map(
    (metric): Observation => ({
      metric,
      value: r[metric],
      period: "2023-10",
      level: "city",
      source: "jp-estat-housing",
      retrieved,
      note: `Tokyo's 23 special wards, average monthly rent of privately rented homes of ${BANDS[metric].label} (used only for living, homes let for nothing left out), 2023 Housing and Land Survey, e-Stat table ${SID}: every tenancy, however long ago it began`,
    }),
  );
  return out;
}

if (isMain(import.meta.url)) {
  const res = await fetch(API, { method: "POST", body: form(), headers: { "user-agent": UA, "x-requested-with": "XMLHttpRequest", referer: VIEWER } });
  if (!res.ok) throw new Error(`e-Stat ${SID}: ${res.status}`);
  const out = estatObservations((await res.json()) as Parameters<typeof estatRents>[0], await readJson<City[]>("data/cities.json"), today());
  for (const [id, l] of Object.entries(out.observations)) console.log(id, l.map((o) => `${o.metric}=${o.value} (${o.period})`).join(" "));
  await writeJson("data/observations/jp-rent.json", out);
}
