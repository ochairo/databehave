# Releasing Databehave

The upcoming release supports Node 24 and 26. Node 18, 20 and 22 are no longer supported.
Package engines explicitly select the supported even-numbered majors; a new major needs CI evidence before inclusion.
Development and release preparation use Node 24.21.0. Publication uses its bundled npm 11.19.0.

## Release ownership

Package manifests own versions, dependency ranges, exports and engine requirements. Each package's `CHANGELOG.md`
describes its upcoming changes; [the migration guide](../MIGRATION.md) owns breaking migration instructions.
The public package set and dependency order are owned by [release.mjs](../scripts/release.mjs).
API reports describe exported types and are checked with `pnpm api:check`; update them deliberately with `pnpm api:update`.

Before release, review all six versions and changelogs together. Breaking changes before 1.0 use a minor version bump;
after 1.0 they require a major bump. Update dependent ranges in the same change. Record release dates only when the
release is actually made. Package names/versions already published to npm cannot be overwritten or reused.

## What CI proves

[ci.yml](../.github/workflows/ci.yml) builds, typechecks and tests source on Node 24 and 26. Its quality job checks npm registry signatures, lint,
public API reports, documentation links, runnable examples, workflow syntax and headless browser behavior. It builds
the release output once, packs each package once, and creates a CycloneDX SBOM with a lockfile-pinned cdxgen version.
The SBOM describes the workspace dependency inventory; it is not proof that dependencies or package contents are safe.

The release bundle contains six tarballs, `sbom.cdx.json` and `release-manifest.json`. The manifest records the source
revision, package identities and dependency order, SHA-256 digests, SHA-512 integrity values and SBOM tool identity.
Consumers on both supported Node versions verify and run those exact tarballs without installing workspace dependencies.
They cover schema-only, HTTP-only, schema-free OpenAPI providers, full composition and CLI startup.

Package hooks do not rebuild during packing or publication. A checksum mismatch, unexpected file, unsafe archive path,
link, changed metadata, wrong revision or incomplete package set fails verification before publication begins.
SHA hashes detect changed bytes; the trusted producing workflow and exact same-run artifact identify their source.
They do not establish that arbitrary package code is benign.

## Dependency signature scope

`pnpm signatures:check` projects every exact registry identity from `pnpm-lock.yaml` into an isolated, metadata-only
npm tree, including aliases and platform alternatives. The pinned npm 11.19.0 CLI verifies registry signatures and
available attestations; missing signatures, invalid signatures, network failures and incomplete coverage fail CI.
This avoids npm misreading aliased peer dependencies in pnpm’s installed tree. No packages or scripts are installed.
The invocation uses empty isolated npm configuration and does not inherit credentials or scoped registry settings.

This check authenticates registry metadata, not installed files or the lockfile digest. Frozen pnpm installation
separately checks downloaded bytes against the lockfile. These checks do not establish that the lockfile digest
equals the signed registry digest.

## Local preparation and dry run

Run these commands inside the [development container](../README.md#development), after a frozen dependency install.
Set `SOURCE_REVISION` to the full 40-character commit SHA being reviewed; it is checked for identity, not fetched.
For a real release use a clean, reviewed revision. Local dirty-worktree experiments are not release evidence.

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:tooling
pnpm lint
pnpm signatures:check
pnpm api:check
pnpm docs:check
pnpm examples:check
pnpm workflow:check
pnpm test:e2e
pnpm release:prepare artifacts/release "$SOURCE_REVISION"
pnpm release:verify artifacts/release "$SOURCE_REVISION"
pnpm pack:check artifacts/release "$SOURCE_REVISION"
pnpm release:dry-run artifacts/release "$SOURCE_REVISION"
```

Preparation requires an empty output directory and existing builds. It never overwrites a previous bundle. Keep an
existing bundle until publication and recovery decisions are complete; use a new directory for another experiment.
Dry run executes npm's publish preparation on every exact tarball with lifecycle scripts disabled and no registry write.
It cannot prove authentication, package ownership, environment protection, or a successful OIDC exchange.

## Operator prerequisites

Before enabling real publication, an operator must configure the GitHub `npm` environment with appropriate reviewer
and main-branch protection, and protect changes to the release workflows and scripts. Defining `environment: npm`
in YAML does not establish those external protections. No workflow in this repository creates them.

Configure npm trusted publishing separately for **each** of the six packages: repository `ochairo/databehave`, workflow
`cd.yml`, environment `npm`, on GitHub-hosted runners. Explicitly permit direct publishing; newer npm publisher
configurations default to staged publishing. New packages may require an operator's initial publication/registration
before their trusted-publisher settings are available. Do not add a token fallback to bypass missing configuration.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for current setup requirements.

The workflow uses npm OIDC and provenance; it requires no `NPM_TOKEN` secret. Only the final publishing job receives
`id-token: write`. That job performs no dependency installation, build, consumer execution or package lifecycle hooks.
Helpers come from the checked-out source revision, never from executable files inside the downloaded artifact.

## Manual release

Run [cd.yml](../.github/workflows/cd.yml) from the reviewed `main` revision with its default `dry_run: true` first.
It invokes the same-revision reusable CI workflow and retains the validated bundle. Real publication requires an
explicit dispatch with `dry_run: false` and any configured environment approval. It reruns the gates, then publishes
that run's verified artifact; it does not reuse a previous dry run's artifact or rebuild inside the publisher.

The publisher downloads the exact artifact ID returned by CI in the same workflow run, verifies its revision and every
file, then publishes in dependency order to npm's public registry with `latest`, provenance and scripts disabled.
Release concurrency never cancels an active publication. Jobs have explicit timeouts; a timeout may leave partial
registry success, so it must be reconciled rather than retried automatically.

Retain the workflow run ID, source SHA, artifact ID and `release-manifest.json` as release evidence. Bundles are retained
for 30 days; retain a verified copy through the required recovery period before that expiry. Browser failure artifacts
contain synthetic local test data and expire after seven days; they are not part of the publication bundle.

## Partial or uncertain publication

The first npm failure stops publication. Earlier packages may already be published, and a failed request may have
succeeded at the registry. Do not rerun the entire release or rebuild to resume it.

1. Preserve the original bundle and run identity. Reverify its source revision and digests.
2. An operator inspects each package name/version and registry `dist.integrity`, comparing it with the manifest.
3. Matching existing versions are complete. A conflicting integrity value requires investigation and a new version;
   never overwrite or unpublish as automatic rollback. Unknown outcomes remain pending until resolved.
4. After explicit authorization, publish only confirmed missing packages from the original verified tarballs, in the
   manifest's dependency order, using the approved publishing identity. The automated command intentionally has no
   skip-existing or retry mode. Follow [npm's publish contract](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

If the original bundle is unavailable, do not claim a rebuild is the same artifact. Prepare a new reviewed release
with new versions where necessary and document its relationship to the partial release.

## Updating delivery tools

Dependabot owns pnpm workspace dependencies, SHA-pinned Actions and the digest-pinned development base image.
Update the Node release-toolchain pin and expected bundled npm version together after checking both versions.
Update cdxgen's exact devDependency and lockfile together; preparation verifies the installed version.
The [actionlint installer](../scripts/install-actionlint.mjs) pins the official release and both Linux binary checksums.
Update those together from the upstream release, then run `pnpm workflow:check` on all workflows.
Run package consumers on Node 24 and 26 after changes to packing, exports, runtime support or release verification.
