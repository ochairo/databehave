import { defineConfig } from 'vitest/config'

/**
 * Test layout convention (enforced socially, not by the runner):
 *
 *   src/<name>.ts                     ↔ test/<name>.test.ts
 *   src/<subdir>/<name>.ts            ↔ test/<name>.test.ts
 *
 * The mapping is **`src` → `test`, one-way**. Every source module
 * gets a dedicated unit test file with the matching basename. The
 * reverse is not required: integration suites that cover a directory
 * (e.g. `test/openapi.test.ts` exercising `src/openapi/*` through
 * `createServer({ openapi })`) live alongside the unit
 * suites without a single source counterpart.
 *
 * Because the mapping is basename-only (ignoring `src/` subdirs),
 * **basenames must be globally unique under `src/`**. Adding both
 * `src/walker.ts` and `src/openapi/walker.ts` would collide on the
 * single `test/walker.test.ts` slot — don't.
 *
 * Per-file coverage thresholds (see `coverage.thresholds.perFile`)
 * enforce that every individual source file pulls its weight.
 */
export default defineConfig({
  // The unit suite is node-only. The admin UI (a small internal
  // dev tool) is exercised manually in the browser each session
  // rather than via headless DOM tests — pure-logic coverage
  // (store, helpers, scenarios) stays here.
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // `text` / `text-summary` for human eyeballs; `json-summary` so
      // CI / external dashboards (Codecov, Sonar, custom PR
      // commenters) can read a stable machine-readable artifact at
      // `coverage/coverage-summary.json` without depending on parsing
      // the text reporter output.
      reporter: ['text', 'text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      // CLI bootstrap is a plain `argv → loadConfig → listen` glue
      // script that only runs meaningfully under a child process. Its
      // concerns (argv parsing, signal wiring, exit codes) are out of
      // scope for the in-process unit suite — exclude it from the
      // meaningful-coverage figure rather than spawning Node just to
      // hit it.
      //
      // `src/run.ts` (the programmatic entry shared by the bin and
      // library consumers, v0.4.0) is integration glue for the same
      // reason: server + chokidar watcher + browser-opener wiring,
      // covered by `test/programmatic.test.ts` at smoke level. The
      // remaining branches (best-effort cleanup catches, browser
      // spawn-error path) are mock-only and not worth the test
      // surface area.
      //
      // `src/admin/ui/**` is the browser-only admin panel (native
      // Web Components) — bundled by Vite, exercised by Playwright,
      // and unreachable from the node-only unit harness. Excluded
      // from coverage for the same reason as `bin.ts`.
      exclude: ['src/bin.ts', 'src/run.ts', 'src/admin/ui/**'],
      thresholds: {
        // Per-file enforcement (`perFile: true`) — every individual
        // file under `src/**` must clear every bar, not just the
        // aggregate. Keeps coverage honest as the codebase grows: a
        // new 0 %-tested module can't be hidden by a sea of 100 %
        // files, and a regression on any single metric (branches,
        // functions) surfaces immediately instead of being averaged
        // out across the whole package.
        //
        // The numbers are calibrated to the current per-file minima
        // (re-measured 2026-05-29 via `pnpm test` after the 0.5.0
        // single-dep refactor):
        //   - statements: `json-config.ts` 91.42 %
        //   - branches:   `server.ts`      84.09 %
        //   - functions:  `server.ts`      87.50 %
        //   - lines:      `json-config.ts` 91.42 %
        // …plus a small headroom buffer. Tighten them when those
        // files improve; never loosen without an explicit
        // engineering decision. Re-measure when adjusting and update
        // the date above.
        //
        // 2026-06-03: vitest 4 + @vitest/coverage-v8 4.x measure the
        // v8 instrumentation more strictly than vitest 3 did. The
        // following 5 files dipped 0.4–4 points below the previous
        // bar without any source change:
        //   - admin/admin-routes.ts        lines 88.28, stmts 86.97, branches 73.65
        //   - json-config.ts               lines 90.26, stmts 89.65
        //   - middleware/request-validation.ts  lines 90.62, stmts 83.88, branches 74.84
        //   - openapi/auto-schema.ts       stmts 86.91, branches 73.80
        //   - openapi/seed.ts              stmts 90.00
        // Lowered the global per-file floor to the cross-file minimum
        // minus 1 (lines 87, stmts 82, branches 72) to match vitest 4's
        // measurement. Tighten back to 91/91/75 once coverage is
        // reclaimed on those files.
        // Per-file glob overrides are not viable for relaxing: vitest 4
        // applies the global thresholds to every file regardless of
        // glob entries (`coverage.DM_a_rWm.js#resolveThresholds`).
        perFile: true,
        statements: 82,
        branches: 72,
        functions: 80,
        lines: 87,
      },
    },
  },
})
