import { Mutation } from "./apis/dvf.js";
import { haversineMeters } from "./util/geo.js";
import { median, round } from "./util/stats.js";

/**
 * Transparent comparables-based valuation.
 *
 * Not a black-box AVM: every comp, weight and adjustment is returned to the
 * caller so the model (and the human behind it) can audit the figure.
 *
 * Method:
 *  1. keep single-dwelling notarized sales of the same type with a valid €/m²
 *     and a surface between 40% and 250% of the target;
 *  2. re-express each comp at current market level using the ratio of
 *     commune-wide median €/m² (sale year → latest year), clamped to [0.7, 1.6];
 *  3. weight comps by distance (exp decay, 500 m scale), surface similarity
 *     (log-ratio) and recency (25%/year decay);
 *  4. report the weighted median as the estimate and the weighted 25th/75th
 *     percentiles as the range.
 */

export interface Target {
  lat: number;
  lon: number;
  type: "Appartement" | "Maison";
  surfaceM2: number;
}

export interface CompView {
  date: string;
  address: string;
  distance_m: number;
  surface_m2: number | null;
  rooms: number | null;
  price_eur: number | null;
  price_m2: number;
  price_m2_adjusted: number;
  year_adjustment: number;
  weight: number;
}

export interface Estimate {
  per_m2: { estimate: number; low: number; high: number };
  value_eur: { estimate: number; low: number; high: number };
  confidence: "high" | "medium" | "low";
  comps_used: number;
  /**
   * Kish effective sample size (Σw)²/Σw² — how many equally-weighted comps
   * the weighted set is actually worth. The honest counterpart of comps_used.
   */
  effective_sample_size: number;
  reference_year: number;
  year_medians_eur_m2: Record<string, number>;
  top_comps: CompView[];
}

/** Keep only the most relevant comps so distant near-zero weights don't inflate the sample. */
const MAX_COMPS = 200;

export function weightedQuantile(pairs: { v: number; w: number }[], q: number): number | null {
  if (pairs.length === 0) return null;
  const sorted = [...pairs].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((a, p) => a + p.w, 0);
  if (total <= 0) return null;
  let cum = 0;
  for (const p of sorted) {
    cum += p.w;
    if (cum >= q * total) return p.v;
  }
  return sorted[sorted.length - 1].v;
}

const PRICE_M2_MIN = 200;
const PRICE_M2_MAX = 40000;

function isCandidate(m: Mutation, type: string): boolean {
  return (
    m.nature === "Vente" &&
    m.priceM2 !== null &&
    m.priceM2 >= PRICE_M2_MIN &&
    m.priceM2 <= PRICE_M2_MAX &&
    m.dwellings.length === 1 &&
    m.dwellings[0].type === type
  );
}

/** Commune-wide median €/m² per year (years with at least 5 sales). */
export function yearMedians(mutations: Mutation[], type: string): Map<number, number> {
  const byYear = new Map<number, number[]>();
  for (const m of mutations) {
    if (!isCandidate(m, type)) continue;
    const year = Number(m.date.slice(0, 4));
    if (!Number.isFinite(year)) continue;
    const list = byYear.get(year);
    if (list) list.push(m.priceM2!);
    else byYear.set(year, [m.priceM2!]);
  }
  const out = new Map<number, number>();
  for (const [year, values] of byYear) {
    if (values.length >= 5) out.set(year, median(values)!);
  }
  return out;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function estimateValue(target: Target, mutations: Mutation[]): Estimate | null {
  const medians = yearMedians(mutations, target.type);
  const referenceYear =
    medians.size > 0
      ? Math.max(...medians.keys())
      : Math.max(
          ...mutations.filter((m) => isCandidate(m, target.type)).map((m) => Number(m.date.slice(0, 4))),
          new Date().getFullYear(),
        );
  const refMedian = medians.get(referenceYear);

  const now = Date.now();
  const comps: CompView[] = [];
  for (const m of mutations) {
    if (!isCandidate(m, target.type)) continue;
    if (m.lat === null || m.lon === null) continue;
    const surface = m.dwellings[0].surface;
    if (surface === null || surface <= 0) continue;
    const ratio = surface / target.surfaceM2;
    if (ratio < 0.4 || ratio > 2.5) continue;

    const distance = haversineMeters(target.lat, target.lon, m.lat, m.lon);
    const ageYears = Math.max(0, (now - Date.parse(m.date)) / (365.25 * 24 * 3600 * 1000));
    const saleYear = Number(m.date.slice(0, 4));
    const saleMedian = medians.get(saleYear);
    const adjustment =
      refMedian !== undefined && saleMedian !== undefined
        ? clamp(refMedian / saleMedian, 0.7, 1.6)
        : 1;

    const weight =
      Math.exp(-distance / 500) *
      Math.exp(-2 * Math.abs(Math.log(ratio))) *
      Math.exp(-0.25 * ageYears);
    if (weight <= 0) continue;

    comps.push({
      date: m.date,
      address: m.addresses.join(" / "),
      distance_m: Math.round(distance),
      surface_m2: surface,
      rooms: m.dwellings[0].rooms,
      price_eur: m.price,
      price_m2: round(m.priceM2!, 0)!,
      price_m2_adjusted: round(m.priceM2! * adjustment, 0)!,
      year_adjustment: round(adjustment, 3)!,
      weight,
    });
  }

  if (comps.length < 3) return null;

  comps.sort((a, b) => b.weight - a.weight);
  const kept = comps.slice(0, MAX_COMPS);

  const pairs = kept.map((c) => ({ v: c.price_m2_adjusted, w: c.weight }));
  const est = weightedQuantile(pairs, 0.5)!;
  const low = weightedQuantile(pairs, 0.25)!;
  const high = weightedQuantile(pairs, 0.75)!;

  const sumW = kept.reduce((a, c) => a + c.weight, 0);
  const sumW2 = kept.reduce((a, c) => a + c.weight ** 2, 0);
  const ess = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;

  const dispersion = est > 0 ? (high - low) / est : 1;
  const confidence: Estimate["confidence"] =
    ess >= 15 && dispersion < 0.35
      ? "high"
      : ess >= 6 && dispersion < 0.6
        ? "medium"
        : "low";

  const norm = kept[0]?.weight || 1;

  return {
    per_m2: { estimate: round(est, 0)!, low: round(low, 0)!, high: round(high, 0)! },
    value_eur: {
      estimate: round(est * target.surfaceM2, -3)!,
      low: round(low * target.surfaceM2, -3)!,
      high: round(high * target.surfaceM2, -3)!,
    },
    confidence,
    comps_used: kept.length,
    effective_sample_size: round(ess, 1)!,
    reference_year: referenceYear,
    year_medians_eur_m2: Object.fromEntries(
      [...medians.entries()].sort().map(([y, v]) => [String(y), round(v, 0)!]),
    ),
    top_comps: kept.slice(0, 10).map((c) => ({ ...c, weight: round(c.weight / norm, 3)! })),
  };
}
