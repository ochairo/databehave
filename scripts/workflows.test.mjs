import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import { parse } from 'yaml'

const workflow = async (name) => parse(await readFile(`.github/workflows/${name}.yml`, 'utf8'))

test('publishing is a same-revision CI-gated effect with no install/build or token secret', async () => {
  const cd = await workflow('cd')
  assert.equal(cd.on.workflow_dispatch.inputs.dry_run.default, true)
  assert.equal(cd.jobs.verify.uses, './.github/workflows/ci.yml')
  const publish = cd.jobs.publish
  assert.equal(publish.needs, 'verify')
  for (const guard of ["inputs.dry_run == false", "github.ref == 'refs/heads/main'", "github.repository == 'ochairo/databehave'"]) assert.ok(publish.if.includes(guard))
  assert.equal(publish.environment, 'npm')
  assert.equal(cd.concurrency['cancel-in-progress'], false)
  assert.equal(cd.permissions['id-token'], undefined)
  assert.equal(publish.permissions['id-token'], 'write')
  const steps = JSON.stringify(publish.steps)
  assert.doesNotMatch(steps, /npm install|pnpm |secrets\.|NODE_AUTH_TOKEN|npm run|npm ci/)
  assert.match(steps, /needs\.verify\.outputs\.release-artifact-id/)
  assert.match(steps, /node scripts\/release\.mjs publish/)
  assert.ok(!('secrets' in cd.jobs.verify))
})

test('both supported runtimes test source and the exact release artifact', async () => {
  const ci = await workflow('ci')
  assert.deepEqual(ci.jobs['build-test'].strategy.matrix.node, ['24', '26'])
  assert.deepEqual(ci.jobs['package-consumers'].strategy.matrix.node, ['24', '26'])
  assert.equal(ci.jobs['package-consumers'].needs, 'quality')
  assert.match(JSON.stringify(ci.jobs['package-consumers'].steps), /needs\.quality\.outputs\.artifact-id/)
  const runs = ci.jobs.quality.steps.map((step) => step.run ?? '').join('\n')
  for (const gate of ['lint', 'signatures:check', 'api:check', 'docs:check', 'examples:check', 'workflow:check', 'test:e2e', 'release:prepare', 'release:dry-run']) assert.ok(runs.includes(`pnpm ${gate}`), gate)
  assert.ok(runs.indexOf('pnpm build') < runs.indexOf('pnpm release:prepare'))
  assert.ok(runs.indexOf('pnpm release:prepare') < runs.indexOf('pnpm release:dry-run'))
  assert.equal(ci.permissions['id-token'], undefined)
  for (const job of Object.values(ci.jobs)) assert.equal(job.permissions?.['id-token'], undefined)
  const paths = ['package.json', ...(await readdir('packages')).map((name) => `packages/${name}/package.json`)]
  for (const file of paths) {
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(manifest.engines.node, '^24.0.0 || ^26.0.0', file)
    assert.equal(manifest.scripts.prepack, undefined, `${file}: packing must not rebuild tested bytes`)
    assert.equal(manifest.scripts.prepublishOnly, undefined, `${file}: publication must not run source hooks`)
  }
})

test('workflow jobs are bounded and external actions are immutable', async () => {
  for (const name of ['ci', 'cd', 'codeql']) {
    for (const job of Object.values((await workflow(name)).jobs)) {
      if (job.uses) continue
      assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 30, name)
      for (const step of job.steps) {
        if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w/-]+@[a-f0-9]{40}$/)
        if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false)
      }
    }
  }
})
