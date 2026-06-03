# Supported OAS keywords

The kit ships **two** OAS readers and they support different
keyword sets. Pick the one that matches your config:

- The **OAS-only generator** runs by default — when `schema:` is
  absent from `databehave.jsonc`. Zero-dep, conservative subset.
- The **auto-schema translator** runs when `schema:` is set. Lifts
  the OAS into the `@databehave/schema` IR, so it accepts a wider
  keyword set and can fail loudly on constructs it cannot model.
  See [auto-schema.md](./auto-schema.md).

## OAS-only generator (default)

```text
$ref ……………… resolved against components.schemas
              circular refs collapse to {} (recursion guard)
type: 'object'  properties + required
type: 'array'   items
type: 'string'  + minLength / maxLength / pattern (with maxLength sibling — see fallback.md)
type: 'integer' + minimum / maximum
type: 'number'  + minimum / maximum
type: 'boolean'
enum            string enums sampled from the list, deterministically
const           literal value emitted verbatim
allOf           merged left-to-right
oneOf           first branch picked deterministically
anyOf           first branch picked deterministically
nullable: true  string types may emit null
```

`format` **is** consumed for the five common cases:

| `format`     | Emitted value |
| ------------ | --- |
| `date`       | `"2024-01-01"` |
| `date-time`  | `"2024-01-01T00:00:00Z"` |
| `email`      | `"user@example.com"` |
| `uuid`       | `"00000000-0000-4000-8000-000000000000"` |
| `uri` / `url`| `"https://example.com/"` |

Any other `format` falls through to the bare-type default
(`"string"`, `0`, `false`, …). File an issue if you need
format-aware sampling beyond this list.

## Auto-schema translator (`schema:` set)

The translator (`translateOasToIR` in `src/openapi/translate.ts`)
accepts everything the OAS-only generator does, plus:

- `format`: `date`, `date-time`, `email`, `uuid`, `uri`, `url`.
- `nullable: true` (lifts the IR node to `union(t, null)`).
- `minLength`, `maxLength`, `pattern` (passed through).
- `exclusiveMinimum`, `exclusiveMaximum` (boolean OAS-3.0 form
  and numeric OAS-3.1 form both accepted).
- `minItems`, `maxItems`.
- `discriminator` on `oneOf` / `anyOf` (resolves to the right
  branch when the input has the discriminator property).
- `additionalProperties` (boolean and schema-shaped both honoured).
- `example` / `examples` (first usable value picked when present).

### Unsupported — fail loud

The translator refuses these keywords at boot rather than silently
dropping them. The error wording is
`@databehave/server: translateOasToIR failed for <route> responses[<status>]: unsupported keyword <name>`:

- `if` / `then` / `else`
- `dependentSchemas`, `dependentRequired`
- `unevaluatedProperties`, `unevaluatedItems`
- `propertyNames`
- `patternProperties`
- `contentEncoding`, `contentMediaType`
- Remote `$ref` (anything not under `#/components/schemas/...`)

The fail-loud list is intentionally short — the goal is to expose
gaps in the IR, not silently drift away from the spec. File an
issue if you hit one and need it modelled.
