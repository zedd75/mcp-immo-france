import { fetchJson } from "../http.js";
import { parentCommuneCode } from "../util/geo.js";

const BASE = "https://geo.api.gouv.fr";
const FIELDS = "nom,code,codesPostaux,codeDepartement,codeRegion,population,surface,centre,departement,region";

export interface CommuneInfo {
  nom: string;
  code: string;
  codesPostaux?: string[];
  codeDepartement?: string;
  codeRegion?: string;
  population?: number;
  /** Hectares (as returned by geo.api.gouv.fr). */
  surface?: number;
  centre?: { coordinates: [number, number] };
  departement?: { code: string; nom: string };
  region?: { code: string; nom: string };
}

export async function communeByCode(inseeCode: string): Promise<CommuneInfo> {
  const code = parentCommuneCode(inseeCode);
  return fetchJson<CommuneInfo>(`${BASE}/communes/${code}?fields=${FIELDS}`);
}

export async function communesByName(name: string, limit = 5): Promise<CommuneInfo[]> {
  const url = `${BASE}/communes?nom=${encodeURIComponent(name)}&fields=${FIELDS}&limit=${limit}&boost=population`;
  return fetchJson<CommuneInfo[]>(url);
}

/**
 * INSEE code of the commune containing a point, at the same granularity as
 * DVF/BAN (municipal arrondissement inside Paris/Lyon/Marseille). Returns
 * null for points outside France.
 */
export async function communeCodeAtPoint(lat: number, lon: number): Promise<string | null> {
  try {
    const communes = await fetchJson<{ code: string }[]>(
      `${BASE}/communes?lat=${lat}&lon=${lon}&fields=code`,
    );
    const code = communes[0]?.code;
    if (!code) return null;
    if (code === "75056" || code === "69123" || code === "13055") {
      const arr = await fetchJson<{ code: string }[]>(
        `${BASE}/communes?lat=${lat}&lon=${lon}&type=arrondissement-municipal&fields=code`,
      );
      return arr[0]?.code ?? code;
    }
    return code;
  } catch {
    return null;
  }
}
