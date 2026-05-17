# Insight Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a structured Insight JSON export API and `/export` page for one store or all stores, with summary/raw modes, optional redaction, and machine-readable problem indicators.

**Architecture:** Keep the existing `insight/server.mjs` single-file server pattern, but add small focused helpers for export parameter parsing, route status handling, per-store export assembly, problem extraction, and redaction. The React UI adds one route that builds the API URL and uses the same endpoint for preview and download. Existing analytics endpoints remain unchanged.

**Tech Stack:** Node/Bun HTTP server in `insight/server.mjs`, SQLite through `better-sqlite3`/`bun:sqlite`, React + TanStack Router + Vite in `insight/src`, Vitest tests in `tests/analytics/insight-cors.test.ts`.

---

## File Structure

- Modify `insight/server.mjs`
  - Add status-aware API route results.
  - Add `/api/export`.
  - Add export summary/raw collection helpers.
  - Add redaction and problem indicator helpers.
- Modify `insight/src/lib/api.ts`
  - Add export request/response types.
  - Add URL builder, preview fetch, and download helper input shape.
- Modify `insight/src/routes/__root.tsx`
  - Add `Export` nav item.
- Create `insight/src/routes/export.tsx`
  - Add export controls, API URL display, JSON preview, copy, and download.
- Modify generated `insight/src/routeTree.gen.ts`
  - Let the TanStack router plugin update this via `npm run build`.
- Modify `tests/analytics/insight-cors.test.ts`
  - Extend fixture data and add API export coverage.
- Modify `tests/core/cli.test.ts`
  - Add source-level assertions for export route/nav if a browser-level test is too heavy for this slice.

## Task 1: Add Status-Aware API Routing

**Files:**
- Modify: `insight/server.mjs`
- Test: `tests/analytics/insight-cors.test.ts`

- [ ] **Step 1: Write the failing status-code tests**

Add these tests inside the existing `describe("Insight API same-machine cross-origin policy", ...)` block in `tests/analytics/insight-cors.test.ts`:

```ts
  test("export rejects invalid mode with 400 JSON (Node)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/export?mode=bogus`);

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toMatchObject({
      error: "invalid export mode",
      details: { mode: "bogus" },
    });
  });

  test("export rejects unknown store with 404 JSON (Node)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/export?store=missing-store`);

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toMatchObject({
      error: "unknown store",
      details: { store: "missing-store" },
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/analytics/insight-cors.test.ts
```

Expected: both new tests fail because `/api/export` is not implemented and the server currently writes all API responses with status `200`.

- [ ] **Step 3: Add route result helpers**

In `insight/server.mjs`, directly above `function route(method, pathname, params)`, add:

```js
function ok(body) {
  return { status: 200, body };
}

function apiError(status, error, details = undefined) {
  return { status, body: details === undefined ? { error } : { error, details } };
}
```

Change `route(method, pathname, params)` so it returns `null` or `{ status, body }`. Keep existing behavior by wrapping current endpoint bodies with `ok(...)`:

```js
function route(method, pathname, params) {
  if (pathname === "/api/stores") return ok({ stores: discoverStores() });
  const storeId = params.get("store") || undefined;
  return withStore(storeId, (store) => {
    const cachePrefix = `store:${store.id}:`;
    if (pathname === "/api/overview") return ok(apiOverview());
    if (pathname === "/api/analytics") return ok(cached(`${cachePrefix}analytics`, apiAnalytics));
    if (pathname === "/api/category-analytics") return ok(cached(`${cachePrefix}category-analytics`, apiCategoryAnalytics));
    if (pathname === "/api/content") return ok(apiContentDBs());
    if (pathname === "/api/sessions") return ok(apiSessionDBs());

    if (pathname.startsWith("/api/content/") && pathname.includes("/chunks/")) {
      const parts = pathname.split("/");
      if (!isValidHash(parts[3])) return apiError(400, "invalid hash", { hash: parts[3] });
      return ok(apiSourceChunks(parts[3], Number(parts[5])));
    }
    if (pathname === "/api/search") {
      const q = params.get("q");
      if (!q) return apiError(400, "missing q param");
      return ok(apiSearchAll(q));
    }
    if (pathname.startsWith("/api/sessions/") && pathname.includes("/events/")) {
      const parts = pathname.split("/");
      if (!isValidHash(parts[3])) return apiError(400, "invalid hash", { hash: parts[3] });
      return ok(apiSessionEvents(parts[3], decodeURIComponent(parts[5])));
    }
    if (method === "DELETE" && pathname.startsWith("/api/content/")) {
      const parts = pathname.split("/");
      if (!isValidHash(parts[3])) return apiError(400, "invalid hash", { hash: parts[3] });
      return ok(apiDeleteSource(parts[3], Number(parts[5])));
    }
    return null;
  });
}
```

Update the Bun response block:

```js
const result = route(req.method, url.pathname, url.searchParams);
if (result !== null) {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: API_JSON_HEADERS,
  });
}
```

Update the Node response block:

```js
const result = route(req.method, url.pathname, url.searchParams);
if (result !== null) {
  res.writeHead(result.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result.body));
  return;
}
```

- [ ] **Step 4: Add temporary export parameter validation stub**

Still above `route(...)`, add:

```js
function parseExportParams(params) {
  const store = params.get("store") || undefined;
  const mode = params.get("mode") || "summary";
  const redactRaw = params.get("redact") || "false";

  if (mode !== "summary" && mode !== "raw") {
    return { error: apiError(400, "invalid export mode", { mode }) };
  }
  if (redactRaw !== "true" && redactRaw !== "false") {
    return { error: apiError(400, "invalid redact value", { redact: redactRaw }) };
  }
  return { value: { store, mode, redact: redactRaw === "true" } };
}
```

Add the route before `withStore(...)`:

```js
  if (pathname === "/api/export") {
    const parsed = parseExportParams(params);
    if (parsed.error) return parsed.error;
    if (parsed.value.store && parsed.value.store !== "all") {
      const stores = discoverStores();
      if (!stores.some((store) => store.id === parsed.value.store)) {
        return apiError(404, "unknown store", { store: parsed.value.store });
      }
    }
    return ok({ schemaVersion: 1, scope: parsed.value, stores: [] });
  }
