/** Great-circle distance in meters between two WGS84 points. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Paris / Lyon / Marseille municipal arrondissements have their own INSEE
 * codes in BAN and DVF, but geo.api.gouv.fr only knows the parent commune.
 */
export function parentCommuneCode(insee: string): string {
  const n = Number(insee);
  if (n >= 75101 && n <= 75120) return "75056"; // Paris
  if (n >= 69381 && n <= 69389) return "69123"; // Lyon
  if (n >= 13201 && n <= 13216) return "13055"; // Marseille
  return insee;
}

/** Département code as used in geo-dvf file paths ("75", "2A", "971"...). */
export function departementFromInsee(insee: string): string {
  return insee.startsWith("97") ? insee.slice(0, 3) : insee.slice(0, 2);
}

/**
 * DVF, BAN and the rent map key Paris/Lyon/Marseille by municipal
 * arrondissement; a city-wide query must fan out to all of them.
 */
export function expandPlmCodes(insee: string): string[] {
  const ranges: Record<string, [number, number]> = {
    "75056": [75101, 75120], // Paris
    "69123": [69381, 69389], // Lyon
    "13055": [13201, 13216], // Marseille
  };
  const range = ranges[insee];
  if (!range) return [insee];
  const codes: string[] = [];
  for (let c = range[0]; c <= range[1]; c++) codes.push(String(c));
  return codes;
}

/** Point at `distanceM` meters from (lat, lon) along a compass bearing. */
export function offsetPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number,
): { lat: number; lon: number } {
  const b = (bearingDeg * Math.PI) / 180;
  const dLat = (distanceM * Math.cos(b)) / 111_320;
  const dLon = (distanceM * Math.sin(b)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}
