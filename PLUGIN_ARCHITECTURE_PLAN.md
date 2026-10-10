# Databehave plugin migration

Revision 4 — 2026-10-10. Starting source: `26bef3dfb81e8b59f5e340fef62efbdae77e7825`.
The user authorized implementation without further plan approval and permits breaking API/configuration changes.
This document records the intended architecture and acceptance contract; completion evidence is tracked below.

## Outcome and scope

Users compose Databehave from explicit, replaceable plugins. Official features and third-party extensions use the
same public contracts. A schema-only application needs neither HTTP nor admin assets. A minimal HTTP application
needs neither OpenAPI nor schema generation. Adding a route, schema kind, or generation behavior requires no edit
to the host or standard implementations.

Use cohesive feature boundaries. Pure helpers, individual buttons, and individual primitive types do not each
need a package or lifecycle. Standard kinds and standard behaviors may ship as grouped plugins with separate
entry points. Plugin identity and package identity are different concepts.

The core owns plugin identity, capability contracts, dependency validation, deterministic lifecycle ordering,
instance-local registration and cleanup. Feature packages own domain contracts and policy. Core must not import
HTTP, schema, OpenAPI, admin, filesystem persistence, or configuration-file implementations.

Breaking changes are explicit: replace feature-specific top-level configuration with plugin composition; do not
maintain a second legacy assembly path. Preserve valuable behavior, data and security boundaries. Publish a
migration guide and executable examples. No commits, publication, deployment or remote writes are authorized.

## Source findings

- `packages/server/src/server.ts` constructs feature stores, composes hooks, indexes OpenAPI routes and owns
  admin-specific transport decisions. `json-config.ts` is a second feature composition owner.
- Schema kinds, behaviors, traversal, reconstruction, validation and serialization are closed switches spread
  across `foundation`, `generator` and `validator`. Current extension helpers only compose existing kinds.
- OpenAPI placeholder and schema-backed generation have distinct useful policies; retain them as explicitly
  selectable strategies. One OpenAPI catalog should own operation/status selection and expose route metadata.
- Admin UI/API, override state and scenario persistence have separate responsibilities. They may ship together
  initially but communicate through explicit interfaces. HTTP must not depend on admin implementation details.
- Existing docs contain disagreements about determinism and some request behavior. Source and focused behavior
  checks establish the baseline; document intentional deltas instead of treating stale prose as authoritative.

## Public contracts

### Plugin host

- Explicit ESM imports and plugin factories; package installation remains the package manager's responsibility.
- Each plugin declares a unique ID, host API version, provided capabilities and required capabilities.
- Capabilities use typed public tokens with stable names and an API version. Runtime checks reject duplicate
  providers, missing/incompatible requirements and cycles before activation. Requirements refer to capabilities,
  allowing one implementation to replace another without pretending to have its plugin ID.
- Registration is instance-local. No global registry, implicit import-side-effect registration or unrestricted
  string-based service locator. Plugins may consume only declared requirements and provide declared capabilities.
- Separate registration, preparation and external exposure. All feature contributions must be registered before
  compilation/indexing; network ingress must start after feature preparation. The implementation must demonstrate
  these ordering guarantees, rather than assuming dependency order alone gives a safe listener lifecycle.
- Cleanup is registered at resource acquisition, including partially failed startup. Close is idempotent and shares
  one pending completion across callers. Stop ingress and cancel/drain work before disposing dependent state.
  Continue cleanup after a disposer fails and report aggregate errors. A failed instance is terminal; retry with
  a fresh instance. No hot reload or live plugin replacement in this migration.

### Schema runtime

- Keep the schema runtime usable without an HTTP host; the same instance-scoped registry and plugin contracts
  are used by standalone schema composition and the application adapter.
- A kind registration owns metadata validation, generation, value validation, child enumeration and reconstruction.
  Standard primitives/composites register through this public mechanism. Unknown kinds fail explicitly.
- A behavior registration owns applicability, merge semantics, generation/validation participation and serialization.
  Standard distributions, domains, modifiers, derived values, cadence and invariants use that extension surface.
- Preserve static inference through generic builders and typed registration; deserialize external data from
  `unknown` with validation. Do not require subclassing internal builders or introduce public `any` contracts.
