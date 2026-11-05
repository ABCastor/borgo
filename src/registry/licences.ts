// The terms every published figure travels under. A source may enter the published data only when its registry entry
// carries a `rights` block whose licence is listed here; the licence decides which file of the published data its
// figures go into. Three files, each under its own terms:
//   open  public/data/dataset.json       CC BY 4.0 for Borgo's compilation; each figure keeps its source's terms
//   odbl  public/data/dataset-odbl.json  ODbL 1.0 (figures derived from OpenStreetMap, a share-alike database)
//   who   public/data/dataset-who.json   WHO's terms for data compilations (public-health use, unaltered values)
//   cmhc  public/data/dataset-cmhc.json  CMHC's Licence Agreement for the Use of Data (recipients accept its terms)
// pipeline/build-data.ts writes a manifest of every source actually exported (public/data/licences.json) and refuses to
// build when a figure's source has no rights block, an unknown licence, or sits in the wrong file. Browser-safe.
import type { Dataset, Observation } from "../core/types.ts";

export type PartId = "open" | "odbl" | "who" | "cmhc";

export interface Licence {
  id: string;
  name: string;
  url: string;
  /** The published file its figures go into. "open": the licence lets the figures sit in a CC BY 4.0 compilation with attribution only (no share-alike, no non-commercial or no-derivatives clause). */
  part: PartId;
}

