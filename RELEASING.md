# Releasing `@databehave/schema` and `@databehave/server`

Release process for this repository. Both packages publish together via
`.github/workflows/release.yml`. Branch convention: commit straight to `main`; no
feature branches.

## Pre-flight checklist

From the repository root (where `pnpm-workspace.yaml` lives):

1. **Privacy leak scan** (mandatory — see workspace `.github/copilot-instructions.md`
   "Public-repo privacy" for the canonical rule and forbidden-token list):

   ```sh
   git grep -niEf <(grep -vE '^(#|$)' /path/to/.github/private-tokens.txt) \
     -- ':!*.lock' ':!*-lock.yaml' ':!*-lock.json' ':!yarn.lock' \
        ':!package-lock.json' ':!pnpm-lock.yaml' \
     && echo "LEAK — abort" || echo "clean"
   git log --all --format=%B \
     | grep -niEf <(grep -vE '^(#|$)' /path/to/.github/private-tokens.txt) \
     && echo "LEAK in commit msgs — abort" || echo "clean"
   ```

   Both must print `clean`. Any hit is a HARD BLOCK.

2. **Local gates green:**

   ```sh
   pnpm install --frozen-lockfile
   pnpm -r run typecheck && pnpm -r run build && pnpm -r run test
   pnpm lint && pnpm format:check && pnpm pack:check && pnpm api:check
   ```

3. **Pre-publish smoke** against the FE mock server (per workspace
   `.github/copilot-instructions.md`): swap the consumer's `@databehave/schema`
   and/or `@databehave/server` deps to `link:` of this checkout, `yarn install`,
   then `yarn start` + `yarn test`. No regressions.

4. **CHANGELOGs and versions bumped** in `packages/*/package.json` and
   `CHANGELOG.md`. Semver: additive → minor; bug fix → patch; breaking → major.

## Trigger

GitHub → Actions → `release` → Run workflow.

1. First run with `dry_run: true`. Runs typecheck, build, test, `npm audit
   signatures`, SBOM generation, and uploads the SBOM artefact. Does NOT publish.
2. Second run with `dry_run: false`. Same steps; only the final publish step
   gates on `dry_run == false`. Requires `secrets.NPM_TOKEN`; provenance uses
   GitHub OIDC (`permissions.id-token: write`).

## Provenance

Both packages declare `publishConfig.provenance: true`. The workflow publishes via:

```sh
pnpm -r publish --provenance --access public --no-git-checks
```

A local dry-run was verified clean (`exit 0`) — pnpm forwards `--provenance` to
the underlying npm publish. If a future pnpm version silently drops it, swap to
`pnpm -r exec npm publish --provenance --access public --no-git-checks` and
record the reason in the same commit. Consumers verify with:

```sh
npm view @databehave/schema --json | jq .dist.attestations
npm view @databehave/server --json | jq .dist.attestations
```

Empty `attestations` means provenance was not emitted — investigate.

## Post-publish: deprecate legacy packages

After the first stable `@databehave/*` release, redirect consumers off the
standalone predecessors:

```sh
npm deprecate "databehave@<=0.3.0" \
  "Use @databehave/schema and/or @databehave/server instead."
npm deprecate "databehave-kit@<=0.6.0" \
  "Use @databehave/schema and/or @databehave/server instead."
```

Adjust the version range to whatever was the final standalone release.