- Version serialized IR and identify required kind/behavior contracts. Reject missing/incompatible registrations
  and closure-bearing serialized behavior. Do not silently discard unsupported data or mutate existing files.
- Seeded output is deterministic for the same schema, options, plugin implementations/versions and supported
  runtime conditions. Trace/replay records relevant contracts. Preserve existing seeded fixtures unless a tested,
  documented semantic correction requires a change. No cross-version/cross-platform guarantee beyond evidence.

### HTTP and feature plugins

- HTTP owns request/response types, route registration/catalog, dispatch, named middleware stages, transport
  capabilities, request cancellation and HTTP semantics. Node listener ownership is separated from feature policy.
- Explicit routes win over generated defaults; equal-priority duplicate routes fail with both owners identified.
  Exact paths precede parameterized routes. Parameterized ties have a documented deterministic order.
- Request stages specify preflight, validation, interception, handler execution, response decoration, errors and
  final observation. Dependency order does not implicitly determine request middleware order. HEAD invokes the
  effective handler once and produces one access observation. Short circuits and error responses have defined
  decoration behavior, tested across fetch and actual HTTP.
- Transport faults use an HTTP-owned terminal outcome/capability, never an admin sentinel imported by the listener.
  Delay and hang honor cancellation; shutdown has a bounded drain policy so fault injection cannot prevent exit.
- OpenAPI owns one parsed document/catalog, operations, status selection and adapters. Placeholder generation and
  schema generation are selectable providers. Request conformance remains a separate policy from mock generation.
- CORS, access logs, request validation, mock policies, fault injection and admin are explicit plugins, with their
  own options. Admin consumes the resolved route catalog and fault-control interface, not original configuration.
- Admin remains opt-in, with loopback exposure by default. Bind guards run before any listener opens. Scenario
  persistence preserves existing files and atomic replacement; extension does not authorize broader file access.
- Admin is one cohesive Web Components feature plugin. A generic browser plugin framework is unnecessary for this
  migration. Its build/assets must be optional for HTTP-only installations.

### Configuration and distribution

- Make ESM configuration the canonical composition format: explicit imports, plugin factories and typed options.
  The executable only loads the chosen config and manages host startup/signals/shutdown. No auto-discovery or
  remote package fetching. Configuration and plugin modules execute trusted application code, not sandboxed code.
- Remove legacy JSONC composition for this breaking release in favor of one explicit ESM path. Migration examples
  cover every existing feature field. No second generic plugin-resolution/configuration surface is introduced.
- Package boundaries: core runtime; schema runtime/standard plugins; HTTP runtime/common HTTP plugins; OpenAPI
  plugins; admin/fault/scenario plugins; CLI/composition. Multiple related plugins may share a package using public
  subpath exports. Avoid a package per helper. Presets are ordinary explicit composition, not privileged wiring.
- Built artifacts and public exports are the supported extension surface. Test an external fixture using packaged
  exports, including independent provider replacement. Keep plugin API version separate from package version.

## Frozen execution contracts

The host runs synchronous `setup`, then seals all registration, then awaits each of `prepare`, `activate`, and
`open` as a separate phase barrier. Within each phase, providers precede consumers; independent plugins retain
configuration order. A plugin declares `id`, `apiVersion: 1`, `provides`, `requires`, `setup`, and optional async
`prepare`, `activate`, `open` hooks. Setup may provide declared capabilities, consume declared requirements and
register synchronous seal callbacks. It performs no I/O or resource acquisition. Lifecycle contexts expose a
lifetime `signal`, `defer(dispose)` and `ownIngress(handle)` (the last only in `open`). Host construction is
synchronous; `start()` is asynchronous. Both concurrent start and close calls share their respective promises.
Capability identity is a stable name plus integer contract version, with a generic TypeScript token carrying its
value type; separately installed copies of a contract do not depend on symbol/object identity.

HTTP exposes registration during setup. Route sources declare an owner and synchronous `materialize()` function.
OpenAPI registers its source in setup, loads its one catalog and prepares generators in prepare. After every prepare
has finished, HTTP materializes every source exactly once in activate and freezes the resolved route catalog/index.
Admin reads that catalog in its activation or requests. Listener plugins open sockets only in open, after every
activation and every registered bind guard succeeds. Schema extension registrations seal before prepare.

