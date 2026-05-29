# Contributing to databehave

Thanks for taking the time to contribute. This guide covers the local
development workflow and the conventions the project follows.

## Pre-publish smoke

`databehave` is paired with `databehave-kit`, which re-exports it as a
schema-aware mock-server toolkit. Before `git push` or `npm publish` —
for **any** change, including docs-only — smoke-test against the
wrapper:

1. Build locally: `npm run build`.
2. Link the freshly built `databehave` into a local checkout of
   `databehave-kit` via your package manager's link mechanism, then
   build `databehave-kit`.
3. Run `databehave-kit`'s typecheck and test suites against the linked
   build; all must be green.
4. Boot `databehave-kit`'s admin panel from the linked build and
   confirm it still starts and serves a schema-driven response.
5. Unlink and revert any `package.json` swaps in `databehave-kit`
   before publishing.
6. Then `git push` and `npm publish`.

No exemption for "tiny" changes — anything that affects the published
tarball can drift `databehave-kit`'s behaviour.

## Prerequisites

- **Node.js ≥ 18.17** (matches `engines.node` in `package.json`).
- **Corepack** (ships with Node ≥ 16.10). It automatically uses the
  `pnpm` version pinned in `packageManager`.

```sh
corepack enable      # one-time per Node install
```

## Setup

```sh
git clone https://github.com/ochairo/databehave.git
cd databehave
pnpm install         # honours pnpm version + sha512 from packageManager
```

## Daily workflow

| Command              | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `pnpm typecheck`     | `tsc --noEmit` over `src/` and `test/`                 |
| `pnpm test`          | Compile `test/` with `tsc`, then run `node --test`     |
| `pnpm test:watch`    | tsc + `node --test --watch` in parallel                |
| `pnpm build`         | Emit `dist/index.js` + `dist/index.d.ts`               |
| `pnpm clean`         | Remove `dist/` and `dist-test/`                        |

The test runner is `node:test` against tsc-compiled output. There is no
`tsx`, no `ts-node`, no bundler. **Keep it that way** — the project's
core promise is zero runtime dependencies.

## Project layout

```bash
src/
  foundation/   IR, types, prng, sha256, errors, axes
  schema/       primitives, decimal, composites, discriminated
  generator/    sampling engine (axis priority pipeline)
  validator/    parse / safeParse
  dataset/      dataset + identity cache
  index.ts      public surface (the only file external code imports)
test/           node:test specs, one file per src module
docs/           design, axes reference, recipes, extension API
```

## Code conventions

- **TypeScript strict**, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
  Do not weaken these flags.
- **Zero runtime dependencies.** New code must rely only on the Node
  standard library. `node:crypto` is OK; anything else must be justified.
- **Deterministic only.** Never call `Math.random()`, `Date.now()`, or
  read environment variables inside the generator. All randomness flows
  from the seeded PRNG (`mulberry32`).
- **IR is the contract.** The generator and validator operate on
  `SchemaNode` (the IR), never on builder classes. Builders are a
  user-facing convenience layer.
- **Axis priority** (see [docs/design.md](docs/design.md)) is the
  invariant of the generator. Any new axis must declare where it sits in
  the order.

## Tests

- Every new public API needs a test in `test/`.
- Tests run on the matrix Node `18.17`, `20`, `22` in CI.
- Use `replay(schema, opts)` or `expectStable(schema, opts)` to assert
  determinism; never compare against a hardcoded sample.
- Prefer many small `test()` blocks over giant ones — they're cheap and
  the diagnostics are better.

## Commit and PR conventions

- Title format: `area: short description` (e.g. `generator: fix invariant
  retry counter`).
- One topic per PR. Refactors land separately from behaviour changes.
- Update `CHANGELOG.md` under `[Unreleased]` for any user-visible change.
- All CI jobs must be green before review.

## Releasing (maintainers)

1. Update `CHANGELOG.md`: move `[Unreleased]` entries under a new version
   heading with today's date.
2. Bump `package.json` `version`.
3. Commit: `chore(release): vX.Y.Z`.
4. Tag: `git tag vX.Y.Z && git push --tags`.
5. The `publish.yml` workflow verifies the tag matches `package.json`,
   runs the test matrix, builds, and publishes with `--provenance`.

## Reporting issues

- Bugs: open a GitHub issue with a minimal reproducing schema + the
  expected vs actual output.
- Security: see [SECURITY.md](SECURITY.md).
- Feature requests: open a discussion before opening a PR for anything
  that adds a new axis or changes the public surface.
