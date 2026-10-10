# HTTP benchmarks

Run `pnpm --filter @databehave/server bench` to measure exact and parameterized
route dispatch through the public HTTP runtime. Both scenarios include request
and response construction. These are local measurements, without an enforced
performance budget or a reference-machine baseline.

OpenAPI generation and schema sampling belong to their respective packages.
