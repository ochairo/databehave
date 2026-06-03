# CLI

```sh
databehave-server databehave.jsonc      # explicit path (required)
databehave-server --open databehave.jsonc
databehave-server --help
```

The positional `<config>` argument is **required**. The CLI does not
fall back to a default file — invoking `databehave-server` with no
argument prints the usage text to `stderr` and exits with code **2**
(bad usage). The same exit code is used for unknown flags, which
additionally print:

```txt
[@databehave/server] unknown option(s): <flag>
```

Flags:

| Flag | Effect |
| --- | --- |
| `--open` | After the server is listening, open the admin UI in the default browser. No-op (with a log line) when `admin` is absent or `admin.enabled !== true`. |
| `-h`, `--help` | Print usage and exit `0`. |

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Clean shutdown (SIGINT / SIGTERM). |
| `1` | Bootstrap failure (config load, listen, etc.). |
| `2` | Bad usage (missing `<config>`, unknown flag). |

On successful boot the CLI loads the file, builds the config, calls
`listen()` using the `server` section, and prints exactly:

```text
[@databehave/server] listening on http://${host}:${port}
```

via `console.info` (so it lands on stdout, not stderr). When
`admin.enabled` is also true, a second line follows on the same
stream:

```text
[@databehave/server] admin panel ready at http://${host}:${port}${admin.path} (dev mock — disable in production)
```

Walk errors and empty-schema reports print to `stderr` via
`console.warn`. `SIGINT` and `SIGTERM` trigger a graceful shutdown
via `RunHandle.close()`.

Set `MOCK_SERVER_HOST` / `MOCK_SERVER_PORT` to override `server.host`
/ `server.port` when the config uses `${VAR}` interpolation.

## `--open` browser launcher

`--open` and `admin.openBrowserOnStart: true` (in the JSONC
config) both trigger the same launcher — they are ORed. With
`admin.enabled: false`, the flag prints a log line and is a
no-op:

```text
[@databehave/server] --open requested but admin.enabled is false; skipping
```

The launcher spawns a platform command, never a network request:

| Platform        | Command |
| --------------- | --- |
| `darwin` (macOS) | `open <url>` |
| `win32`          | `cmd /c start "" <url>` |
| `linux` / other  | `xdg-open <url>` |

Spawn failures (missing `xdg-open`, headless CI) are caught and
printed as a warn line; the server keeps running.