On close or startup failure, ingress `stopAccepting()` runs first, then the host aborts its lifetime signal, then
awaits ingress `drainAndClose()`, then runs other disposers in reverse acquisition order. HTTP owns a configurable
drain deadline (default 1000 ms) and force-closes remaining connections at expiry. Cleanup continues on errors and
reports an aggregate retaining the original startup failure. Close during startup prevents later phases and cleans
resources acquired by a completing hook. Plugins must cooperate with cancellation; this is not code isolation.

Standalone `createSchemaRuntime({ kinds, behaviors })` validates/seals extension descriptors synchronously. A host
plugin provides that runtime to application consumers; standalone use needs no asynchronous application lifecycle.
Standard descriptors share the same public extension protocol as external descriptors. Schema behavior order is:
modifier short circuits; derived; cadence (`eventually` before `occasionally`); bounded invariant/rejection wrapper
around domain/distribution/type sampling. Preserve the current bypass of invariants by short-circuit results and
document it explicitly. Custom behaviors declare the phase they participate in; order within a phase is explicit
descriptor order, never module import order. Value validation is a separate operation with explicit behavior checks.

HTTP executes: route/method resolution (retain original HEAD method), preflight, validation, interception, handler,
response decoration, final observation. Preflight/validation/interception may terminate with a response. Every
response, including errors and short circuits, receives final decorators once and one observation. This deliberately
adds consistent decoration to validation/preflight responses. A failing decorator yields the error response without
re-entering decorators; observations cannot replace responses and observation failures do not fail the request.
Error handling is bounded: a failing error handler produces a generic 500, never recursive error-hook dispatch.
HEAD selects an explicit HEAD handler or effective GET handler once, then strips the body after decoration.
Transport termination is a separate terminal outcome, never a fabricated response. Stage order is fixed; within
a stage use explicit plugin composition order, independent of provider dependency order.

Scenario request/disk data is validated in full by one shared domain validator before saving or replacing active
overrides. Build the entire replacement first and swap it atomically; an invalid later entry leaves prior state
unchanged. Unsupported versions fail explicitly. File replacement failure preserves the original and cleans the
owned temporary file. Tests include null entries, mixed valid/invalid entries and malformed persisted JSON. This
addresses the independently confirmed SEC-D01 defect during extraction rather than retaining unsafe behavior.

## Implementation sequence and acceptance

| ID | Work and source owner | Dependencies | Exit evidence |
| --- | --- | --- | --- |
| P1 | Freeze contracts and resolve architecture/security review of lifecycle, imports and admin boundary | none | Concrete public types and no unresolved material design findings |
| P2 | Establish project container and baseline; add reviewed headless Playwright runner | P1 | Actual typecheck/build/test results and browser availability; record pre-existing failures |
| P3 | Implement `packages/core` plugin host and lifecycle tests | P1 | Empty host, ordering, independent instances, conflicts, cycles, failure cleanup and concurrent close |
| P4 | Refactor `packages/schema` to instance-scoped kind/behavior registries and standard plugins | P3 contract | External kind and behavior generate, validate, traverse and serialize; inference and determinism checks |
| P5 | Extract HTTP runtime and feature registration; migrate OpenAPI, CORS/logging/validation/mock policies | P3 contract | Minimal HTTP, replacement generation, route precedence and real transport/pipeline tests |
| P6 | Extract admin/fault/scenario ownership and optional assets | P5 contracts | Admin optional; resolved catalog; bind guard, overrides, scenario roundtrip, cancellation and browser journeys |
| P7 | Replace config/CLI composition, package exports, docs and examples; remove superseded assembly | P4–P6 | ESM example starts; CLI failure/signal behavior; migration guide; external packaged consumer |
| P8 | Review integrated frozen diff, fix findings and run required gates | P2–P7 | Code, architecture and affected security reviews; lint/typecheck/build/test/pack/API and Playwright |

Independent implementations may use assigned disposable worktrees with non-overlapping paths once contracts
are frozen. Main alone integrates into the active worktree. Each phase is a reviewable checkpoint, not permission
to declare the overall migration complete while the old monolith still owns feature behavior.

## Verification and recovery

