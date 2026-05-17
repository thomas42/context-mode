# Insight Export Design

## Context

The current Insight dashboard is useful on screen but hard to analyze outside the browser. A Markdown export from the browser flattens cards, metrics, and action text into unstructured prose, making it difficult to identify the active problems that deserve work. The dashboard also contains provider-specific guidance such as `CLAUDE.md` recommendations even when the active store is OpenCode, Codex, or another host.

This design covers the first improvement slice: a structured JSON export API and a matching export page. The export becomes the source of truth for later problem-triage UI work and provider-neutral wording.

## Goals

- Add a stable JSON API that can be consumed by the browser, `curl`, scripts, or later agents.
- Add an `/export` page that uses the same API for preview, download, and API URL copying.
- Support exporting one selected store or all discovered stores.
- Support `summary` and `raw` export modes.
- Make sensitive-data redaction optional through an explicit UI checkbox and API parameter.
- Include machine-readable problem indicators in `summary` exports so the next dashboard iteration has concrete data to present.
- Avoid hard-coded Claude-specific guidance in newly generated export problem actions.

## Non-Goals

- Do not redesign the main dashboard in this slice.
- Do not remove all existing Claude-specific UI copy yet; that is a follow-up after export and problem indicators exist.
- Do not replace existing `/api/analytics`, `/api/category-analytics`, `/api/sessions`, or `/api/stores` endpoints.
- Do not stream huge exports yet; this slice returns deterministic JSON responses.

## API

Add:

```text
GET /api/export?store=<store-id|all>&mode=<summary|raw>&redact=<true|false>
```

Parameter rules:

- `store` defaults to the currently selected/default store when omitted.
- `store=all` exports all discovered stores.
- `mode=summary` is the default.
- `mode=raw` includes detailed sessions and events.
- `redact=false` is the default unless the UI checkbox is selected.
- Invalid `mode` or `redact` values return `400` with a JSON error.
- Unknown store IDs return `404`, except for `store=all`.

Response shape:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-17T00:00:00.000Z",
  "scope": {
    "store": "opencode",
    "mode": "summary",
    "redact": false
  },
  "redaction": {
    "applied": false,
    "rules": []
  },
  "stores": [
    {
      "store": {},
      "summary": {},
      "problems": [],
      "sessions": [],
      "raw": null,
      "warnings": []
    }
  ]
}
```

The top-level shape stays the same for one store and all stores. Consumers can always iterate `stores[]`.

## Export Modes

`summary` is the default mode. It contains:

- Store metadata.
- Existing analytics and category analytics summaries.
- Session summaries with IDs, project, timestamps, event counts, compact counts, and warning flags.
- Problem indicators with severity, title, metric, evidence, suggested action, and affected sessions/files.
- Small evidence snippets only; no complete prompt or tool payload dumps.

`raw` includes the summary fields plus detailed sessions and events:

- Session metadata.
- Event rows including type, category, priority, source hook, timestamp, and data payload.
- Resume snapshot metadata where available.
- Any warnings encountered while reading DBs.

Raw mode is intentionally explicit because it can be large and may contain sensitive local paths or prompt/tool data.

## Problem Indicators

`summary` exports include a `problems[]` list. Initial indicators:

- High error rate or unresolved errors.
- Retry storms.
- Hot files and repeated edits.
- Low commit rate or high rework.
- Missing or stale rule files, described provider-neutrally.
- Project attribution problems such as many `Unknown` sessions/projects.
- Store health issues such as many DBs with no events, no MCP data, or stale stores.

Problem shape:

```json
{
  "id": "retry-storms",
  "severity": "fix",
  "title": "15 retry storms detected",
  "metric": { "value": 15, "unit": "storms" },
  "evidence": [
    {
      "kind": "session",
      "storeId": "opencode",
      "sessionId": "ses_...",
      "detail": "same tool repeated 3+ times"
    }
  ],
  "suggestedAction": "Review repeated tool calls and identify the shared failure mode.",
  "affected": {
    "sessions": 12,
    "files": ["src/adapters/detect.ts"]
  }
}
```

New problem actions must avoid assuming Claude Code or `CLAUDE.md`. They should say "project rule file", "agent instructions", or use store/platform metadata when a platform-specific file is actually known.

## Export Page

Add a new `/export` route and a sidebar nav item named `Export`.

Controls:

- Store selector: current/default store, any discovered store, or `All stores`.
- Mode selector: `summary` or `raw`.
- Redaction checkbox: `Redact sensitive data`.
- Actions: `Preview JSON`, `Download JSON`, `Copy API URL`.

Display:

- Show the generated API URL.
- Show selected store count and mode.
- Show a clear warning when `raw` is selected.
- Show a bounded formatted JSON preview so large exports do not take over the page.
- Download filenames should be deterministic, for example:
  - `context-mode-insight-opencode-summary-2026-05-17.json`
  - `context-mode-insight-all-raw-redacted-2026-05-17.json`

The UI must call the same `/api/export` endpoint that scripts use.

## Redaction

`redact=false` leaves raw data unchanged.

`redact=true` applies deterministic masking:

- Replace the user home directory with `<HOME>`.
- Replace absolute project paths with `<PROJECT_PATH>` where project roots are known from session metadata.
- Truncate long prompt/tool payload strings and mark them as `<TRUNCATED:n chars>`.

Every export includes:

```json
{
  "redaction": {
    "applied": true,
    "rules": ["home-path", "project-path", "long-payload"]
  }
}
```

This makes downstream analysis aware of whether the export is complete or masked.

## Error Handling

- Invalid parameters return `400` with `{ "error": "...", "details": ... }`.
- Unknown store IDs return `404`.
- Broken or unreadable SQLite databases do not fail the entire export. The affected store receives `warnings[]`, and remaining stores continue.
- `store=all` exports stores in a deterministic order.
- Sessions and events are sorted deterministically by timestamp and ID.

## Testing

Add focused tests for:

- `/api/export` summary for a single store.
- `/api/export` raw for a single store.
- `/api/export` with `store=all`.
- Invalid parameter handling.
- Unknown store handling.
- Redaction of home paths, project paths, and long payloads.
- Export route/nav/API URL construction.

Existing dashboard, store switching, and Insight cache tests should continue to pass.

## Follow-Up Slices

After this export slice:

1. Use exported `problems[]` to redesign dashboard problem triage.
2. Remove Claude-specific copy from existing dashboard cards and replace it with provider-aware wording.
3. Consider streaming or compressed exports if raw all-store exports become too large.
