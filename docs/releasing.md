# Releasing Databehave

The upcoming release supports Node 24.22.1+ within 24.x and Node 26.12.1+ within 26.x.
Node 25, older majors, and releases below these security patch floors are unsupported.
Use the latest security patch within a supported major. Raise the engine floors and pinned CI versions when
new Node security releases require it; a maintained major alone does not establish that an older patch is secure.
The workspace enables pnpm engine enforcement so unsupported runtimes fail dependency installation.
Package engines explicitly select the supported even-numbered majors; a new major needs CI evidence before inclusion.
Development and release preparation use Node 24.22.1. Publication uses its bundled npm 11.19.1.

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

Ordinary push and pull-request CI accepts package versions that are already published: it prepares and verifies the
bundle without running npm publication preflight. The manual release workflow enables the reusable workflow's
`release-preflight` input for both dry runs and real releases. This runs `npm publish --dry-run` on the exact tarballs
before upload and fails when npm reports an existing version. Keep version availability checks in release preparation;
do not bump versions solely to make ordinary CI pass.

Package hooks do not rebuild during packing or publication. A checksum mismatch, unexpected file, unsafe archive path,
link, changed metadata, wrong revision or incomplete package set fails verification before publication begins.
SHA hashes detect changed bytes; the trusted producing workflow and exact same-run artifact identify their source.
They do not establish that arbitrary package code is benign.

## Dependency signature scope

`pnpm signatures:check` projects every exact registry identity from `pnpm-lock.yaml` into an isolated, metadata-only
npm tree, including aliases and platform alternatives. The pinned npm 11.19.1 CLI verifies registry signatures and
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
```

Preparation requires an empty output directory and existing builds. It never overwrites a previous bundle. Keep an
existing bundle until publication and recovery decisions are complete; use a new directory for another experiment.
For a planned release with new package versions, also run:

```sh
pnpm release:dry-run artifacts/release "$SOURCE_REVISION"
```

Dry run executes npm's publish preparation on every exact tarball with lifecycle scripts disabled and no registry write.
It reads registry metadata and can reject already-published versions, so it is not an offline package check.
It cannot prove authentication, package ownership, environment protection, or a successful OIDC exchange.

## Operator prerequisites

Before enabling real publication, an operator must configure the GitHub `npm` environment with appropriate reviewer
and main-branch protection, and protect changes to the release workflows and scripts. Defining `environment: npm`
in YAML does not establish those external protections. No workflow in this repository creates them.

Configure npm trusted publishing separately for **each** of the six packages: repository `ochairo/databehave`, workflow
`cd.yml`, environment `npm`, on GitHub-hosted runners. Explicitly permit direct publishing; newer npm publisher
configurations default to staged publishing. Packages must exist on npm before trusted publishing can be configured;
use the explicit bootstrap procedure below for their first release. The default OIDC mode has no token fallback.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for current setup requirements.

The default workflow mode uses npm OIDC and provenance; it requires no `NPM_TOKEN` secret. Only the final publishing job receives
`id-token: write`. That job performs no dependency installation, build, consumer execution or package lifecycle hooks.
Helpers come from the checked-out source revision, never from executable files inside the downloaded artifact.

## First release with a temporary token

When packages do not exist yet, use `bootstrap: true` to enable token authentication for the first release. This mode
publishes all six versions from the same CI-verified bundle, including new versions of existing packages. It does not
skip already published versions or retry a failed publication. The pinned npm CLI may prefer OIDC where trust is already
configured; the token supplies authentication for packages without that trust.

1. Create a short-lived npm granular access token with **Packages and scopes: Read and write (publish and stage)**
   for the `@databehave` scope and **Bypass two-factor authentication** for unattended publication. The account must
   have permission to create and publish packages in that scope; organization-management permission alone is insufficient.
2. Store it as the GitHub secret `NPM_TOKEN`, preferably in the protected `npm` environment. A repository secret with
   that name also works. Never put the token in a workflow input, source file, or command argument.
3. Run `cd.yml` on reviewed `main` with `dry_run: true`. This validates the bundle but does not test credentials.
4. For actual first publication, run `cd.yml` on the same reviewed revision with `dry_run: false` and `bootstrap: true`.
   Approve the environment deployment if required. A missing secret stops before any package is published.
5. After all six packages are published, configure each package's trusted publisher as described above, revoke the npm
   token, and delete the GitHub secret. Leave `bootstrap: false` for subsequent releases with new package versions.

Only the bootstrap publishing step receives the token; CI and the default OIDC publishing step do not. Both modes retain
artifact verification, provenance, disabled lifecycle scripts, and the same release gates. If publication fails, follow
the partial-publication procedure below before another attempt. See [npm token permissions](https://docs.npmjs.com/creating-and-viewing-access-tokens/)
and [npm CI/CD authentication](https://docs.npmjs.com/using-private-packages-in-a-ci-cd-workflow/) for current requirements.

## Manual release

Run [cd.yml](../.github/workflows/cd.yml) from the reviewed `main` revision with its default `dry_run: true` first.
It invokes the same-revision reusable CI workflow with npm publication preflight enabled and retains the validated bundle.
Existing package versions fail preflight without publication. Real publication requires an
explicit dispatch with `dry_run: false`, `bootstrap: false` for OIDC, and any configured environment approval. It reruns the gates, then publishes
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
Its npm entry targets only the workspace root, which owns the shared lockfile and member manifests. Node typings stay
on the oldest supported runtime major; Dependabot can update their minor and patch versions but ignores major updates.
When changing that baseline, update all Node typings declarations and the shared lockfile together. Existing member-only
update PRs with stale lockfiles must be replaced or reconciled with the root workspace before merging.
Update the Node release-toolchain pin and expected bundled npm version together after checking both versions.
Update cdxgen's exact devDependency and lockfile together; preparation verifies the installed version.
The [actionlint installer](../scripts/install-actionlint.mjs) pins the official release and both Linux binary checksums.
Update those together from the upstream release, then run `pnpm workflow:check` on all workflows.
Run package consumers on Node 24 and 26 after changes to packing, exports, runtime support or release verification.