- Existing CI checks: `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r test`, `pnpm lint`, `pnpm pack:check`,
  `pnpm api:check`. Existing matrix lists Node 18/20/22/24; do not claim unexecuted matrix coverage.
- Run project tools in the development container. No running Podman containers/images or project Compose file
  were found in the inspected repository/parent paths. A project-owned container definition and explicit startup
  are part of this implementation's verification setup. Keep credentials, guest configuration and engine sockets
  outside it; mount the source at its canonical path and apply the project-root label.
- Add local headless browser tests for admin loading, route catalog, apply/remove override, scenario save/load,
  optional features and errors at desktop 1280x800 and narrow 390x844 viewports. Use synthetic data and ephemeral
  browser state. No host GUI browser access.
- Test public composition from emitted package artifacts, not only workspace source imports. Verify a schema-only
  install, HTTP-only install, full preset and external replacement provider. Check no hidden admin/schema imports.
- Before final completion, inspect the integrated diff, reconcile baseline failures, run affected review/checks,
  remove disposable worktrees and owned temporary fixtures, stop task-created processes, and report retained artifacts.
- No persistent-data migration runs automatically. Existing scenarios remain readable where semantics match;
  otherwise provide explicit version errors and a tested conversion path that writes a new file. Source rollback
  does not imply rollback of user data; test only isolated fixtures.

## Active task record

Task revision 10. Scope and approval waiver are unchanged. Main owns integration, fixes, checks and final claims.
Independent architecture review of the starting source identified ARCH-01–05. Architecture design findings
PLAN-ARCH-01–04 and security finding SEC-D01 were resolved in revision 2; both specialists confirmed design readiness.

| Task | Implementation and evidence | Remaining gate |
| --- | --- | --- |
| P1 | Reviewed lifecycle/capability/registration and scenario boundaries | Complete |
| P2 | Project image and nonroot container; baseline UI typecheck defect repaired. Actual TS language-server initialization, completion and diagnostic passed. Reviewed SYS_CHROOT addition fixes Chromium namespace chroot under default seccomp; renderer has zero effective capabilities, no-new-privileges, two seccomp filters and separate PID namespace | Complete |
| P3 | Core integrated; 19 lifecycle/registration tests pass | Complete |
| P4 | Schema integrated; 333 tests pass, including custom kinds/behaviors, IR v2, replay, dataset, host adapter and review regressions | Complete |
| P5 | HTTP/OpenAPI integrated; 116 HTTP + 219 OpenAPI tests pass, including real sockets, route CORS and replacement providers | Complete |
| P6 | Admin integrated; 218 tests pass; strict UI typecheck/build; injectable storage and atomic validation. Ten headless browser tests pass across 1280×800 and 390×844, including foreign-origin mutations, method filtering, optional scenarios, keyboard and width assertions; screenshots inspected | Complete |
| P7 | ESM factory CLI and migration guide; 7 CLI tests including subprocess idle/signal/disposal/failure. Six actual tarballs consumed in isolated schema-only, HTTP-only external-route, and full applications; optional dependencies absent where promised; packaged CLI exercised | Complete |
| P8 | Integrated build/typecheck/lint; 912 tests pass on Node 22 with coverage floors unchanged; strict API reports, packaged consumers and frozen installation pass; code, architecture and security reviews pass; temporary cleanup verified | Complete |

Implementation refinements preserve the reviewed intent: setup/lifecycle contexts expose the original composition
index; ESM configuration exports a factory to create fresh instances; schema host integration lives under `/plugin`
with an optional core peer. OpenAPI returns the selected success status (including bodyless 204/205), registers root
and HEAD/OPTIONS operations, and uses the chosen generator for injected error bodies. These deliberate corrections
are documented in the migration guide. New saves use scenario version 1; valid unversioned scenarios remain readable.

The first frozen implementation review identified CR-01/02, ARCH-R1-01/02, SEC-F01 and CR-04. Repairs restore
discriminated/decimal metadata validation, defer null/undefined and absent optional-child semantics to the selected
kind/behavior, expose a storage-neutral ScenariosStore with an explicit filesystem adapter, preserve admin's origin
policy alongside generic CORS, and share the complete UI method set. Direct storage injection was selected over a
new lifecycle capability because the filesystem adapter acquires no long-lived resources; other plugins may supply
resource-owned adapters through the same contract. CORS repair design was independently reviewed before editing.
HTTP now exposes router-owned resolveRoute and optional per-route CORS policy. Unresolved preflights receive no
implicit authorization. Admin rejects disallowed origins before mutation, including simple requests; exact route
policy makes this independent of plugin composition order. These changes stay within the original user waiver.

