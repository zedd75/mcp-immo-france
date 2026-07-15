# Contributing

Thanks for considering a contribution!

## Ground rules

- **Correctness over features.** This project quotes numbers people may use in
  real decisions. Any statistic must state its source, scope and exclusions.
  If a shortcut would make a figure misleading, don't take it.
- **No API keys, no scraping.** Only official open-data endpoints that work
  anonymously. That constraint is the product.
- **Dependency-light.** The runtime deps are the MCP SDK and zod. New runtime
  dependencies need a strong justification.

## Workflow

```bash
npm install
npm run build
npm test          # unit tests, no network — must pass
npm run smoke     # live end-to-end — run it before opening a PR
```

- Add unit tests for any parsing or statistics change (fixtures, no network).
- If you add a data source, extend `scripts/smoke.mjs` so the weekly CI job
  catches upstream schema changes.
- Keep tool descriptions crisp: they are read by LLMs deciding when to call.

## Good first contributions

See the roadmap in the README — cadastral parcels, `dpe02neuf`, HTTP
transport — or open an issue with the dataset you wish this server exposed.
