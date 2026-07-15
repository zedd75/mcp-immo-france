import { describe, expect, it } from "vitest";
import { parseRentCsv } from "../src/apis/loyers.js";

const SAMPLE = [
  '"id_zone";"INSEE_C";"LIBGEO";"EPCI";"DEP";"REG";"loypredm2";"lwr.IPm2";"upr.IPm2";"TYPPRED";"nbobs_com";"nbobs_mail";"R2_adj"',
  '"1664";"75102";"Paris 2e Arrondissement";"200054781";"75";"11";34,9754991576546;27,10207623025;45,1362298199768;"commune";4463;4463;0,924524325821856',
  '"2755";"69266";"Villeurbanne";"200046977";"69";"84";15,6299565357601;12,5223712875275;19,5087284748595;"commune";37416;37416;0,837177627943596',
].join("\n");

describe("parseRentCsv", () => {
  it("parses semicolon-separated, decimal-comma values", () => {
    const map = parseRentCsv(SAMPLE);
    expect(map.size).toBe(2);
    const paris2 = map.get("75102")!;
    expect(paris2.rentM2).toBeCloseTo(34.975, 2);
    expect(paris2.lowM2).toBeCloseTo(27.102, 2);
    expect(paris2.highM2).toBeCloseTo(45.136, 2);
    expect(paris2.observations).toBe(4463);
    expect(paris2.r2).toBeCloseTo(0.9245, 3);
  });

  it("throws on an unexpected header", () => {
    expect(() => parseRentCsv('"a";"b"\n"1";"2"')).toThrow(/format/);
  });
});
