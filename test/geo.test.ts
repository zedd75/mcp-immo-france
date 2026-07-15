import { describe, expect, it } from "vitest";
import {
  departementFromInsee,
  expandPlmCodes,
  haversineMeters,
  offsetPoint,
  parentCommuneCode,
} from "../src/util/geo.js";

describe("geo utils", () => {
  it("maps PLM arrondissements to their parent commune", () => {
    expect(parentCommuneCode("75102")).toBe("75056"); // Paris 2e
    expect(parentCommuneCode("69383")).toBe("69123"); // Lyon 3e
    expect(parentCommuneCode("13208")).toBe("13055"); // Marseille 8e
    expect(parentCommuneCode("33063")).toBe("33063"); // Bordeaux unchanged
  });

  it("extracts département codes, including DOM and Corsica", () => {
    expect(departementFromInsee("75102")).toBe("75");
    expect(departementFromInsee("97411")).toBe("974");
    expect(departementFromInsee("2A004")).toBe("2A");
  });

  it("expands PLM city codes to arrondissements", () => {
    expect(expandPlmCodes("75056")).toHaveLength(20);
    expect(expandPlmCodes("75056")[0]).toBe("75101");
    expect(expandPlmCodes("69123")).toHaveLength(9);
    expect(expandPlmCodes("13055")).toHaveLength(16);
    expect(expandPlmCodes("33063")).toEqual(["33063"]);
  });

  it("offsets a point by bearing and distance", () => {
    const north = offsetPoint(48.86, 2.33, 0, 1000);
    expect(haversineMeters(48.86, 2.33, north.lat, north.lon)).toBeCloseTo(1000, -1);
    const east = offsetPoint(48.86, 2.33, 90, 1000);
    expect(east.lat).toBeCloseTo(48.86, 6);
    expect(haversineMeters(48.86, 2.33, east.lat, east.lon)).toBeCloseTo(1000, -1);
  });

  it("haversine distance is plausible", () => {
    // Paris -> Lyon is about 392 km as the crow flies.
    const d = haversineMeters(48.8566, 2.3522, 45.764, 4.8357);
    expect(d).toBeGreaterThan(380000);
    expect(d).toBeLessThan(400000);
  });
});
