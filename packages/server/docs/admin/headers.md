# `x-mock-*` header reference

Per-request overrides. A header beats every sticky override and is
discarded after the request. Conflicting terminal headers, an invalid
base64 payload, or invalid JSON return **HTTP 400** with
`{error: "invalid …: <reason>"}` so the typo is loud.

| Header                                           | ErrorMode kind         | Example value                          |
| ------------------------------------------------ | ---------------------- | -------------------------------------- |
| `x-mock-status`                                  | `http-status`          | `500`                                  |
| `x-mock-business-failure`                        | `business-failure`     | `update conflict`                      |
| `x-mock-business-failure-b64`                    | `business-failure`     | `5pON5L2c44GM…` (base64 of UTF-8)      |
| `x-mock-business-failure-extra`                  | merged into `extra`    | base64-of-JSON object                  |
| `x-mock-body` (+ `-status`, `-content-type`)     | `custom-body`          | base64 JSON                            |
| `x-mock-empty` (+ `-status`)                     | `empty-body`           | `1`                                    |
| `x-mock-malformed` (+ `-status`)                 | `malformed-json`       | `1`                                    |
| `x-mock-delay`                                   | `delay` (wraps others) | `2000`                                 |
| `x-mock-hang`                                    | `hang`                 | `1`                                    |
| `x-mock-destroy`                                 | `destroy`              | `1` (rejected with 503 if `allowDestroy:false`) |

Base64 is standard (not URL-safe). Non-ASCII messages must use the
`-b64` variant — HTTP headers reject byte values > 255.

```sh
# unicode business-failure
MSG_B64=$(printf 'cannot copy: record was modified during operation — café' | base64)
curl -sS -X POST http://127.0.0.1:8000/api/v1/widgets/copy \
  -H "x-mock-business-failure-b64: $MSG_B64" \
  -H 'content-type: application/json' -d '{}'
```

## `x-mock-injected` response header

Whenever the admin inject hook overrides a response — whether from
an `x-mock-*` request header or a sticky override — the response is
tagged with `x-mock-injected: <kind>:<source>`:

| `kind` | Where it came from |
| ------ | --- |
| `http-status`, `business-failure`, `custom-body`, `empty-body`, `malformed-json`, `delay`, `hang`, `destroy` | The ErrorMode that fired. |
| `header-error` | Header parsing failed; the request was rejected with 400. |

| `source` | Meaning |
| -------- | --- |
| `header` | The override came from an `x-mock-*` request header. |
| `sticky` | The override came from a `POST /overrides` sticky entry. |

Examples:

```text
x-mock-injected: http-status:header
x-mock-injected: business-failure:sticky
x-mock-injected: header-error
```

This is the single observability signal that proves an override
fired — without it, a 500 from the mock server is indistinguishable
from a 500 the real handler would have produced. Tests assert on
this header to verify a mock pathway, and dashboards filter by it
to separate injected failures from organic ones.

`header-error` carries no `:source` suffix because the rejection
happens before the override taxonomy applies.
