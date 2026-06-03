# `ErrorMode` reference

| Kind | Minimal body | Description |
| - | - | - |
| `http-status` | `{"kind":"http-status","status":500}` | Force the response status. Body from OAS schema if any. |
| `business-failure` | `{"kind":"business-failure","message":"…","extra":{ }}` | 2xx envelope `{success:false, message, …extra}`. |
| `custom-body` | `{"kind":"custom-body","body":{…},"status":200,"contentType":"application/json"}` | Arbitrary body / status / content-type.` |
| `empty-body` | `{"kind":"empty-body","status":204}` | Empty response body. |
| `malformed-json` | `{"kind":"malformed-json","status":200}` | Body is literally `{` — clients see `JSON.parse` failure. |
| `delay` | `{"kind":"delay","ms":2000,"then":{"kind":"http-status","status":500}}` | Sleep `ms`, then run `then` (or passthrough if omitted). |
| `hang` | `{"kind":"hang"}` | Never resolve — exercises client timeout / hang detection. |
| `destroy` | `{"kind":"destroy"}` | Drop the socket. Gated by `allowDestroy: true`. |

`delay.then` cannot itself be `delay`, `hang`, or `destroy`.