```

- [ ] **Step 5: Run tests to verify status handling passes**

Run:

```bash
npm test -- tests/analytics/insight-cors.test.ts
```

Expected: existing tests still pass, and the two new export parameter tests pass.

- [ ] **Step 6: Commit**

```bash
git add insight/server.mjs tests/analytics/insight-cors.test.ts
git commit -m "feat: add Insight export route validation"
```

## Task 2: Implement Summary Export and Problem Indicators

**Files:**
- Modify: `insight/server.mjs`
- Test: `tests/analytics/insight-cors.test.ts`

- [ ] **Step 1: Write failing summary export tests**

Add this test to `tests/analytics/insight-cors.test.ts`:

```ts
  test("export summary returns store analytics, sessions, and problems (Node)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/export?store=launch&mode=summary`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.scope).toMatchObject({ store: "launch", mode: "summary", redact: false });
    expect(body.redaction).toMatchObject({ applied: false, rules: [] });
    expect(body.stores).toHaveLength(1);
    expect(body.stores[0].store).toMatchObject({ id: "launch" });
    expect(body.stores[0].summary.analytics.totals.totalSessions).toBeGreaterThanOrEqual(1);
    expect(body.stores[0].summary.categoryAnalytics.errorIntelligence.totalErrors).toBeGreaterThanOrEqual(0);
    expect(body.stores[0].sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "sess-1", projectDir: "/secret/project" }),
    ]));
    expect(body.stores[0].problems.map((p: { id: string }) => p.id)).toContain("store-health");
    expect(body.stores[0].raw).toBeNull();
    expect(body.stores[0].warnings).toEqual([]);
  });

  test("export summary supports all stores with deterministic store order (Node)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/export?store=all&mode=summary`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toMatchObject({ store: "all", mode: "summary" });
    const ids = body.stores.map((entry: { store: { id: string } }) => entry.store.id);
    expect(ids).toContain("launch");
    expect(ids).toContain("codex");
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/analytics/insight-cors.test.ts
```

Expected: summary tests fail because `/api/export` still returns an empty `stores` array.

- [ ] **Step 3: Add strict store lookup and session summary helpers**

In `insight/server.mjs`, near `selectStore(storeId)`, add:

```js
function findStore(storeId) {
  return discoverStores().find((store) => store.id === storeId) || null;
}

function selectedExportStores(storeId) {
  const stores = discoverStores().sort((a, b) => a.id.localeCompare(b.id));
  if (!storeId) return stores.slice(0, 1);
  if (storeId === "all") return stores;
  const store = stores.find((candidate) => candidate.id === storeId);
  return store ? [store] : [];
}
```

Add this helper near `apiSessionDBs()`:

```js
function exportSessionSummaries() {
  return apiSessionDBs()
    .flatMap((db) => db.sessions.map((session) => ({
      ...session,
      dbHash: db.hash,
      dbSizeBytes: db.sizeBytes || 0,
      warningFlags: [
        ...(session.projectDir === UNKNOWN_PROJECT_KEY ? ["unknown-project"] : []),
        ...(session.compactCount > 0 ? ["compacted"] : []),
        ...(session.eventCount === 0 ? ["empty-session"] : []),
      ],
    })))
    .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")) || String(a.id).localeCompare(String(b.id)));
}
```

- [ ] **Step 4: Add problem indicator builder**

Add this helper above `apiCategoryAnalytics()`:

```js
function buildExportProblems(store, analytics, categoryAnalytics, sessions) {
  const problems = [];
  const totals = analytics.totals || {};
  const errorInfo = categoryAnalytics.errorIntelligence || {};
  const fileInfo = categoryAnalytics.fileIntelligence || {};
  const contextHealth = categoryAnalytics.contextHealth || {};
  const attribution = analytics.attribution || {};

  function push(problem) {
    problems.push({
      severity: "info",
      evidence: [],
      affected: {},
      ...problem,
    });
  }

  if ((totals.errorRate || 0) >= 10 || (errorInfo.totalErrors || 0) > 0 && (errorInfo.resolutionRate || 0) < 50) {
    push({
      id: "error-rate",
      severity: (totals.errorRate || 0) >= 15 ? "fix" : "warn",
      title: `${totals.errorRate || 0}% error rate`,
      metric: { value: totals.errorRate || 0, unit: "percent" },
      evidence: (analytics.errors || []).slice(0, 5).map((error) => ({
        kind: "error",
        storeId: store.id,
        sessionId: error.session_id,
        detail: String(error.detail || "").slice(0, 180),
      })),
      suggestedAction: "Group repeated failures by tool and fix the shared cause before continuing similar work.",
      affected: { sessions: new Set((analytics.errors || []).map((error) => error.session_id)).size },
    });
  }

  if ((errorInfo.retryStorms || 0) > 0) {
    push({
      id: "retry-storms",
      severity: "fix",
      title: `${errorInfo.retryStorms} retry storms detected`,
      metric: { value: errorInfo.retryStorms, unit: "storms" },
      evidence: [{ kind: "category", storeId: store.id, detail: "iteration-loop events grouped by session" }],
      suggestedAction: "Stop repeated tool attempts, inspect the common input shape, and change the approach.",
      affected: { sessions: errorInfo.retryStorms },
    });
  }

  if ((fileInfo.hotFiles || []).length > 0) {
    const hotFiles = fileInfo.hotFiles.slice(0, 5);
    push({
      id: "hot-files",
      severity: "warn",
      title: `${hotFiles.length} hot files with repeated edits`,
      metric: { value: hotFiles[0].touches, unit: "top-file-touches" },
      evidence: hotFiles.map((file) => ({ kind: "file", storeId: store.id, detail: `${file.file}: ${file.touches} touches` })),
      suggestedAction: "Review the full file and capture the intended invariant in a test or project rule before more edits.",
      affected: { files: hotFiles.map((file) => file.file) },
    });
  }

  if ((totals.commitsPerSession || 0) < 0.2 && (totals.totalSessions || 0) >= 3) {
    push({
      id: "low-commit-rate",
      severity: "warn",
      title: `${totals.commitsPerSession} commits per session`,
      metric: { value: totals.commitsPerSession || 0, unit: "commits-per-session" },
      evidence: (analytics.commitRate || []).slice(0, 5).map((session) => ({
        kind: "session",
        storeId: store.id,
        sessionId: session.session_id,
        detail: `${session.commits || 0} commits`,
      })),
      suggestedAction: "Break work into smaller checkpoints and commit completed slices before starting unrelated fixes.",
      affected: { sessions: totals.totalSessions || 0 },
    });
  }

  if ((contextHealth.uniqueRuleFiles || 0) === 0 && (errorInfo.totalErrors || 0) > 0) {
    push({
      id: "missing-rule-files",
      severity: "warn",
      title: "No project rule files detected",
      metric: { value: 0, unit: "rule-files" },
      evidence: [{ kind: "store", storeId: store.id, detail: `${errorInfo.totalErrors} errors without loaded project rules` }],
      suggestedAction: "Add or update provider-appropriate agent instructions with the recurring failure pattern.",
      affected: { sessions: totals.totalSessions || 0 },
    });
  }

  if ((attribution.unknownPct || 0) >= 25) {
    push({
      id: "unknown-project-attribution",
      severity: "warn",
      title: `${attribution.unknownPct}% events have unknown project attribution`,
      metric: { value: attribution.unknownPct, unit: "percent" },
      evidence: [{ kind: "store", storeId: store.id, detail: `${attribution.unknownEvents || 0} unknown events` }],
      suggestedAction: "Verify hook payloads include cwd or project metadata so Insight can group sessions correctly.",
      affected: { sessions: sessions.filter((session) => session.projectDir === UNKNOWN_PROJECT_KEY).length },
    });
  }

  if ((store.sessionDbs || 0) > 0 && (totals.totalEvents || 0) === 0) {
    push({
      id: "store-health",
      severity: "fix",
      title: `${store.label} has databases but no events`,
      metric: { value: store.sessionDbs, unit: "session-dbs" },
      evidence: [{ kind: "store", storeId: store.id, detail: `${store.sessionDbs} session DBs, 0 events` }],
      suggestedAction: "Run doctor for this store and verify hooks write session_events rows.",
      affected: { sessions: 0 },
    });
  } else if ((store.contentDbs || 0) > 0 && (store.sessionDbs || 0) === 0) {
    push({
      id: "store-health",
      severity: "info",
      title: `${store.label} has content indexes but no session databases`,
      metric: { value: store.contentDbs, unit: "content-dbs" },
      evidence: [{ kind: "store", storeId: store.id, detail: `${store.contentDbs} content DBs, 0 session DBs` }],
      suggestedAction: "Verify whether this host should capture sessions or only content.",
      affected: { sessions: 0 },
    });
  }

  return problems.sort((a, b) => {
    const order = { fix: 0, warn: 1, info: 2, nice: 3 };
    return (order[a.severity] || 9) - (order[b.severity] || 9) || a.id.localeCompare(b.id);
  });
}
```

- [ ] **Step 5: Add summary export assembly**

Add this above `parseExportParams(params)`:

```js
function exportOneStore(store, options) {
  return withStore(store.id, () => {
    const analytics = apiAnalytics();
    const categoryAnalytics = apiCategoryAnalytics();
    const sessions = exportSessionSummaries();
    const problems = buildExportProblems(store, analytics, categoryAnalytics, sessions);
    return {
      store,
      summary: {
        overview: apiOverview(),
        analytics,
        categoryAnalytics,
      },
      problems,
      sessions,
      raw: null,
      warnings: [],
    };
  });
}

function apiExport(options) {
  const stores = selectedExportStores(options.store);
  if (options.store && options.store !== "all" && stores.length === 0) {
    return apiError(404, "unknown store", { store: options.store });
  }
  return ok({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: {
      store: options.store || stores[0]?.id || "default",
      mode: options.mode,
      redact: options.redact,
    },
    redaction: {
      applied: false,
      rules: [],
    },
    stores: stores.map((store) => exportOneStore(store, options)),
  });
}
```

Replace the temporary `/api/export` route body with:

```js
  if (pathname === "/api/export") {
    const parsed = parseExportParams(params);
    if (parsed.error) return parsed.error;
    return apiExport(parsed.value);
  }
```

- [ ] **Step 6: Run summary tests**

Run:

```bash
npm test -- tests/analytics/insight-cors.test.ts
```

Expected: export summary tests pass. If the seeded launch store does not produce `store-health`, adjust the test to assert at least one deterministic problem that the fixture creates, or extend the fixture with an empty content-only store.

- [ ] **Step 7: Commit**

```bash
git add insight/server.mjs tests/analytics/insight-cors.test.ts
git commit -m "feat: export Insight summary data"
```

## Task 3: Implement Raw Export and Redaction

**Files:**
- Modify: `insight/server.mjs`
- Test: `tests/analytics/insight-cors.test.ts`

- [ ] **Step 1: Extend fixture data for redaction**

In `seedFixtureDBs(...)`, replace the inserted `session_events.data` value with a long value containing the temp home and project path:

```ts
const longPayload = `${baseDir} /secret/project ${"x".repeat(1400)}`;
sessionDb.prepare(
  "INSERT INTO session_events (id, session_id, type, category, priority, data, source_hook, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
).run(
  1,
  "sess-1",
  "user_prompt",
  "prompt",
  "high",
  longPayload,
  "sessionstart",
  "2026-04-16T00:01:00Z",
);
```

Keep the CORS test assertion broad:

```ts
expect(body.events[0].data).toContain("/secret/project");
```

- [ ] **Step 2: Write failing raw and redacted export tests**

Add:

```ts
  test("export raw includes full event payloads when not redacted (Node)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/export?store=launch&mode=raw&redact=false`);

    expect(res.status).toBe(200);
    const body = await res.json();
    const rawSession = body.stores[0].raw.sessions[0];
    expect(rawSession.id).toBe("sess-1");
    expect(rawSession.events[0].data).toContain("/secret/project");
    expect(rawSession.events[0].data).toContain("x".repeat(100));
    expect(body.redaction).toEqual({ applied: false, rules: [] });
  });

  test("export raw can redact home paths, project paths, and long payloads (Node)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/export?store=launch&mode=raw&redact=true`);

    expect(res.status).toBe(200);
    const body = await res.json();
    const payload = body.stores[0].raw.sessions[0].events[0].data;
    expect(body.redaction.applied).toBe(true);
    expect(body.redaction.rules).toEqual(["home-path", "project-path", "long-payload"]);
    expect(payload).toContain("<HOME>");
    expect(payload).toContain("<PROJECT_PATH>");
    expect(payload).toContain("<TRUNCATED:");
    expect(payload).not.toContain("/secret/project");
    expect(payload.length).toBeLessThan(500);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/analytics/insight-cors.test.ts
```

Expected: raw export tests fail because `raw` is still `null` and redaction is not applied.

- [ ] **Step 4: Add raw session collection**

Add near `apiSessionEvents(...)`:

```js
function exportRawSessions() {
  const sessions = [];
  for (const f of listDBFiles(ACTIVE_SESSION_DIR)) {
    const dbHash = f.name.replace(".db", "");
    const db = openDB(f.path);
    if (!db) continue;
    try {
      const metaRows = safeAll(db,
        `SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
         FROM session_meta ORDER BY started_at DESC`);
      const resumeRows = safeAll(db,
        `SELECT session_id, snapshot, event_count, consumed FROM session_resume`);
      const resumeBySession = new Map(resumeRows.map((row) => [row.session_id, row]));
      for (const meta of metaRows) {
        const events = safeAll(db,
          `SELECT id, type, category, priority, data, source_hook, created_at
           FROM session_events WHERE session_id = ? ORDER BY id ASC`, [meta.session_id]);
        sessions.push({
          dbHash,
          id: meta.session_id,
          projectDir: meta.project_dir,
          startedAt: meta.started_at,
          lastEventAt: meta.last_event_at,
          eventCount: meta.event_count,
          compactCount: meta.compact_count,
          events,
          resume: resumeBySession.get(meta.session_id) || null,
        });
      }
    } finally {
      db.close();
    }
  }
  return sessions.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")) || String(a.id).localeCompare(String(b.id)));
}
```

Update `exportOneStore(...)`:

```js
    const raw = options.mode === "raw" ? { sessions: exportRawSessions() } : null;
    return {
      store,
      summary: {
        overview: apiOverview(),
        analytics,
        categoryAnalytics,
      },
      problems,
      sessions,
      raw,
      warnings: [],
    };
```

- [ ] **Step 5: Add deterministic redaction**

Add above `apiExport(...)`:

```js
function collectProjectRoots(exportBody) {
  const roots = new Set();
  for (const entry of exportBody.stores || []) {
    for (const session of entry.sessions || []) {
      if (session.projectDir && session.projectDir !== UNKNOWN_PROJECT_KEY) roots.add(session.projectDir);
    }
    for (const session of entry.raw?.sessions || []) {
      if (session.projectDir && session.projectDir !== UNKNOWN_PROJECT_KEY) roots.add(session.projectDir);
    }
  }
  return [...roots].sort((a, b) => b.length - a.length);
}

function redactString(value, projectRoots) {
  let next = value;
  const rules = new Set();
  const home = homedir();
  if (home && next.includes(home)) {
    next = next.split(home).join("<HOME>");
    rules.add("home-path");
  }
  for (const root of projectRoots) {
    if (root && next.includes(root)) {
      next = next.split(root).join("<PROJECT_PATH>");
      rules.add("project-path");
    }
  }
  if (next.length > 500) {
    const originalLength = next.length;
    next = `${next.slice(0, 240)} <TRUNCATED:${originalLength - 480} chars> ${next.slice(-240)}`;
    rules.add("long-payload");
  }
  return { value: next, rules };
}

function redactExportValue(value, projectRoots, appliedRules) {
  if (typeof value === "string") {
    const redacted = redactString(value, projectRoots);
    for (const rule of redacted.rules) appliedRules.add(rule);
    return redacted.value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactExportValue(item, projectRoots, appliedRules));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = redactExportValue(child, projectRoots, appliedRules);
    }
    return out;
  }
  return value;
}

