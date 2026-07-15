import { geocode, geocodeBest, reverseGeocode, GeocodeResult } from "./apis/ban.js";
import {
  availableYears,
  fetchCommunes,
  groupMutations,
  withinRadius,
  Mutation,
} from "./apis/dvf.js";
import { dpeByAddress, dpeByBanId } from "./apis/dpe.js";
import { riskReport } from "./apis/georisques.js";
import { communeByCode, communeCodeAtPoint, communesByName } from "./apis/communes.js";
import { rentIndicator, RentKind, RENT_KINDS, RENT_YEAR } from "./apis/loyers.js";
import { estimateValue as runEstimate } from "./estimator.js";
import { offsetPoint } from "./util/geo.js";
import { median, mean, quantile, round } from "./util/stats.js";

const DVF_SOURCE =
  "DVF (Demandes de valeurs foncières), DGFiP / Etalab — actual notarized sales. Alsace-Moselle and Mayotte are not covered.";
const RENT_SOURCE = `Carte des loyers ${RENT_YEAR}, Ministère du Logement / ANIL — modelled asking rents (charges included).`;

// Guard against DVF data-entry noise (1 € sales, whole-building deeds mistyped...).
const PRICE_M2_MIN = 200;
const PRICE_M2_MAX = 40000;

function validYears(years?: number[]): number[] {
  const all = availableYears();
  if (!years || years.length === 0) return all;
  const valid = years.filter((y) => all.includes(y));
  if (valid.length === 0) {
    throw new Error(`No DVF data for years [${years.join(", ")}]. Available: ${all.join(", ")}.`);
  }
  return valid;
}

interface LocatedQuery {
  geo: GeocodeResult;
  /** Radius filtering only makes sense when the query resolves to a point. */
  isPoint: boolean;
}

async function locate(address: string): Promise<LocatedQuery> {
  const geo = await geocodeBest(address);
  if (!geo.citycode) throw new Error(`Could not resolve an INSEE code for "${address}".`);
  return { geo, isPoint: geo.type === "housenumber" || geo.type === "street" || geo.type === "locality" };
}

/**
 * Communes whose territory may intersect a circle around the point: probe 8
 * compass points at the radius. Catches the classic blind spot of
 * commune-file-based DVF tools — addresses near a boundary silently losing
 * half their neighborhood.
 */
async function communesAround(lat: number, lon: number, radiusM: number): Promise<string[]> {
  const probes = await Promise.all(
    [0, 45, 90, 135, 180, 225, 270, 315].map((bearing) => {
      const p = offsetPoint(lat, lon, bearing, radiusM);
      return communeCodeAtPoint(p.lat, p.lon);
    }),
  );
  return [...new Set(probes.filter((c): c is string => c !== null))];
}

async function loadMutations(
  located: LocatedQuery,
  radiusM: number,
  years: number[],
): Promise<{ mutations: Mutation[]; communes: string[] }> {
  const { geo, isPoint } = located;
  let communes = [geo.citycode!];
  if (isPoint) {
    const around = await communesAround(geo.lat, geo.lon, radiusM);
    communes = [...new Set([geo.citycode!, ...around])];
  }
  const rows = await fetchCommunes(communes, years);
  return { mutations: groupMutations(rows), communes };
}

function saleView(m: Mutation) {
  return {
    date: m.date,
    nature: m.nature,
    price_eur: m.price,
    addresses: m.addresses,
    dwellings: m.dwellings,
    other_locals: m.otherLocals.length > 0 ? m.otherLocals : undefined,
    land_surface_m2: m.landSurface,
    price_per_m2: round(m.priceM2, 0),
  };
}

function cleanPriceM2(m: Mutation): boolean {
  return (
    m.nature === "Vente" &&
    m.priceM2 !== null &&
    m.priceM2 >= PRICE_M2_MIN &&
    m.priceM2 <= PRICE_M2_MAX
  );
}

export async function geocodeAddress(args: { query: string; limit?: number }) {
  const results = await geocode(args.query, args.limit ?? 5);
  return { source: "Base Adresse Nationale (BAN)", results };
}