Browser inspection also found existing narrow-width overflow; bounded CSS changes and width assertions repair it.
Scenario controls follow the server's advertised optional storage feature. API checking now fails on stale reports;
api:update is the explicit update command. Existing TSDoc warnings were repaired rather than suppressing the gate.

The affected architecture and security reviews passed on the second frozen snapshot. Code review found a follow-on
required-undefined property omission (CR-05); main reproduced it, matched object parsing to generation's omission
rule, and checked both ordinary and deferred object fields. All 333 schema tests pass. Main also reproduced CLI
exit 13 for an empty composition, added beforeExit cleanup, and verified seven CLI tests including idle and signal
shutdown. The bounded third-snapshot code re-review passed; prior architecture/security findings remain resolved.
Final integrated tests (912), typecheck, lint, strict API checks, frozen installation and all six tarball consumers
passed. An additional isolated built-export consumer replaced the OpenAPI generator without schema installed and
served normal/injected responses through both fetch and a real Node listener. No public API changed in the final
schema/CLI fixes. Only Node 22 was executed locally; the existing CI matrix remains unexecuted here. API Extractor
passes with an informational notice that its bundled TypeScript 5.9.3 is older than project TypeScript 6.0.3.
Biome syntax lint passes; no type-aware unsafe/floating-promise lint gate was added.

Independent review evidence: architecture and security passed snapshot r2
(`4aa0cade3a75668574924aea1ee8641473aaf2beaaeffebf519e9a63b76d90f8`); code passed the bounded r3 delta
(`479da77365780e94e7d79a2a2d184471be944f63ed8caa5126af1448c8c86518`). These are source-review results,
not deployment or performance measurements. Later edits only record results and correct a CI step label.

Cleanup completed: removed `/tmp/databehave-plugin-plan.D6mqoo`, its five disposable worktrees, patches, check logs
and review fixtures. Removed `databehave_development_1`, `databehave-schema-work`, `databehave-http-work`,
`databehave-openapi-work`, and `databehave-admin-work`; no task containers remain. Removed API scratch directories
and browser result files after inspection. The project development image, workspace dependencies and generated
build/coverage output remain as reusable local development artifacts; they do not belong in source control.
No commits or remote effects have occurred.

## Deep-review repairs — DBH-REPAIR revision 3

The subsequent deep review found boundary cases missed by the migration checks. The user authorized all eleven
findings and the static-route indexing repair, with the existing approval waiver. Earlier completion/review evidence
above describes its original snapshots; it does not establish that these new cases were covered.

The presented repair plan keeps the capability graph and lifecycle phases. HTTP owns logical request and response
stream ingress, stops admission, propagates cancellation through body completion and drains before ordinary resource
disposal. One deadline configured on httpPlugin bounds socket and logical work from the start of shutdown; timeout
is reported as a failed drain. Trusted noncooperating code cannot be forcibly stopped. Exact routes regain a Map.
Node transport owns a pull-based request stream: cancel stops body intake without resetting the response socket;
explicit cancellation starts a rejection deadline even when a peer stops reading. Incomplete input remains available
through response production; response-source completion stops remaining input and bounds flushing. Host authority
is checked against configured/local listener addresses and explicit extra hostnames before dispatch; origin-form
request targets and final URL authority are validated. Forwarded headers grant no authority.

OpenAPI counts bytes while reading, cancels both tee branches without waiting on one before the other, rejects read
errors, enforces required-body presence independently of schema validation, and bounds inputs before regex matching.
Schema generation propagates a scoped sampling continuation: domain resolves candidates and supplies uniform fallback;
distribution owns selection policy. No domain code interprets distribution metadata. Runtime registries snapshot
identities and callback references while retaining original receivers; receiver/closure state remains extension-owned.
Union value acceptance belongs to its branches. Published artifacts must carry matching provenance repository metadata.

