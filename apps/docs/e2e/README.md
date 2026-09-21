# Help verification

Run from the repository root:

```sh
pnpm --filter docs check:help
pnpm --filter docs test:help-content
```

`check:help` is read-only and needs no running services. It parses the article registry without executing application modules, matches both language directories and imports, checks internal article links, and validates every referenced figure against `docs/design/user-guide-images.json`. Current figures must use the article's language and have a current counterpart. Historical figures need an explicit Chinese-interface caption; the 29 original learning figures must retain their original SHA-256. Retired figures must be absent. The checker never updates hashes or repairs the manifest automatically.

`test:help-content` checks the valid corpus and injects missing translations, broken links, wrong-language or missing figures, missing historical captions, stale references, checksum drift, changed learning evidence, and invalid retirement into private temporary copies. It never edits real articles, images, or the manifest.

For browser verification, first build shared and Docs, then start local API/Web/Docs services with the Web `/docs` proxy pointing to the Docs server. Use a dedicated empty SQLite database with the current Prisma schema for the API and leave job schedulers disabled. The E2E uses development login and the real workbench help entry; it does not require market data, model calls, backtests, Factor calculations, or capture fixtures.

```sh
pnpm --filter @jixie/shared build
pnpm --filter docs build
# Start the dedicated API, Web, and Docs services, then:
E2E_BASE=http://127.0.0.1:5173 pnpm e2e docs-help
```

`docs-help` runs the content checker before opening a browser. It visits every registered article in both languages, checks the exact localized title, image paths/captions/loading, and rendered internal links. Focused assertions preserve the Strategy draft/report distinction, Research archive/version distinction and existing-report readers, Factor prefill, and independent deployment/redeployment rules. It clicks those article links and the mobile article menu. Existing public access, SDK navigation, product popup, learning cases, formulas, code tabs, image preview, and 390px checks remain in place.

Screenshots are written to `apps/docs/acceptance/` (ignored by Git). In addition to existing desktop/mobile captures, `18-help-current-workflow-{zh,en}.png` and `18-help-current-workflow-mobile.png` show the refreshed Factor-to-Strategy guide. Inspect screenshots before recording success. The script closes its browser on success or failure; stop your dedicated services, release their database connections, and remove their temporary database after verification.

These checks protect documentation consistency and rendering. They do not establish that financial calculations are correct, that every described product workflow has been rerun, or that the deployed site has been updated. When intentionally adding articles or replacing figures, update the registry, both languages, and manifest together; preserve the learning evidence baseline.
