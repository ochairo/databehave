import { bench, describe } from 'vitest'

import { createServer } from '../src/index.js'

/**
 * Performance budget — item #19 of the databehave-enterprise plan.
 *
 * These benchmarks track the cost of the two hottest paths the kit
 * exposes today:
 *
 *   1. Loading a small inline OAS document and serving 1k mock
 *      responses through it.
 *   2. The same shape with a fixed seed, exercising the deterministic
 *      `mock(schema, { seed })` branch.
 *
 * vitest auto-detects `*.bench.ts` files. Run via:
 *
 *   pnpm --filter @databehave/server bench
 *
 * The numeric targets live in `bench/BUDGET.md`. CI wiring is a
 * follow-up — this file just makes the data collectable locally.
 */

const OAS_DOC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'bench', version: '0.0.0' },
  paths: {
    '/api/v1/users/{id}': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 8 },
          name: { type: 'string', minLength: 3, maxLength: 16 },
          age: { type: 'integer', minimum: 0, maximum: 120 },
        },
      },
    },
  },
})

describe('mock(schema) hot path', () => {
  bench('static OAS load + 1k mock responses', async () => {
    const server = createServer({ openapi: OAS_DOC })
    for (let i = 0; i < 1000; i++) {
      const res = await server.fetch(
        new Request(`http://localhost/api/v1/users/${i}`),
      )
      // Drain the body so the cost is comparable to a real client.
      await res.text()
    }
  })

  bench('seeded deterministic mock(schema) ×1k', async () => {
    const server = createServer({ openapi: OAS_DOC })
    // Same URL each iteration → same seed inputs → exercises the
    // deterministic branch repeatedly.
    const url = 'http://localhost/api/v1/users/42'
    for (let i = 0; i < 1000; i++) {
      const res = await server.fetch(new Request(url))
      await res.text()
    }
  })
})
