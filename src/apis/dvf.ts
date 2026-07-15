import { fetchText, HttpError } from "../http.js";
import { parseCsv } from "../util/csv.js";
import { haversineMeters, departementFromInsee, expandPlmCodes } from "../util/geo.js";

export const DVF_FIRST_YEAR = 2021;

/**
 * Candidate years in the geo-dvf distribution. Future years that are not
 * published yet simply 404 and are treated as empty, so new releases are
 * picked up automatically without a code change.
 */
export function availableYears(): number[] {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = DVF_FIRST_YEAR; y <= current; y++) years.push(y);
  return years;
}

export type LocalType = "Appartement" | "Maison" | "Dépendance" | "Local industriel. commercial ou assimilé";

export interface DvfRow {
  idMutation: string;
  date: string;
  nature: string;
  price: number | null;
  number: string;
  suffix: string;
  street: string;
  postcode: string;
  communeCode: string;
  communeName: string;
  typeLocal: string;
  surface: number | null;
  rooms: number | null;
  landSurface: number | null;
  lat: number | null;
  lon: number | null;
}

/** One mutation (sale deed) = one or more DVF rows grouped by id_mutation. */
export interface Mutation {
  id: string;
  date: string;
  nature: string;
  price: number | null;
  addresses: string[];
  /** Rows that are dwellings (Appartement / Maison). */
  dwellings: { type: string; surface: number | null; rooms: number | null }[];
  otherLocals: string[];
  landSurface: number | null;
  lat: number | null;
  lon: number | null;
  /**
   * Price per m² of living area — only computed when the mutation contains
   * exactly one dwelling (otherwise the deed price covers several units and
   * a per-m² figure would be misleading).
   */
  priceM2: number | null;
}

function num(s: string): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function rowsFromCsv(text: string): DvfRow[] {
  return parseCsv(text).map((r) => ({
    idMutation: r["id_mutation"] ?? "",
    date: r["date_mutation"] ?? "",
    nature: r["nature_mutation"] ?? "",
    price: num(r["valeur_fonciere"]),
    number: r["adresse_numero"] ?? "",
    suffix: r["adresse_suffixe"] ?? "",
    street: r["adresse_nom_voie"] ?? "",
    postcode: r["code_postal"] ?? "",
    communeCode: r["code_commune"] ?? "",
    communeName: r["nom_commune"] ?? "",
    typeLocal: r["type_local"] ?? "",
    surface: num(r["surface_reelle_bati"]),
    rooms: num(r["nombre_pieces_principales"]),
    landSurface: num(r["surface_terrain"]),
    lat: num(r["latitude"]),
    lon: num(r["longitude"]),
  }));
}

/**
 * Fetch DVF rows for one commune and one year from the Etalab geo-dvf
 * distribution (no API key). Returns [] when the file does not exist
 * (commune with no recorded sales that year).
 */
export async function fetchCommuneYear(inseeCode: string, year: number): Promise<DvfRow[]> {
  const dept = departementFromInsee(inseeCode);
  const url = `https://files.data.gouv.fr/geo-dvf/latest/csv/${year}/communes/${dept}/${inseeCode}.csv`;
  try {
    const text = await fetchText(url);
    return rowsFromCsv(text);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) return [];
    throw e;
  }
}

/**
 * Fetch DVF rows for one or more communes across several years. Paris, Lyon
 * and Marseille city codes are expanded to their arrondissements (the geo-dvf
 * distribution has no city-level file for them).
 */
export async function fetchCommunes(inseeCodes: string[], years: number[]): Promise<DvfRow[]> {
  const codes = [...new Set(inseeCodes.flatMap(expandPlmCodes))];
  const all = await Promise.all(
    codes.flatMap((code) => years.map((y) => fetchCommuneYear(code, y))),
  );
  return all.flat();
}

const DWELLING_TYPES = new Set(["Appartement", "Maison"]);

export function groupMutations(rows: DvfRow[]): Mutation[] {
  const byId = new Map<string, DvfRow[]>();
  for (const row of rows) {
    const list = byId.get(row.idMutation);
    if (list) list.push(row);
    else byId.set(row.idMutation, [row]);
  }

  const mutations: Mutation[] = [];
  for (const [id, group] of byId) {
    const first = group[0];
    const addresses = [
      ...new Set(
        group
          .map((r) => [r.number, r.suffix, r.street].filter(Boolean).join(" "))
          .filter(Boolean),
      ),
    ];
    const dwellings = group
      .filter((r) => DWELLING_TYPES.has(r.typeLocal))
      .map((r) => ({ type: r.typeLocal, surface: r.surface, rooms: r.rooms }));
    const otherLocals = [
      ...new Set(group.map((r) => r.typeLocal).filter((t) => t && !DWELLING_TYPES.has(t))),
    ];
    const landSurface = group.reduce<number | null>(
      (acc, r) => (r.landSurface !== null ? (acc ?? 0) + r.landSurface : acc),
      null,
    );
    const located = group.find((r) => r.lat !== null && r.lon !== null);

    let priceM2: number | null = null;
    if (
      dwellings.length === 1 &&
      first.price !== null &&
      dwellings[0].surface !== null &&
      dwellings[0].surface > 0
    ) {
      priceM2 = first.price / dwellings[0].surface;
    }

    mutations.push({
      id,
      date: first.date,
      nature: first.nature,
      price: first.price,
      addresses,
      dwellings,
      otherLocals,
      landSurface,
      lat: located?.lat ?? null,
      lon: located?.lon ?? null,
      priceM2,
    });
  }

  mutations.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return mutations;
}

export function withinRadius(m: Mutation, lat: number, lon: number, radiusM: number): boolean {
  if (m.lat === null || m.lon === null) return false;
  return haversineMeters(lat, lon, m.lat, m.lon) <= radiusM;
}
