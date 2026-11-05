import type { Iso2 } from "../core/types.ts";
import { unitedArabEmirates } from "./ae.ts";
import { australia } from "./au.ts";
import { belgium } from "./be.ts";
import { canada } from "./ca.ts";
import type { TaxModel } from "./common.ts";
import { austria } from "./at.ts";
import { switzerland } from "./ch.ts";
import { czechia } from "./cz.ts";
import { germany } from "./de.ts";
import { denmark } from "./dk.ts";
import { estonia } from "./ee.ts";
import { spain } from "./es.ts";
import { finland } from "./fi.ts";
import { france } from "./fr.ts";
import { unitedKingdom } from "./gb.ts";
import { greece } from "./gr.ts";
import { hungary } from "./hu.ts";
import { ireland } from "./ie.ts";
import { italy } from "./it.ts";
import { japan } from "./jp.ts";
import { singapore } from "./sg.ts";
import { netherlands } from "./nl.ts";
import { norway } from "./no.ts";
import { poland } from "./pl.ts";
import { portugal } from "./pt.ts";
import { sweden } from "./se.ts";
import { unitedStates } from "./us.ts";

export type { TaxInput, TaxModel, TaxResult } from "./common.ts";

/** One module per country. Adding a country = adding a file and a line here. */
export const TAX_MODELS: Record<Iso2, TaxModel> = {
  IT: italy,
  GB: unitedKingdom,
  IE: ireland,
  US: unitedStates,
  CA: canada,
  AU: australia,
  SG: singapore,
  JP: japan,
  AE: unitedArabEmirates,
  ES: spain,
  PT: portugal,
  FR: france,
  DE: germany,
  NL: netherlands,
  AT: austria,
  EE: estonia,
  HU: hungary,
  CZ: czechia,
  PL: poland,
  NO: norway,
  SE: sweden,
  CH: switzerland,
  FI: finland,
  DK: denmark,
  BE: belgium,
  GR: greece,
};

export function taxModelFor(country: Iso2): TaxModel | undefined {
  return TAX_MODELS[country];
}
