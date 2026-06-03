# Scenarios

A scenario is a named snapshot of the current sticky overrides set, stored
as JSON under `admin.scenariosDir` (default `${cwd}/mock-scenarios`).

- Names are restricted to `[A-Za-z0-9_-]{1,64}`.
- Writes are atomic (`tmp` + `rename`).
- A missing directory is treated as "no scenarios", not an error; the
  directory is created on first write.
- `POST {path}/scenarios/:name/load` clears the active overrides and
  re-adds the snapshot in one step.

File format:

```json
{
  "name": "all-500",
  "created": "2026-05-28T10:00:00.000Z",
  "overrides": [
    {
      "id": "ovr_…",
      "matcher": { "kind": "global" },
      "mode":    { "kind": "http-status", "status": 500 },
      "createdAt": "2026-05-28T10:00:00.000Z"
    }
  ]
}
```
