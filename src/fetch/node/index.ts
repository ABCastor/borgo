// Every fetcher the CLI and MCP server run: the browser's, plus the sources a browser cannot read.
import { cams } from "../air.ts";
import type { Fetcher } from "../context.ts";
import { oecd, wgi, worldBank } from "../country.ts";
import { eurostatUrban } from "../eurostat-urban.ts";
import { labourLaw, nagerHolidays, oecdChildcare } from "../family.ts";
import { github } from "../github.ts";
import { openMeteo } from "../open-meteo.ts";
import { politics } from "../politics.ts";
import { csoRent } from "../rent.ts";
import { openAlex } from "../research.ts";
import { abortionLaw, couplesLaw } from "../rights-law.ts";
import { wmoSunshine } from "../sunshine.ts";
import { ghsl } from "./ghsl.ts";
import { meteostat } from "./meteostat.ts";
import { oecdFamily } from "./oecd-family.ts";
import { onsRent } from "./ons-rent.ts";
import { osmWalkCycle } from "./osm-walk-cycle.ts";
import { whoAir } from "./who-air.ts";

// Display order; fallbacks (Meteostat for the WMO normals, CAMS for WHO) run after their primaries whatever the order.
export const NODE_FETCHERS: Fetcher[] = [openMeteo, wmoSunshine, meteostat, whoAir, cams, worldBank, wgi, oecd, openAlex, csoRent, onsRent, oecdChildcare, oecdFamily, nagerHolidays, labourLaw, politics, abortionLaw, couplesLaw, eurostatUrban, github, osmWalkCycle, ghsl];
