# mcp-immo-france

[![CI](https://github.com/zeddparis/mcp-immo-france/actions/workflows/ci.yml/badge.svg)](https://github.com/zeddparis/mcp-immo-france/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mcp-immo-france)](https://www.npmjs.com/package/mcp-immo-france)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

**French real-estate intelligence for AI assistants.** Give Claude (or any MCP client) a French address and it can pull the **actual notarized sale prices** around it, produce a **transparent comparables-based valuation** with confidence bounds, compute the **gross rental yield** from official rent indicators, check the **energy rating (DPE)**, list **natural & technological risks**, and profile the commune — all from official French open data, with **zero API keys**.

> 🇫🇷 Serveur MCP pour l'immobilier français : ventes réelles (DVF), estimation par comparables auditable, loyers officiels et rendement locatif, DPE, risques naturels — pour n'importe quelle adresse, sans clé API. [Section française ↓](#-en-français)

## Why this exists

Real-estate portals show *asking* prices and sell black-box estimates. The French state publishes better raw material — every notarized sale (DVF), every energy diagnostic (ADEME), modelled rents for all 35 000 communes (Carte des loyers), and the official risk report for any parcel (Géorisques) — but scattered across five APIs with three different address keys.

`mcp-immo-france` joins them properly. One call gives an AI assistant a full due-diligence dossier:

> **You:** I'm visiting a 60 m² flat at 12 rue de la République in Lyon, listed at 450 000 €. Worth it? Could I rent it out?
>
> **Claude:** *(calls `property_report`)*
> Comparable notarized sales value it around **304 000 €** (5 064 €/m², 200 weighted comps, high confidence) — the asking price is ~48 % above that. Median for flats within 500 m over the last 12 months: 4 848 €/m². The official rent indicator is 16.6 €/m²/month, so ≈ 1 000 €/month — a **3.9 % gross yield** at the estimated value, much less at asking. Filed DPEs in the building are D. Géorisques flags flood and clay-shrinkage exposure. Recent comparable sales: …

Every number above is traceable: the tool returns its comps, weights, adjustments and sources.

## What makes it different

- **A real valuation engine, not a wrapper.** `estimate_property` computes a weighted-median comparables estimate (distance decay, surface similarity, recency, year-level market adjustment) and returns **every comp with its weight** so the figure can be audited. It reports a Kish effective sample size and refuses to answer below 3 comps rather than hallucinate precision.
- **Boundary-aware search.** Commune-file-based DVF tools silently lose half the neighborhood when an address sits near a commune border. This server probes 8 compass points and fans out to every commune the radius touches.
- **Paris/Lyon/Marseille handled correctly.** City-wide queries aggregate all municipal arrondissements (a naïve implementation returns *zero* sales for "Paris").
- **Honest statistics by default.** €/m² only from single-dwelling deeds, outliers excluded, trailing-12-months view quoted separately from the all-period median, sources named in every response.
- **Zero configuration.** No API key, no signup, no scraping — only official open-data endpoints.

## Quickstart

Requires Node.js ≥ 18.

**Claude Code**

```bash
claude mcp add immo-france -- npx -y mcp-immo-france
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "immo-france": {
      "command": "npx",
      "args": ["-y", "mcp-immo-france"]
    }
  }
}
```

**Any other MCP client** — run `npx -y mcp-immo-france` over stdio.

## Tools

| Tool | What it does | Source |
|---|---|---|
| `property_report` | **One call → full dossier**: market stats, recent sales, valuation, rent & yield, DPE, risks, commune profile | all of the below |
| `estimate_property` | Transparent comparables valuation with confidence bounds, auditable comps and gross rental yield | DVF + Carte des loyers |
| `property_sales` | Actual notarized sales (price, date, surface, rooms) around an address or across a commune, 2021→today | DVF (DGFiP / Etalab) |
| `price_per_m2` | Median / quartiles €/m², all-period + trailing-12-months + per-year evolution | DVF (DGFiP / Etalab) |
| `rent_estimate` | Official modelled asking rents (€/m²/month): apartments, 1-2 rooms, 3+ rooms, houses | Carte des loyers (Min. Logement / ANIL) |
| `dpe_lookup` | Energy performance certificates filed for an address (labels A–G, GES, surface, year built) | ADEME |
| `natural_risks` | Official risk report: flood, clay shrink-swell, radon, earthquake, industrial sites… | Géorisques |
| `commune_info` | Population, postcodes, département, région, surface, center of any commune | geo.api.gouv.fr (INSEE) |
| `geocode_address` / `reverse_geocode` | French address ↔ coordinates + INSEE code + BAN id | Base Adresse Nationale |

### Example prompts

- *« Fais-moi le rapport complet sur le 8 rue Oberkampf à Paris, appartement de 45 m². »*
- *« Estime un T3 de 65 m² au 25 cours Gambetta à Lyon. Rendement locatif ? »*
- *« Prix au m² des maisons à Arcachon : évolution depuis 2021 ? »*
- *"Is this address in a flood zone? What DPE ratings were filed there?"*

## Methodology (and its limits)

**Valuation** — weighted median over comparable sales: same dwelling type, surface within 40–250 % of the target, single-dwelling deeds only. Comps are re-expressed at the latest market level via commune-wide year medians (clamped ×0.7–1.6), then weighted by `exp(-distance/500 m) × exp(-2·|ln(surface ratio)|) × exp(-0.25·age in years)`. The 25th–75th weighted percentiles give the range; the top 200 comps by weight are kept and the Kish effective sample size is reported.

**What the model cannot see:** condition, floor, elevator, view, renovation, legal issues. DVF also lags reality by ~6 months and does not cover Alsace-Moselle or Mayotte. Rent indicators are modelled *asking* rents (charges included), not regulated reference rents. **This is public-data analysis, not a professional appraisal, and not financial advice.**

| Dataset | Publisher | Notes |
|---|---|---|
| [DVF géolocalisées](https://files.data.gouv.fr/geo-dvf/) | DGFiP / Etalab | Notarized sales, 2021→today |
| [Carte des loyers](https://www.data.gouv.fr/fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/) | Min. Logement / ANIL | Modelled asking rents, 2025 |
| [DPE logements existants](https://data.ademe.fr/datasets/dpe03existant) | ADEME | All diagnostics since July 2021 |
| [Géorisques](https://www.georisques.gouv.fr/) | Min. Transition écologique | Official risk reports |
| [Base Adresse Nationale](https://adresse.data.gouv.fr/) / [geo.api.gouv.fr](https://geo.api.gouv.fr/) | IGN / DINUM / INSEE | Addresses & administrative units |

## Development

```bash
npm install
npm run build     # tsc
npm test          # 30+ unit tests, no network
npm run smoke     # end-to-end against the live public APIs
npm run smoke -- "5 avenue Anatole France Paris"
```

Dependency-light on purpose: the MCP SDK, `zod`, and the Node standard library. A weekly CI job runs the live smoke suite to catch upstream dataset changes early. PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- [ ] Cadastral parcel lookup (surface, geometry)
- [ ] New-build DPE dataset (`dpe02neuf`)
- [ ] Streamable HTTP transport for remote deployment
- [ ] Per-quarter market trend detection

## 🇫🇷 En français

Serveur [MCP](https://modelcontextprotocol.io) qui branche Claude (ou tout client MCP) sur l'open data officiel de l'immobilier français : **ventes notariées** (DVF), **estimation par comparables** dont chaque comparable et chaque poids sont restitués (pas de boîte noire), **loyers officiels** (Carte des loyers) avec **rendement brut**, **DPE** (ADEME), **rapport de risques** (Géorisques) et données INSEE. Aucune clé API : `npx -y mcp-immo-france` et c'est en place.

L'outil `property_report` génère en un appel un dossier complet de due diligence pour n'importe quelle adresse — le genre d'analyse qu'on paie ailleurs, ici open source et auditable.

## License

[MIT](LICENSE)