/** Every licence a published figure may carry. A licence not listed here fails the build. */
export const LICENCES: Record<string, Licence> = Object.fromEntries(
  ([
    { id: "CC0-1.0", name: "CC0 1.0 (public domain dedication)", url: "https://creativecommons.org/publicdomain/zero/1.0/", part: "open" },
    { id: "PD-USGov", name: "Public domain (US government work)", url: "https://www.usa.gov/government-copyright", part: "open" },
    { id: "PD", name: "Public domain (dedicated by the publisher)", url: "https://www.naturalearthdata.com/about/terms-of-use/", part: "open" },
    { id: "CC-BY-4.0", name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", part: "open" },
    { id: "OGL-UK-3.0", name: "Open Government Licence v3.0", url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/", part: "open" },
    { id: "MIT", name: "MIT License", url: "https://opensource.org/license/mit", part: "open" },
    { id: "Unicode-3.0", name: "Unicode License v3", url: "https://www.unicode.org/license.txt", part: "open" },
    { id: "ECB-reuse", name: "ECB copyright terms: free use, cited, unaltered", url: "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html", part: "open" },
    { id: "OECD-data", name: "OECD terms for data: any use, with the OECD citation passed on", url: "https://www.oecd.org/en/about/terms-conditions.html", part: "open" },
    { id: "NCEI-WMO", name: "No licence attached: NCEI public access with a requested citation, under the WMO Unified Data Policy", url: "https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.nodc:0253808", part: "open" },
    { id: "terrain-tiles", name: "Terrain Tiles source terms: public domain (USGS, NOAA) and Open Government Licence – Canada, with attribution", url: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md", part: "open" },
    { id: "law-summary", name: "Borgo's own summary of the law cited (CC BY 4.0); the official text is cited, not copied", url: "https://creativecommons.org/licenses/by/4.0/", part: "open" },
    { id: "EU-reuse", name: "European Commission reuse policy (Decision 2011/833/EU): reuse with the source acknowledged and changes stated", url: "https://ec.europa.eu/eurostat/web/main/help/copyright-notice", part: "open" },
    { id: "facts-no-licence", name: "No licence from the publisher: only facts of presence are stored", url: "https://foundersrc.com/communities", part: "open" },
    { id: "counts-no-licence", name: "No data licence from the publisher: only total counts are stored, no record about anyone, as its terms allow public, non-personal information in openly published research", url: "https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies#7-information-usage-restrictions", part: "open" },
    { id: "ODbL-1.0", name: "Open Database License 1.0", url: "https://opendatacommons.org/licenses/odbl/1-0/", part: "odbl" },
    { id: "Etalab-2.0", name: "Licence Ouverte / Open Licence 2.0 (Etalab)", url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/", part: "open" },
    { id: "CMHC-data", name: "CMHC Licence Agreement for the Use of Data", url: "https://www.cmhc-schl.gc.ca/about-us/terms-conditions/hmip-terms-conditions", part: "cmhc" },
    { id: "WHO-data", name: "WHO terms and conditions for data compilations", url: "https://www.who.int/about/policies/publishing/data-policy/terms-and-conditions", part: "who" },
  ] satisfies Licence[]).map((l) => [l.id, l]),
);

/** The published files: one per set of terms that cannot share a file with the others. */
export interface Part {
  id: PartId;
  /** Where the snapshot keeps its figures in the repository. */
  folder: string;
  /** The published file, relative to the site root (and to public/). */
  file: string;
  licence: { id: string; name: string; url: string };
  /** What anyone reusing this file must keep with it. */
  notice: string;
}

export const PARTS: Record<PartId, Part> = {
  open: {
    id: "open",
    folder: "data/observations",
    file: "data/dataset.json",
    licence: { id: "CC-BY-4.0", name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    notice: "Borgo's compilation is licensed CC BY 4.0. Each figure keeps its source's own terms and attribution, listed in data/licences.json; reuse a figure under those terms.",
  },
  odbl: {
    id: "odbl",
    folder: "data/observations-odbl",
    file: "data/dataset-odbl.json",
    licence: { id: "ODbL-1.0", name: "Open Database License 1.0", url: "https://opendatacommons.org/licenses/odbl/1-0/" },
    notice: "Figures derived from OpenStreetMap. © OpenStreetMap contributors. This database is made available under the Open Database License (ODbL 1.0): https://opendatacommons.org/licenses/odbl/1-0/. It is kept apart from Borgo's CC BY 4.0 data and any derived database must stay under the ODbL.",
  },
  who: {
    id: "who",
    folder: "data/observations-who",
    file: "data/dataset-who.json",
    licence: { id: "WHO-data", name: "WHO terms and conditions for data compilations", url: "https://www.who.int/about/policies/publishing/data-policy/terms-and-conditions" },
    notice: "Values from the WHO Ambient Air Quality Database (Version 8.0), World Health Organization, 2026, as published, with each value's data provider named in its note. Used under WHO's terms for data compilations: for public health purposes, values unaltered, attribution to WHO and the providing countries. Not licensed CC BY. WHO does not endorse Borgo or the way it uses these data.",
  },
  cmhc: {
    id: "cmhc",
    folder: "data/observations-cmhc",
    file: "data/dataset-cmhc.json",
    licence: { id: "CMHC-data", name: "CMHC Licence Agreement for the Use of Data", url: "https://www.cmhc-schl.gc.ca/about-us/terms-conditions/hmip-terms-conditions" },
    notice: "Source: Canada Mortgage and Housing Corporation (CMHC), Rental Market Survey, average rents (October), via Statistics Canada table 34-10-0133-01. This information is reproduced and distributed on an \"as is\" basis with the permission of CMHC. Not licensed CC BY: it is redistributed under CMHC's Licence Agreement for the Use of Data, and anyone receiving it agrees to be bound by those terms.",
  },
};

/** What a registry entry says about its rights, for sources whose figures may be published. */
export interface Rights {
  /** A key of LICENCES. */
  licenceId: string;
  /** The exact release or edition the snapshot reads ("v8.0, June 2026", "NCEI accession 0253808 v6.6"). */
  edition: string;
  /** The page whose terms were read, and when. */
  termsUrl: string;
  termsRead: string;
  /** The credit line that goes wherever its figures are shown or redistributed. */
  attribution: string;
  /** Further notices the terms require (Copernicus, no endorsement). */
  notices?: string[];
}

/** One exported source in the manifest. */
export interface ManifestEntry {
  source: string;
  name: string;
  publisher: string;
  url: string;
  edition: string;
  licenceId: string;
  licence: string;
  licenceUrl: string;
  termsUrl: string;
  termsRead: string;
  attribution: string;
  notices: string[];
  /** Which published file carries its figures, and so under which terms they are redistributed. */
  part: PartId;
  file: string;
  /** What the export holds from it. */
  observations: number;
  metrics: string[];
  /** Earliest and latest retrieval date of its figures. */
  retrieved: [string, string] | null;
  /** What else it provides to the published data (cities, countries, exchange rates, residence rules, the world map). */
  provides: string[];
}

export interface LicenceManifest {
  builtAt: string;
  parts: Part[];
  sources: ManifestEntry[];
}

/** A published file other than dataset.json: its observations, under its licence. */
export interface PartFile {
  part: PartId;
  licence: Part["licence"];
  notice: string;
  sources: string[];
  observations: Record<string, Observation[]>;
}

/** What dataset.json says about the files beside it and the terms of everything in it. */
export interface Published {
  parts?: { part: PartId; file: string; licence: Part["licence"]; sources: string[] }[];
  manifest?: LicenceManifest;
}

/** Where a source's figures may go, or why they may not be published at all. */
export function partFor(e: { id: string; access: string; redistribute: string; rights?: Rights }): { part: PartId } | { error: string } {
  if (e.access === "link-out" || e.redistribute === "no") return { error: `${e.id} is not cleared for redistribution (access ${e.access}, redistribute ${e.redistribute})` };
  if (!e.rights) return { error: `${e.id} has no rights block in registry/${e.id}.json, so its terms are unknown` };
  const l = LICENCES[e.rights.licenceId];
  if (!l) return { error: `${e.id}: unknown licence ${e.rights.licenceId}; add it to src/registry/licences.ts only after reading its terms` };
  if (!e.rights.attribution?.trim()) return { error: `${e.id}: no attribution text` };
  if ((l.part === "odbl") !== (e.redistribute === "share-alike")) return { error: `${e.id}: licence ${l.id} and redistribute "${e.redistribute}" disagree` };
  return { part: l.part };
}

/** The dataset with every published part's observations merged in, as the engine reads it. */
export function withParts<D extends Dataset>(data: D, files: PartFile[]): D {
  const observations: Record<string, Observation[]> = Object.fromEntries(Object.entries(data.observations).map(([k, v]) => [k, [...v]]));
  for (const f of files) for (const [city, list] of Object.entries(f.observations)) (observations[city] ??= []).push(...list);
  return { ...data, observations };
}

/** The manifest a dataset carries, if it was built with one. */
export function manifestOf(data: Dataset): LicenceManifest | undefined {
  return (data as Dataset & Published).manifest;
}

/** The published files beside dataset.json, relative to the site root. */
export function partFiles(data: Dataset): string[] {
  return ((data as Dataset & Published).parts ?? []).map((p) => p.file);
}

/** The manifest entries for the given sources, in a stable order: what a page must credit for the figures it shows. */
export function creditsFor(data: Dataset, ids: Iterable<string>): ManifestEntry[] {
  const want = new Set(ids);
  return (manifestOf(data)?.sources ?? []).filter((s) => want.has(s.source));
}