Architecture design review passed A1/A4 on r1. Security design review found that direct Node stream cancellation
would destroy the response socket; revision 2 introduces the transport-owned body stream and passed the bounded
security re-review. Required acceptance includes incomplete uploads receiving an early 413, slow-reader cleanup,
stream cancellation and dependency lifetime, custom sampling replacement, null/undefined union roundtrips,
class/private receiver compatibility, mutable definition isolation, and artifact metadata assertions.

| Task | Findings and owner | Current state / acceptance |
| --- | --- | --- |
| A1 | HTTP request/body lifetime and static routing; HTTP implementer, main integration | Complete; 144 server tests, including disposal ordering, body cancellation, HEAD, deadline and delayed duplex echo |
| A2 | Regex guard, body byte cap, failed reads, required body; OpenAPI implementer | Complete; 247 OpenAPI tests, including complete early 413 without EOF and safe instrumented regex checks |
| A3 | Node authority and rejection transport; HTTP implementer, main admin tests | Complete; real socket authority tests, 220 admin tests and both browser viewports |
| A4 | Sampling, union acceptance, descriptor snapshots/classes; schema implementer | Complete; 342 schema tests, including replacement, scoped continuation, seed/replay/trace and private receivers |
| A5 | Core class callbacks and provenance metadata; main | Complete; 20 core tests and assertions against all six actual tarballs |
| A6 | Integration, docs, independent code/architecture/security reviews and full gates; main | Complete; final affected reviews pass; verification recorded below |
| A7 | Task temporary cleanup; main | Complete; all three worktrees, four task containers, review root, API scratch directories and browser results removed and absence verified |

Main alone writes the active worktree. Implementers own nonoverlapping paths in disposable worktrees. No commits,
publication or deployment are authorized. Final checks run in the project container, including headless Playwright
at 1280×800 and 390×844; passing historical checks are not substituted for affected repair verification.

Architecture review found AR-01 in revision 2: stopping input at handler return broke a response that streams the
request body. Main reproduced the socket failure before changing source. Revision 3 retains input through response
production and observes explicit cancellation independently of completion. The delayed streaming-echo test exceeds
the shutdown budget during normal operation; it now passes. Nonreading rejection tests cancel during both handler
and response execution. Ordinary uncancelled duplex traffic has backpressure and bounded shutdown, without an
implicit response-write timeout. The bounded security design review and final code, architecture and security
re-reviews passed. Their reviewed snapshot SHA-256 is
`cf10c362014e2b69fee1ccfbb9864e5ef43fce0c3fd0b78554ec4ee9b4ed5554`; unaffected revision 2 conclusions remain valid
on `bc9be29241d8ec9bec77ca0ff4289c1110b0d2049ff505d7b5cdf6688bd7420d`.

Final package evidence totals 980 passing tests: core 20, CLI 7, schema 342, server 144, OpenAPI 247 and admin 220.
The full suite passed before AR-01; all affected server/OpenAPI/admin suites passed again after its repair. Build,
strict typecheck, Biome, strict API reports, frozen installation, all six tarball consumers and the schema-free
OpenAPI consumer passed. The latter exercised both Fetch and real Node HTTP. All ten headless Playwright cases
passed again at 1280×800 and 390×844, and both screenshots were inspected. Coverage thresholds were retained.
Execution used Node 22.23.3; other advertised Node versions were not executed locally. Existing type-aware lint
coverage limits and the API Extractor TypeScript-version notice remain unchanged. No performance benchmark or
deployment claim is made. Later edits only record results and cleanup.

Cleanup removed `/tmp/databehave-repairs.KxUg93` and its review snapshots/logs after all reviewers finished.
Only the main Git worktree remains; no task containers remain. Reusable development image, installed dependencies,
and generated build/coverage output remain locally. No commits, pushes, publication or deployment occurred.

## Delivery improvements — DBH-DELIVERY r3

Outcome: complete documentation and CI/CD improvements after the plugin migration. Main owns integration.
The user waived the approval wait, requested reviews and implementation, added Node 26 support, and removed
Node 22 from the next release. No commit, push, publication, workflow dispatch or external configuration is authorized.
The frozen starting source SHA-256 is `580961eb83e187c12fad7bbdbf904cb9c9ae5ef65589a376b64ca44b19ade83c`.
Architecture and security design reviews passed r1; r2 retains the signature gate using exact locked package identities.