export async function propertySales(args: {
  address: string;
  radius_m?: number;
  years?: number[];
  type_local?: "Appartement" | "Maison";
  min_surface_m2?: number;
  max_surface_m2?: number;
  limit?: number;
}) {
  const years = validYears(args.years);
  const located = await locate(args.address);
  const { geo, isPoint } = located;
  const radius = args.radius_m ?? 300;
  const limit = Math.min(args.limit ?? 30, 100);

  const { mutations: all, communes } = await loadMutations(located, radius, years);
  let mutations = all.filter((m) => m.nature === "Vente");

  if (isPoint) {
    mutations = mutations.filter((m) => withinRadius(m, geo.lat, geo.lon, radius));
  }
  if (args.type_local) {
    mutations = mutations.filter((m) => m.dwellings.some((d) => d.type === args.type_local));
  }
  if (args.min_surface_m2 !== undefined || args.max_surface_m2 !== undefined) {
    mutations = mutations.filter((m) => {
      const s = m.dwellings.reduce((acc, d) => acc + (d.surface ?? 0), 0);
      if (s === 0) return false;
      if (args.min_surface_m2 !== undefined && s < args.min_surface_m2) return false;
      if (args.max_surface_m2 !== undefined && s > args.max_surface_m2) return false;
      return true;
    });
  }

  return {
    source: DVF_SOURCE,
    query: {
      resolved_address: geo.label,
      scope: isPoint
        ? `within ${radius} m of the address (communes searched: ${communes.join(", ")})`
        : `whole commune (${geo.city}, insee ${geo.citycode})`,
      years,
    },
    total_matching_sales: mutations.length,
    sales: mutations.slice(0, limit).map(saleView),
    note:
      "price_per_m2 is only set when a deed covers exactly one dwelling; deeds bundling several units show the bundle price.",
  };
}

function statsBlock(values: number[]) {
  return {
    sales: values.length,
    median_eur_m2: round(median(values), 0),
    mean_eur_m2: round(mean(values), 0),
    p25_eur_m2: round(quantile(values, 0.25), 0),
    p75_eur_m2: round(quantile(values, 0.75), 0),
  };
}

