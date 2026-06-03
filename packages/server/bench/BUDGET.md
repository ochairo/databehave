# Performance budget

This budget is the regression gate for `@databehave/server`. The numbers
below are **placeholders** — owner refines after the first local run on
the reference machine. The intent is to lock in a target shape now so a
later perf regression has somewhere to land.

## Scenarios

| scenario                                  | p50 target | p95 target | regression threshold |
| ----------------------------------------- | ---------- | ---------- | -------------------- |
| `static OAS load + 1k mock responses`     | TBD ms     | TBD ms     | +20 % vs baseline    |
| `seeded deterministic mock(schema) ×1k`   | TBD ms     | TBD ms     | +20 % vs baseline    |
| `proxy validation overhead` (phase-2 #7)  | n/a        | n/a        | activated with #7    |

## How to run

```sh
pnpm --filter @databehave/server bench
```

vitest auto-detects `*.bench.ts` files; no separate config is required.
Output is human-readable today.

## Notes

- Numbers above are placeholders. The owner runs the bench locally on
  the reference machine and replaces `TBD` with measured values
  (`p50` = median, `p95` = 95th percentile across iterations).
- CI wiring (a `bench` job that fails the build on a > 20 % regression)
  is a follow-up. For now bench runs locally; results land in PR
  descriptions when relevant.
- The seeded scenario is the canonical determinism budget: any
  regression there means the deterministic mock path got slower, which
  is a stronger signal than the unseeded one.
- The proxy row is reserved so the table shape is stable when phase-2
  item #7 (validation-proxy mode) ships.
