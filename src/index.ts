#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  geocodeAddress,
  propertySales,
  pricePerM2,
  estimateProperty,
  rentEstimate,
  propertyReport,
  dpeLookup,
  naturalRisks,
  communeInfo,
  whatIsHere,
} from "./handlers.js";

const server = new McpServer({
  name: "mcp-immo-france",
  version: "0.2.0",
});

type Handler<A> = (args: A) => Promise<unknown>;

function wrap<A>(handler: Handler<A>) {
  return async (args: A) => {
    try {
      const result = await handler(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  };
}

const yearsSchema = z
  .array(z.number().int())
  .optional()
  .describe("DVF years to include (2021-2025). Defaults to all.");

server.registerTool(
  "geocode_address",
  {
    title: "Geocode a French address",
    description:
      "Resolve a French address, street, or city to normalized candidates with coordinates, INSEE city code and BAN id (Base Adresse Nationale). Use this first if an address is ambiguous.",
    inputSchema: {
      query: z.string().describe("Free-form address, e.g. '10 rue de la Paix Paris'"),
      limit: z.number().int().min(1).max(20).optional().describe("Max candidates (default 5)"),
    },
  },
  wrap(geocodeAddress),
);

server.registerTool(
  "property_sales",
  {
    title: "Real property sales around an address (DVF)",
    description:
      "List actual notarized property sales (price, date, surface, rooms) recorded by the French tax administration (DVF) around an address, or for a whole commune if only a city is given. Data 2021-2025, no API key.",
    inputSchema: {
      address: z.string().describe("Address, street or city in France"),
      radius_m: z
        .number()
        .min(20)
        .max(5000)
        .optional()
        .describe("Search radius in meters around the address (default 300; ignored for city-wide queries)"),
      years: yearsSchema,
      type_local: z.enum(["Appartement", "Maison"]).optional().describe("Filter by dwelling type"),
      min_surface_m2: z.number().optional(),
      max_surface_m2: z.number().optional(),
      limit: z.number().int().min(1).max(100).optional().describe("Max sales returned (default 30)"),
    },
  },
  wrap(propertySales),
);

server.registerTool(
  "price_per_m2",
  {
    title: "Price per m² statistics (DVF)",
    description:
      "Compute price-per-m² statistics (median, mean, quartiles, per-year evolution) from actual notarized sales around a French address or across a commune. Data 2021-2025.",
    inputSchema: {
      address: z.string().describe("Address, street or city in France"),
      type_local: z.enum(["Appartement", "Maison"]).optional().describe("Restrict to flats or houses"),
      years: yearsSchema,
      radius_m: z
        .number()
        .min(50)
        .max(5000)
        .optional()
        .describe("Radius in meters around the address (default 500; ignored for city-wide queries)"),
    },
  },
  wrap(pricePerM2),
);

server.registerTool(
  "estimate_property",
  {
    title: "Estimate a property's value (comparables)",
    description:
      "Transparent comparables-based valuation of a flat or house at a precise French address: weighted median of nearby single-dwelling notarized sales, adjusted to current market level, with every comp and weight returned for audit. Also returns the official rent indicator and gross rental yield.",
    inputSchema: {
      address: z.string().describe("Precise address (street + number preferred)"),
      type_local: z.enum(["Appartement", "Maison"]),
      surface_m2: z.number().min(8).max(1000).describe("Living surface in m²"),
      rooms: z.number().int().min(1).max(20).optional().describe("Main rooms (pièces principales) — refines the rent indicator"),
    },
  },
  wrap(estimateProperty),
);

server.registerTool(
  "rent_estimate",
  {
    title: "Rent indicators (Carte des loyers)",
    description:
      "Official modelled asking rents (€/m²/month, charges included) for any French commune: apartments overall, 1-2 rooms, 3+ rooms, and houses. Source: Carte des loyers, Ministère du Logement / ANIL.",
    inputSchema: {
      location: z.string().describe("Address, commune name or INSEE code"),
      surface_m2: z.number().optional().describe("If given, also returns the estimated monthly rent"),
    },
  },
  wrap(rentEstimate),
);

server.registerTool(
  "property_report",
  {
    title: "Full property due-diligence report",
    description:
      "One call, full dossier for a French address: price-per-m² market stats, recent notarized sales, energy diagnostics (DPE), natural & technological risks, commune profile, official rent indicators — plus a comparables-based valuation and gross yield when type_local and surface_m2 are provided. Ideal first call when a user asks about a specific property.",
    inputSchema: {
      address: z.string().describe("Address in France"),
      type_local: z.enum(["Appartement", "Maison"]).optional(),
      surface_m2: z.number().min(8).max(1000).optional(),
      rooms: z.number().int().min(1).max(20).optional(),
    },
  },
  wrap(propertyReport),
);

server.registerTool(
  "dpe_lookup",
  {
    title: "Energy performance diagnostics (DPE)",
    description:
      "Find official energy performance certificates (DPE: energy label A-G, GES label, surface, construction year) filed for a French address. Source: ADEME open data.",
    inputSchema: {
      address: z.string().describe("Address in France"),
      limit: z.number().int().min(1).max(50).optional().describe("Max diagnostics returned (default 10)"),
    },
  },
  wrap(dpeLookup),
);

server.registerTool(
  "natural_risks",
  {
    title: "Natural & technological risks (Géorisques)",
    description:
      "Official risk report for a French address or point: flood, clay shrink-swell, radon, earthquake, industrial sites... Source: Géorisques (Ministère de la Transition écologique).",
    inputSchema: {
      address: z.string().optional().describe("Address in France (alternative to lat/lon)"),
      lat: z.number().optional(),
      lon: z.number().optional(),
    },
  },
  wrap(naturalRisks),
);

server.registerTool(
  "commune_info",
  {
    title: "Commune information",
    description:
      "Population, postcodes, département, région, surface and center coordinates of a French commune, by name or INSEE code.",
    inputSchema: {
      query: z.string().describe("Commune name or 5-char INSEE code (e.g. 'Lyon' or '69123')"),
    },
  },
  wrap(communeInfo),
);

server.registerTool(
  "reverse_geocode",
  {
    title: "Reverse geocode",
    description: "Find the nearest French address for GPS coordinates.",
    inputSchema: {
      lat: z.number(),
      lon: z.number(),
    },
  },
  wrap(whatIsHere),
);

const transport = new StdioServerTransport();
await server.connect(transport);
