# Databehave documentation

Databehave composes data generation and HTTP features through explicit plugins. The upcoming release
requires Node.js 24.22.1+ (24.x) or 26.12.1+ (26.x); supported and tested majors are 24 and 26.

- [Quickstart](../README.md#start-a-mock-server): create an ESM configuration, then run the CLI.
- [Migration](../MIGRATION.md): replace the previous server/JSONC API and migrate serialized schemas.
- [Writing plugins](plugins.md): capabilities, registration, resource ownership and lifecycle.
- Runnable examples: [plugin](../examples/plugin.mjs), [schema](../examples/schema.mjs), [HTTP](../examples/http.mjs).
- [Core](../packages/core/README.md): dependency graph and application host.
- [Schema guides](../packages/schema/docs/index.md): builders, sampling, validation, datasets and schema extensions.
- [HTTP](../packages/server/README.md): routes, middleware, Node listeners, CORS and logging.
- [OpenAPI](../packages/openapi/README.md): operation catalogs, response generation and request conformance.
- [Admin](../packages/admin/README.md): fault controls, UI and persisted scenarios.
- [CLI](../packages/cli/README.md): ESM configuration and process shutdown.
- [Releasing](releasing.md): runtime support, verification, publication prerequisites and recovery.

OpenAPI request validation returns problem JSON. Its problem types explain
[malformed bodies](errors/malformed-body.md), [missing credentials](errors/unauthorized.md),
[body limits](errors/payload-too-large.md), [unsupported media types](errors/unsupported-media-type.md)
and [conformance failures](errors/request-validation.md).
