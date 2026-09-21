# Current help screenshots

`pnpm docs:images refresh` captures 28 scenes in Chinese and English from the real local UI. It creates documentation assets; it is not a regression test. It does not call an LLM, run a backtest, run Python, generate signals, or fabricate network responses. First-visit prompt scenes clear only browser recent-strategy keys; existing users see the equivalent controls in the New dialog. Each scene waits for its actual content, masks the account email, saves a raw masked screenshot, then adds numbered overlays.

## Prepare a disposable source

Use a dedicated local API database with the current schema. Never point this capture session at the normal development database or a deployed service. Existing historical reports may be copied into this disposable database, but their values must not be changed for the screenshot. Keep the API job scheduler off unless a separately authorized capture actually needs it.

Prepare these states through normal application operations in the disposable database:

- An existing TypeScript strategy with a successful, real stock/ETF backtest report. The report and draft are separate; use a strategy whose displayed name agrees with its code.
- A saved Research `index_relationship` template with Markdown and Python Cells. Leave it unrun: these scenes demonstrate editing and controls, not results.
- A blank Research document named `归档示例 / Archive example`, archived through the document menu.
- The `ep` preset and a real saved Factor report accessible to the capture account.
- At least two independent report deployments. Pause one, preserving an active instance, to demonstrate separate lifecycle and account state. Do not generate signals for these entry-point captures.
- Locally available market/valuation/stock data. An empty catalog or public library must remain visibly empty; do not add fake rows to make the image look populated.

Store account information and record IDs in a private JSON file outside the repository:

```json
{
  "email": "reader@example.com",
  "strategy": "saved-strategy-id",
  "document": "saved-template-document-id",
  "archivedDocument": "archived-document-id",
  "factor": "ep",
  "pausedDeployment": "paused-deployment-id"
}
```

Run with the API proxied through the local Web service:

```sh
HELP_CAPTURE_DISPOSABLE=1 \
HELP_CAPTURE_CONFIG=/absolute/private/capture-config.json \
E2E_BASE=http://127.0.0.1:5173 \
pnpm docs:images refresh
```

Optionally set `HELP_CAPTURE_SCENES=research/document-cells-02,signals/paused-current` to capture a comma-separated subset. The script closes its browsers on success or failure. Stop the dedicated API/Web services afterward and release/delete the owned temporary database and private config.

## Outputs and editorial review

- Masked originals: `apps/web/acceptance/help-refresh/{zh,en}/` (not committed).
- Numbered documentation assets: `apps/docs/public/images/help/{zh,en}/`.
- Disposition, article references, SHA-256 hashes and historical crop coordinates: `docs/design/user-guide-images.json`.

Inspect both languages at full resolution, ensure every number matches the adjoining prose, and update the manifest after changing a figure or its references. A successful capture only means that an artifact was produced. It does not verify financial calculations, background jobs or the rendered help site; those checks belong to the approved post-review verification.

The 2026-09-21 inventory distinguishes recaptured controls, retained login controls, historical illustrations, unchanged learning evidence and retired images. Historical screenshots have explicit Chinese-UI captions in both languages. Cropping removes only the obsolete 40-pixel navigation text strip from full-page historical illustrations; frames with overlapping annotations or drawer headers remain intact. Cropping never changes chart values or fills missing results. The 29 learning figures remain byte-for-byte unchanged. Existing `help-content-*` scripts describe earlier capture campaigns; do not run them over these assets without auditing their routes, data mutations and captions first.