export async function pricePerM2(args: {
  address: string;
  type_local?: "Appartement" | "Maison";
  years?: number[];
  radius_m?: number;
}) {
  const years = validYears(args.years);
  const located = await locate(args.address);
  const { geo, isPoint } = located;
  const radius = args.radius_m ?? 500;

  const { mutations: all, communes } = await loadMutations(located, radius, years);
  let mutations = all.filter(cleanPriceM2);
  if (isPoint) mutations = mutations.filter((m) => withinRadius(m, geo.lat, geo.lon, radius));
  if (args.type_local) {
    mutations = mutations.filter((m) => m.dwellings[0]?.type === args.type_local);
  }

  const overall = mutations.map((m) => m.priceM2!);
  const byYear: Record<string, unknown> = {};
  for (const y of years) {
    const ofYear = mutations.filter((m) => m.date.startsWith(String(y))).map((m) => m.priceM2!);
    if (ofYear.length > 0) {
      byYear[y] = { sales: ofYear.length, median_eur_m2: round(median(ofYear), 0) };
    }
  }

  // Trailing-12-months view: in a moving market, the all-period median
  // mixes 2021 and today's prices — this is the number to quote.
  const latestDate = mutations.reduce((acc, m) => (m.date > acc ? m.date : acc), "");
  let last12: unknown = null;
  if (latestDate) {
    const cutoff = new Date(Date.parse(latestDate) - 365 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const recent = mutations.filter((m) => m.date >= cutoff).map((m) => m.priceM2!);
    last12 = { window: `${cutoff} → ${latestDate}`, ...statsBlock(recent) };
  }

  return {
    source: DVF_SOURCE,
    query: {
      resolved_address: geo.label,
      scope: isPoint
        ? `within ${radius} m of the address (communes searched: ${communes.join(", ")})`
        : `whole commune (${geo.city}, insee ${geo.citycode})`,
      type_local: args.type_local ?? "Appartement + Maison",
      years,
    },
    all_period: statsBlock(overall),
    last_12_months: last12,
    by_year: byYear,
    note:
      "Computed from single-dwelling notarized sales only, outliers (<200 or >40 000 €/m²) excluded. Quote last_12_months for current market level.",
  };
}

export async function estimateProperty(args: {
  address: string;
  type_local: "Appartement" | "Maison";
  surface_m2: number;
  rooms?: number;
}) {
  const located = await locate(args.address);
  const { geo } = located;
  if (geo.type !== "housenumber" && geo.type !== "street") {
    throw new Error(
      `"${args.address}" resolved to a ${geo.type}; a precise address (street or house number) is required for a valuation.`,
    );
  }

  const { mutations, communes } = await loadMutations(located, 2500, validYears());
  const estimate = runEstimate(
    { lat: geo.lat, lon: geo.lon, type: args.type_local, surfaceM2: args.surface_m2 },
    mutations,
  );
  if (!estimate) {
    throw new Error(
      "Fewer than 3 comparable sales found around this address — not enough data for an honest estimate. Try price_per_m2 at commune level instead.",
    );
  }

  // Rental angle: official asking-rent indicator + gross yield on the estimate.
  let rental: unknown = null;
  const kind: RentKind =
    args.type_local === "Maison"
      ? "house"
      : args.rooms === undefined
        ? "apartment"
        : args.rooms <= 2
          ? "apartment_1_2_rooms"
          : "apartment_3plus_rooms";
  try {
    const rent = await rentIndicator(geo.citycode!, kind);
    if (rent) {
      const monthly = rent.rentM2 * args.surface_m2;
      rental = {
        source: RENT_SOURCE,
        indicator: kind,
        scope: rent.scope,
        rent_eur_m2_month: round(rent.rentM2, 2),
        range_eur_m2_month: [round(rent.lowM2, 2), round(rent.highM2, 2)],
        estimated_monthly_rent_eur: round(monthly, 0),
        gross_yield_pct: round((monthly * 12 * 100) / estimate.value_eur.estimate, 2),
      };
    }
  } catch {
    // Rent data is a bonus; never fail the valuation for it.
  }

  return {
    source: DVF_SOURCE,
    query: {
      resolved_address: geo.label,
      type_local: args.type_local,
      surface_m2: args.surface_m2,
      communes_searched: communes,
    },
    estimate,
    rental,
    caveats: [
      "Comparables-based estimate from public notarized sales; condition, floor, view, renovation state are unknown to the model.",
      "Every comp and weight is listed in top_comps — audit them before quoting the figure.",
      "This is public-data analysis, not a professional appraisal (avis de valeur).",
    ],
  };
}

export async function rentEstimate(args: { location: string; surface_m2?: number }) {
  const q = args.location.trim();
  let citycode: string;
  let label: string;
  if (/^\d[0-9AB]\d{3}$/i.test(q)) {
    citycode = q.toUpperCase();
    label = `INSEE ${citycode}`;
  } else {
    const { geo } = await locate(q);
    citycode = geo.citycode!;
    label = geo.label;
  }

  const indicators: Record<string, unknown> = {};
  await Promise.all(
    RENT_KINDS.map(async (kind) => {
      const hit = await rentIndicator(citycode, kind);
      indicators[kind] = hit
        ? {
            rent_eur_m2_month: round(hit.rentM2, 2),
            range_eur_m2_month: [round(hit.lowM2, 2), round(hit.highM2, 2)],
            scope: hit.scope,
            listings_observed: hit.observations,
            ...(args.surface_m2
              ? { estimated_monthly_rent_eur: round(hit.rentM2 * args.surface_m2, 0) }
              : {}),
          }
        : null;
    }),
  );

  return {
    source: RENT_SOURCE,
    location: label,
    insee_code: citycode,
    year: RENT_YEAR,
    indicators,
    note: "Modelled asking rents (charges included) from SeLoger/Leboncoin listings — not regulated reference rents.",
  };
}

export async function dpeLookup(args: { address: string; limit?: number }) {
  const { geo } = await locate(args.address);
  const size = Math.min(args.limit ?? 10, 50);

  let exact = false;
  let res = geo.banId ? await dpeByBanId(geo.banId, size) : { total: 0, results: [] };
  if (res.total > 0) {
    exact = true;
  } else {
    const q = [geo.housenumber, geo.street].filter(Boolean).join(" ") || geo.label;
    res = await dpeByAddress(q, geo.citycode!, size);
  }

  return {
    source: "ADEME — DPE logements existants (open data)",
    query: { resolved_address: geo.label, ban_id: geo.banId, match: exact ? "exact BAN id" : "address search" },
    total_found: res.total,
    diagnostics: res.results,
    note: "etiquette_dpe = energy label (A best – G worst), etiquette_ges = greenhouse-gas label. conso_5_usages_par_m2_ep is primary energy in kWh/m²/year.",
  };
}

export async function naturalRisks(args: { address?: string; lat?: number; lon?: number }) {
  let lat = args.lat;
  let lon = args.lon;
  let resolved: string | null = null;
  if ((lat === undefined || lon === undefined) && args.address) {
    const { geo } = await locate(args.address);
    lat = geo.lat;
    lon = geo.lon;
    resolved = geo.label;
  }
  if (lat === undefined || lon === undefined) {
    throw new Error("Provide either an address or both lat and lon.");
  }
  const report = await riskReport(lat, lon);
  return {
    source: "Géorisques, Ministère de la Transition écologique",
    resolved_address: resolved ?? report.address,
    ...report,
  };
}

export async function communeInfo(args: { query: string }) {
  const q = args.query.trim();
  const isCode = /^\d[0-9AB]\d{3}$/i.test(q);
  const communes = isCode ? [await communeByCode(q.toUpperCase())] : await communesByName(q);
  if (communes.length === 0) throw new Error(`No commune found for "${q}".`);
  return {
    source: "geo.api.gouv.fr (INSEE)",
    communes: communes.map((c) => ({
      nom: c.nom,
      insee_code: c.code,
      postcodes: c.codesPostaux,
      departement: c.departement,
      region: c.region,
      population: c.population,
      surface_km2: c.surface !== undefined ? round(c.surface / 100, 1) : undefined,
      center: c.centre?.coordinates ? { lon: c.centre.coordinates[0], lat: c.centre.coordinates[1] } : undefined,
    })),
  };
}

export async function whatIsHere(args: { lat: number; lon: number }) {
  const results = await reverseGeocode(args.lat, args.lon);
  return { source: "Base Adresse Nationale (BAN)", results };
}

/**
 * One call → full due-diligence dossier. Sections fail independently: a
 * Géorisques outage must not take the market analysis down with it.
 */
export async function propertyReport(args: {
  address: string;
  type_local?: "Appartement" | "Maison";
  surface_m2?: number;
  rooms?: number;
}) {
  const { geo } = await locate(args.address);

  const section = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await fn();
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };

  const wantValuation = args.type_local !== undefined && args.surface_m2 !== undefined;
  const [market, sales, energy, risks, commune, rent, valuation] = await Promise.all([
    section(() => pricePerM2({ address: args.address, type_local: args.type_local, radius_m: 600 })),
    section(() => propertySales({ address: args.address, type_local: args.type_local, radius_m: 400, limit: 8 })),
    section(() => dpeLookup({ address: args.address, limit: 5 })),
    section(() => naturalRisks({ address: args.address })),
    section(() => communeInfo({ query: geo.citycode! })),
    section(() => rentEstimate({ location: args.address, surface_m2: args.surface_m2 })),
    wantValuation
      ? section(() =>
          estimateProperty({
            address: args.address,
            type_local: args.type_local!,
            surface_m2: args.surface_m2!,
            rooms: args.rooms,
          }),
        )
      : Promise.resolve(null),
  ]);

  return {
    resolved_address: geo.label,
    market,
    recent_sales_nearby: sales,
    valuation,
    rent,
    energy_diagnostics: energy,
    risks,
    commune,
    generated_from:
      "DVF (DGFiP/Etalab), Carte des loyers (Min. Logement/ANIL), ADEME, Géorisques, BAN, INSEE — all official French open data, queried live.",
  };
}
