import { fetchText } from "../http.js";
import { expandPlmCodes, parentCommuneCode } from "../util/geo.js";
import { median } from "../util/stats.js";

/**
 * "Carte des loyers" — official asking-rent indicators per commune,
 * Ministère du Logement / ANIL, model built on SeLoger+Leboncoin listings.
 */
export const RENT_YEAR = 2025;

const RESOURCES = {
  apartment: "https://www.data.gouv.fr/fr/datasets/r/55b34088-0964-415f-9df7-d87dd98a09be",
  apartment_1_2_rooms: "https://www.data.gouv.fr/fr/datasets/r/14a1fe11-b2d1-49b3-9f6b-83d12df9482c",
  apartment_3plus_rooms: "https://www.data.gouv.fr/fr/datasets/r/5e3b28a4-cf56-43a3-ae79-43cceeb27f8c",
  house: "https://www.data.gouv.fr/fr/datasets/r/129f764d-b613-44e4-952c-5ff50a8c9b73",
} as const;

export type RentKind = keyof typeof RESOURCES;
export const RENT_KINDS = Object.keys(RESOURCES) as RentKind[];

export interface RentIndicator {
  /** Predicted asking rent, € per m² per month, charges included. */
  rentM2: number;
  lowM2: number;
  highM2: number;
  observations: number;
  r2: number;
}

/**
 * Parse the carte-des-loyers CSV: `;`-separated, quoted values, decimal
 * commas, Latin-1. Exported for tests.
 */
export function parseRentCsv(text: string): Map<string, RentIndicator> {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return new Map();

  const split = (line: string) =>
    line.split(";").map((f) => f.replace(/^"|"$/g, "").trim());
  const header = split(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const iInsee = col("INSEE_C");
  const iRent = col("loypredm2");
  const iLow = col("lwr.IPm2");
  const iHigh = col("upr.IPm2");
  const iObs = col("nbobs_com");
  const iR2 = col("R2_adj");
  if (iInsee < 0 || iRent < 0) {
    throw new Error("Unexpected carte-des-loyers CSV format (columns INSEE_C/loypredm2 not found).");
  }

  const toNum = (s: string) => Number(s.replace(",", "."));
  const map = new Map<string, RentIndicator>();
  for (let i = 1; i < lines.length; i++) {
    const f = split(lines[i]);
    const insee = f[iInsee];
    const rent = toNum(f[iRent]);
    if (!insee || !Number.isFinite(rent)) continue;
    map.set(insee, {
      rentM2: rent,
      lowM2: toNum(f[iLow]),
      highM2: toNum(f[iHigh]),
      observations: Number(f[iObs]) || 0,
      r2: toNum(f[iR2]),
    });
  }
  return map;
}

const tables = new Map<RentKind, Map<string, RentIndicator>>();

async function table(kind: RentKind): Promise<Map<string, RentIndicator>> {
  const cached = tables.get(kind);
  if (cached) return cached;
  const text = await fetchText(RESOURCES[kind], 24 * 60 * 60_000, "latin1");
  const parsed = parseRentCsv(text);
  tables.set(kind, parsed);
  return parsed;
}

export interface RentLookup extends RentIndicator {
  kind: RentKind;
  scope: string;
}

/**
 * Rent indicator for a commune INSEE code. Handles the PLM cities in both
 * directions: an arrondissement falls back to its parent commune, and a
 * parent city code aggregates its arrondissements (median).
 */
export async function rentIndicator(insee: string, kind: RentKind): Promise<RentLookup | null> {
  const t = await table(kind);

  const exact = t.get(insee);
  if (exact) return { ...exact, kind, scope: "commune" };

  const parent = parentCommuneCode(insee);
  if (parent !== insee) {
    const hit = t.get(parent);
    if (hit) return { ...hit, kind, scope: "parent commune" };
  }

  const arrondissements = expandPlmCodes(insee);
  if (arrondissements.length > 1) {
    const hits = arrondissements.map((c) => t.get(c)).filter((h): h is RentIndicator => !!h);
    if (hits.length > 0) {
      return {
        rentM2: median(hits.map((h) => h.rentM2))!,
        lowM2: median(hits.map((h) => h.lowM2))!,
        highM2: median(hits.map((h) => h.highM2))!,
        observations: hits.reduce((a, h) => a + h.observations, 0),
        r2: median(hits.map((h) => h.r2))!,
        kind,
        scope: `median of ${hits.length} arrondissements`,
      };
    }
  }
  return null;
}