| ID | Outcome, dependencies and checks | Status |
| --- | --- | --- |
| D1 | Node 24/26 engines, source and artifact CI matrices, pinned Node 24 development image; execute both runtimes | Complete; both runtimes verified |
| D2 | Same-revision CI gate; one immutable six-tarball/SBOM bundle; verify all inputs before minimal OIDC publishing; explicit partial-failure recovery | Complete; final source reviews pass |
| D3 | Public API/IR v2/sampling/replay docs, plugin guide, errors, changelogs, migration and release runbook | Complete; links and examples pass |
| D4 | Runnable examples, Markdown links, actionlint and workflow contracts; remove ineffective formatting gate; pinned tools and workspace dependency updates | Complete; both runtimes verified |
| D5 | Negative bundle tests, full checks, both runtime consumers, browser and LSP evidence, independent code/architecture/security reviews, cleanup | Complete; checks, reviews and cleanup verified |

The producer builds and packs once. Consumers and dry-run validate those exact bytes; publishing does not install,
build or run lifecycle scripts. Manifest identity, source revision, package set, file types, archive paths, digests and
metadata fail closed before publication. A partial publish stops without retry; recovery reconciles registry integrity
against the original retained bundle. npm trusted-publisher and GitHub environment configuration remain operator work.

Delivery verification used Node **24.21.0** and **26.11.1**. Each passed build, strict typecheck and all **980 package
tests**. Final tooling passed **31 tests** on each runtime. One final bundle of six actual tarballs passed schema-only,
HTTP-only, schema-free OpenAPI Fetch/HTTP, full-composition and CLI consumers on both runtimes; all six npm publication
dry runs passed with scripts disabled. No actual publication occurred. This dirty-worktree bundle was local check
evidence, not a releasable artifact tied to a clean commit.

Frozen installation, Biome, strict API reports, actionlint, 48-document local links/anchors and three executable examples
passed. All ten headless Chromium tests passed at 1280×800 and 390×844; both screenshots were inspected. The Node 24
container's language server initialized and returned TypeScript completion and TS2322 diagnostics. TypeScript is now
an explicit root development dependency so workspace-root language-server resolution succeeds.

The existing npm signature command misread a pnpm aliased peer as nonexistent `sqlite3@6.0.9`. A separately reviewed
metadata projection supplies every exact lockfile package identity to unmodified npm 11.19.0 in isolated configuration.
It verified **610 registry signatures and 142 attestations**. It does not authenticate installed bytes or compare the
lockfile digest with the signed digest; the release guide states this limitation. No package scripts run in this audit.

Independent architecture review passed revision 2 (`eeb9ff4a60a493ae34bc07aaefde5a981927d888c06fff8d7dbc31813b2cce71`).
Code review identified stale error behavior, CLI changelog version and Node-support wording. Security review identified
noncanonical tar paths resolving to the same package metadata file. Main validated and repaired these findings, added
checksum/header/path/terminator regressions, and verified the alias against pinned npm's actual path normalizer without
extraction or registry effects. A self-review also closed private Markdown targets reachable through symlinks.
Final affected code and security reviews passed revision 3:
`0f27b4c268de670a25de9fd1e13f089d17fc6fea6111f9ec81529c7e5794b6c6`.
Unchanged revision 2 architecture conclusions remain applicable. Only this evidence ledger changed after those reviews.

Review snapshots use an explicit source allowlist; an initial snapshot that also included local cache directories was
discarded before delegation. Snapshot and test artifacts were task-owned and have been removed. Actual GitHub runs,
environment protections, per-package npm trusted-publisher configuration, OIDC exchange and partial registry recovery
were not executed. These remain explicit operator prerequisites in `docs/releasing.md`; source checks establish no
publication claim. API Extractor's bundled TypeScript-version notice and existing type-aware lint limitations remain.

Delivery cleanup removed both disposable Git worktrees, the release and Node 26 check containers, the temporary Node 26
image, the development check container, all task snapshots/logs, release dry-run bundles, browser output and API scratch
directories. Their absence and the single remaining main Git worktree were verified. The reusable Node 24 development
image, installed dependencies and generated build/coverage output remain for development. No commits, pushes,
publication, deployment or external configuration changes occurred.
