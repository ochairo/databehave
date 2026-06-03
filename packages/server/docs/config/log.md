# `log`

Opt-in per-request access log written to **stdout**. Off by default —
no output and no per-request overhead.

```jsonc
"log": true                                // shorthand: { access: true }
```

Or as an object:

```jsonc
"log": {
  "access":       true,                    // default true when object given
  "includeAdmin": false,                   // log admin-panel hits too
  "colors":       "auto",                  // 'auto' | 'always' | 'never'
  "format":       "pretty"                 // 'pretty' | 'json'
}
```

| Field          | Default     | Meaning |
| -------------- | ----------- | --- |
| `access`       | `true`      | One line per request when `true`. |
| `includeAdmin` | `false`     | When `true`, log hits to `admin.path/*`. |
| `colors`       | `'auto'`    | `'auto'` honours `process.stdout.isTTY`. No effect on `json` format. |
| `format`       | `'pretty'`  | `'pretty'` (ANSI one-liner) or `'json'` (newline-terminated object). |

Sticky / header-driven overrides are flagged with
`[override:<mode.kind>]` (pretty) or `"override":"<kind>"` (json).

Pretty (colours stripped):

```txt
GET /api/v1/health → 200 4 ms · 56
POST /api/v1/widgets/copy → 500 2 ms · 78 [override:http-status]
```

JSON:

```json
{"t":"2026-05-28T10:00:00.000Z","method":"GET","path":"/api/v1/health","status":200,"ms":4,"bytes":"56"}
{"t":"2026-05-28T10:00:00.000Z","method":"POST","path":"/api/v1/widgets/copy","status":500,"ms":2,"bytes":"78","override":"http-status"}
```