function applyExportRedaction(exportBody) {
  const appliedRules = new Set();
  const projectRoots = collectProjectRoots(exportBody);
  const redacted = redactExportValue(exportBody, projectRoots, appliedRules);
  redacted.redaction = {
    applied: appliedRules.size > 0,
    rules: ["home-path", "project-path", "long-payload"].filter((rule) => appliedRules.has(rule)),
  };
  return redacted;
}
```

Update `apiExport(...)` so it builds a body, then applies redaction:

```js
  const body = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: {
      store: options.store || stores[0]?.id || "default",
      mode: options.mode,
      redact: options.redact,
    },
    redaction: {
      applied: false,
      rules: [],
    },
    stores: stores.map((store) => exportOneStore(store, options)),
  };
  return ok(options.redact ? applyExportRedaction(body) : body);
```

- [ ] **Step 6: Run raw/redaction tests**

Run:

```bash
npm test -- tests/analytics/insight-cors.test.ts
```

Expected: all export API tests pass.

- [ ] **Step 7: Commit**

```bash
git add insight/server.mjs tests/analytics/insight-cors.test.ts
git commit -m "feat: export raw Insight data"
```

## Task 4: Add Export API Client Types

**Files:**
- Modify: `insight/src/lib/api.ts`
- Test: `tests/core/cli.test.ts`

- [ ] **Step 1: Add source-level client contract test**

Add to `tests/core/cli.test.ts` in an appropriate `describe` block:

```ts
  it("Insight API client exposes export helpers", () => {
    const src = readFileSync(resolve(ROOT, "insight", "src", "lib", "api.ts"), "utf-8");
    expect(src).toContain("export interface InsightExportData");
    expect(src).toContain("buildExportUrl");
    expect(src).toContain("exportData:");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/core/cli.test.ts
```

Expected: fails because export types/helpers are not present.

- [ ] **Step 3: Add export types and client helpers**

In `insight/src/lib/api.ts`, after `StoresData`, add:

```ts
export type ExportMode = "summary" | "raw";
export type ExportStore = string | "all";

export interface InsightExportProblem {
  id: string;
  severity: "fix" | "warn" | "info" | "nice";
  title: string;
  metric?: { value: number | string; unit: string };
  evidence: { kind: string; storeId: string; sessionId?: string; detail: string }[];
  suggestedAction: string;
  affected: { sessions?: number; files?: string[] };
}

export interface InsightExportData {
  schemaVersion: number;
  generatedAt: string;
  scope: { store: string; mode: ExportMode; redact: boolean };
  redaction: { applied: boolean; rules: string[] };
  stores: {
    store: ContextStore;
    summary: {
      overview: OverviewData;
      analytics: AnalyticsData;
      categoryAnalytics: CategoryAnalyticsData;
    };
    problems: InsightExportProblem[];
    sessions: Array<SessionMeta & { dbHash: string; warningFlags: string[] }>;
    raw: null | { sessions: unknown[] };
    warnings: string[];
  }[];
}

export interface ExportOptions {
  store: ExportStore;
  mode: ExportMode;
  redact: boolean;
}

export function buildExportUrl(options: ExportOptions): string {
  const params = new URLSearchParams({
    store: options.store,
    mode: options.mode,
    redact: String(options.redact),
  });
  return `${API}/export?${params.toString()}`;
}
```

Add to `api`:

```ts
  exportData: (options: ExportOptions) =>
    fetch(buildExportUrl(options)).then(r => r.json() as Promise<InsightExportData>),
```

- [ ] **Step 4: Run the client contract test**

Run:

```bash
npm test -- tests/core/cli.test.ts
```

Expected: test passes.

- [ ] **Step 5: Commit**

```bash
git add insight/src/lib/api.ts tests/core/cli.test.ts
git commit -m "feat: add Insight export API client"
```

## Task 5: Add Export Page and Navigation

**Files:**
- Modify: `insight/src/routes/__root.tsx`
- Create: `insight/src/routes/export.tsx`
- Generated: `insight/src/routeTree.gen.ts`
- Test: `tests/core/cli.test.ts`

- [ ] **Step 1: Add source-level UI tests**

Add to `tests/core/cli.test.ts`:

```ts
  it("Insight UI exposes an Export route in the sidebar", () => {
    const root = readFileSync(resolve(ROOT, "insight", "src", "routes", "__root.tsx"), "utf-8");
    expect(root).toContain('to: "/export"');
    expect(root).toContain('label: "Export"');
  });

  it("Insight export route provides preview, download, and API URL controls", () => {
    const route = readFileSync(resolve(ROOT, "insight", "src", "routes", "export.tsx"), "utf-8");
    expect(route).toContain("Preview JSON");
    expect(route).toContain("Download JSON");
    expect(route).toContain("Copy API URL");
    expect(route).toContain("Redact sensitive data");
    expect(route).toContain("buildExportUrl");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/core/cli.test.ts
```

Expected: fails because `/export` route and nav do not exist.

- [ ] **Step 3: Add sidebar nav item**

In `insight/src/routes/__root.tsx`, change the icon import:

```ts
import { Database, Brain, History, Search, Building2, HardDrive, Download } from "lucide-react";
```

Add to `NAV` before Enterprise:

```ts
  { to: "/export", label: "Export", icon: Download },
```

- [ ] **Step 4: Create export route**

Create `insight/src/routes/export.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clipboard, Download, Eye } from "lucide-react";
import { api, buildExportUrl, type ContextStore, type ExportMode, type InsightExportData } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Route = createFileRoute("/export")({ component: ExportPage });

function exportFilename(store: string, mode: ExportMode, redact: boolean): string {
  const date = new Date().toISOString().slice(0, 10);
  return `context-mode-insight-${store}-${mode}${redact ? "-redacted" : ""}-${date}.json`;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ExportPage() {
  const [stores, setStores] = useState<ContextStore[]>([]);
  const [store, setStore] = useState<string>(() => globalThis.localStorage?.getItem("ctx-insight-store") || "");
  const [mode, setMode] = useState<ExportMode>("summary");
  const [redact, setRedact] = useState(false);
  const [preview, setPreview] = useState<InsightExportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.stores().then((data) => {
      setStores(data.stores);
      if (!store && data.stores[0]) setStore(data.stores[0].id);
    }).catch(() => setStores([]));
  }, []);

  const effectiveStore = store || stores[0]?.id || "all";
  const url = useMemo(() => buildExportUrl({ store: effectiveStore, mode, redact }), [effectiveStore, mode, redact]);
  const selectedCount = effectiveStore === "all" ? stores.length : 1;

  async function previewJson() {
    setLoading(true);
    try {
      setPreview(await api.exportData({ store: effectiveStore, mode, redact }));
    } finally {
      setLoading(false);
    }
  }

  async function downloadExport() {
    setLoading(true);
    try {
      const data = await api.exportData({ store: effectiveStore, mode, redact });
      downloadJson(exportFilename(effectiveStore, mode, redact), data);
      setPreview(data);
    } finally {
      setLoading(false);
    }
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(`${globalThis.location.origin}${url}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Export</h2>
        <p className="text-sm text-muted-foreground mt-1">Structured JSON export for analysis and issue triage</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Export Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Store</span>
              <select value={effectiveStore} onChange={(event) => setStore(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm">
                <option value="all">All stores ({stores.length})</option>
                {stores.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label} ({candidate.sessionDbs + candidate.contentDbs})
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mode</span>
              <div className="grid grid-cols-2 rounded-lg border border-input overflow-hidden">
                {(["summary", "raw"] as const).map((candidate) => (
                  <button key={candidate} type="button" onClick={() => setMode(candidate)} className={`h-8 text-sm ${mode === candidate ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                    {candidate}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-end gap-2 text-sm">
              <input type="checkbox" checked={redact} onChange={(event) => setRedact(event.target.checked)} className="mb-2 size-4 accent-primary" />
              <span className="pb-1.5">Redact sensitive data</span>
            </label>
          </div>

          {mode === "raw" && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Raw exports can include local paths, prompts, tool payloads, and resume snapshots.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{selectedCount} store{selectedCount === 1 ? "" : "s"}</Badge>
            <Badge variant="secondary">{mode}</Badge>
            {redact && <Badge variant="outline">redacted</Badge>}
          </div>

          <div className="rounded-lg border border-border bg-background p-3 font-mono text-xs text-muted-foreground break-all">
            {url}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={previewJson} disabled={loading} variant="secondary"><Eye /> Preview JSON</Button>
            <Button onClick={downloadExport} disabled={loading}><Download /> Download JSON</Button>
            <Button onClick={copyUrl} disabled={loading} variant="outline"><Clipboard /> {copied ? "Copied" : "Copy API URL"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[520px] rounded-lg border border-border bg-background p-4">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
              {preview ? JSON.stringify(preview, null, 2) : "No preview loaded."}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Run build to generate route tree**

Run:

```bash
npm run build
```

Expected: build passes and updates `insight/src/routeTree.gen.ts` if needed.

- [ ] **Step 6: Run UI source tests**

Run:

```bash
npm test -- tests/core/cli.test.ts
```

Expected: route/nav/source tests pass.

- [ ] **Step 7: Commit**

```bash
git add insight/src/lib/api.ts insight/src/routes/__root.tsx insight/src/routes/export.tsx insight/src/routeTree.gen.ts tests/core/cli.test.ts
git commit -m "feat: add Insight export page"
```

## Task 6: Final Verification and Bundle Refresh

**Files:**
- Modify if generated: `cli.bundle.mjs`, `server.bundle.mjs`, `ctx.bundle.mjs`, `hooks/*.bundle.mjs`, `insight/src/routeTree.gen.ts`

- [ ] **Step 1: Run focused API and UI tests**

Run:

```bash
npm test -- tests/analytics/insight-cors.test.ts tests/core/cli.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run full build**

Run:

```bash
npm run build
```

Expected: TypeScript, bundling, bundle assertions, and asymmetric drift checks pass.

- [ ] **Step 3: Smoke-test the running dashboard**

Start or reuse Insight, then verify:

```bash
node cli.bundle.mjs insight --port 4747
```

Expected: server starts or reuses a healthy server.

Open `http://localhost:4747/export` and verify:

- Sidebar contains `Export`.
- Export page loads.
- `Preview JSON` returns JSON with `schemaVersion: 1`.
- `Download JSON` triggers a JSON file download.
- `Copy API URL` copies a URL containing `/api/export`.
- `mode=raw` shows the warning.
- Redaction checkbox changes the API URL.

- [ ] **Step 4: Verify direct API URLs**

Run:

```bash
curl -s "http://127.0.0.1:4747/api/export?store=all&mode=summary&redact=false" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(j.schemaVersion, j.stores.length, j.scope.mode)})'
```

Expected output shape:

```text
1 <positive store count> summary
```

Run:

```bash
curl -i -s "http://127.0.0.1:4747/api/export?mode=bogus" | sed -n '1,8p'
```

Expected: HTTP status line contains `400`, body contains `invalid export mode`.

- [ ] **Step 5: Commit generated artifacts if build changed them**

If `git status --short` shows generated bundle or route tree changes not already committed:

```bash
git add cli.bundle.mjs server.bundle.mjs ctx.bundle.mjs hooks/*.bundle.mjs insight/src/routeTree.gen.ts
git commit -m "build: refresh Insight export artifacts"
```

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short --branch
git log --oneline --decorate --max-count=8
```

Expected: clean worktree, new implementation commits above the design and plan commits.

## Self-Review

- Spec coverage:
  - Stable `/api/export` endpoint: Task 1 and Task 2.
  - One store and all stores: Task 2 tests and implementation.
  - `summary` and `raw`: Task 2 and Task 3.
  - Optional redaction: Task 3.
  - Machine-readable problems: Task 2.
  - Export page with preview/download/copy: Task 5.
  - Error handling: Task 1 and Task 3.
  - Tests and verification: Tasks 1-6.
- Completeness scan: no incomplete sections, deferred work markers, or missing command expectations.
- Type consistency: API `ExportMode`, `ExportOptions`, `InsightExportData`, and route usage use the same property names as the server response.
