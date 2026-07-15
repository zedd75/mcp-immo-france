import { describe, expect, it } from "vitest";
import { estimateValue, weightedQuantile, yearMedians } from "../src/estimator.js";
import { Mutation } from "../src/apis/dvf.js";

function mutation(over: Partial<Mutation> & { priceM2: number | null }): Mutation {
  const surface = over.dwellings?.[0]?.surface ?? 50;
  return {
    id: Math.random().toString(36).slice(2),
    date: "2025-03-01",
    nature: "Vente",
    price: over.priceM2 !== null ? over.priceM2 * surface : null,
    addresses: ["10 RUE TEST"],
    dwellings: [{ type: "Appartement", surface, rooms: 2 }],
    otherLocals: [],
    landSurface: null,
    lat: 48.86,
    lon: 2.33,
    ...over,
  } as Mutation;
}

const target = { lat: 48.86, lon: 2.33, type: "Appartement" as const, surfaceM2: 50 };

describe("weightedQuantile", () => {
  it("matches unweighted median for equal weights", () => {
    const pairs = [1, 2, 3, 4, 5].map((v) => ({ v, w: 1 }));
    expect(weightedQuantile(pairs, 0.5)).toBe(3);
  });

  it("follows the weight, not the count", () => {
    const pairs = [
      { v: 100, w: 10 },
      { v: 900, w: 0.1 },
      { v: 901, w: 0.1 },
      { v: 902, w: 0.1 },
    ];
    expect(weightedQuantile(pairs, 0.5)).toBe(100);
  });

  it("returns null on empty input", () => {
    expect(weightedQuantile([], 0.5)).toBeNull();
  });
});

describe("yearMedians", () => {
  it("requires at least 5 sales per year", () => {
    const four = Array.from({ length: 4 }, () => mutation({ priceM2: 5000, date: "2023-05-01" }));
    expect(yearMedians(four, "Appartement").has(2023)).toBe(false);
    const five = Array.from({ length: 5 }, () => mutation({ priceM2: 5000, date: "2023-05-01" }));
    expect(yearMedians(five, "Appartement").get(2023)).toBe(5000);
  });
});

describe("estimateValue", () => {
  it("returns the market price when all comps agree", () => {
    const comps = Array.from({ length: 20 }, () => mutation({ priceM2: 8000 }));
    const est = estimateValue(target, comps)!;
    expect(est.per_m2.estimate).toBe(8000);
    expect(est.value_eur.estimate).toBe(400000);
    expect(est.confidence).toBe("high");
  });

  it("adjusts older comps to the latest market level", () => {
    const old = Array.from({ length: 10 }, () =>
      mutation({ priceM2: 5000, date: "2021-06-01" }),
    );
    const recent = Array.from({ length: 10 }, () =>
      mutation({ priceM2: 6000, date: "2025-06-01" }),
    );
    const est = estimateValue(target, [...old, ...recent])!;
    // 2021 comps are re-expressed at the 2025 level (6000/5000 = 1.2 → 6000).
    expect(est.per_m2.estimate).toBe(6000);
  });

  it("ignores sales of the wrong type and wildly different surfaces", () => {
    const good = Array.from({ length: 8 }, () => mutation({ priceM2: 7000 }));
    const houses = Array.from({ length: 8 }, () =>
      mutation({ priceM2: 3000, dwellings: [{ type: "Maison", surface: 50, rooms: 3 }] }),
    );
    const barns = Array.from({ length: 8 }, () =>
      mutation({ priceM2: 1000, dwellings: [{ type: "Appartement", surface: 400, rooms: 10 }] }),
    );
    const est = estimateValue(target, [...good, ...houses, ...barns])!;
    expect(est.per_m2.estimate).toBe(7000);
    expect(est.comps_used).toBe(8);
  });

  it("returns null below 3 comps instead of guessing", () => {
    const comps = [mutation({ priceM2: 8000 }), mutation({ priceM2: 9000 })];
    expect(estimateValue(target, comps)).toBeNull();
  });

  it("weighs nearby comps more than distant ones", () => {
    const near = Array.from({ length: 5 }, () => mutation({ priceM2: 9000 }));
    // ~2.2 km away
    const far = Array.from({ length: 5 }, () => mutation({ priceM2: 4000, lat: 48.88, lon: 2.33 }));
    const est = estimateValue(target, [...near, ...far])!;
    expect(est.per_m2.estimate).toBe(9000);
  });
});
