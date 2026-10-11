import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'

const workflow = async (name) => parse(await readFile(`.github/workflows/${name}.yml`, 'utf8'))

test('browser CI prepares its sandbox after installation and before tests', async () => {
  const { jobs: { quality } } = await workflow('ci')
  assert.equal(quality['runs-on'], 'ubuntu-24.04')
  const install = quality.steps.findIndex(step => step.run === 'pnpm exec playwright install --with-deps chromium')
  const sandbox = quality.steps.findIndex(step => step.name === 'Allow sandboxed Playwright Chromium')
  const browserTests = quality.steps.findIndex(step => step.run === 'pnpm test:e2e')
  assert.ok(install >= 0 && install < sandbox && sandbox < browserTests)
  assert.equal(quality.steps[sandbox].shell, 'bash')
  assert.equal(quality.steps[sandbox]['continue-on-error'], undefined)
  assert.match(await readFile('playwright.config.ts', 'utf8'), /chromiumSandbox: true/)
})

test('browser sandbox setup scopes the profile and stops on missing, ambiguous or failed setup', async t => {
  const ci = await workflow('ci')
  const { run } = ci.jobs.quality.steps.find(step => step.name === 'Allow sandboxed Playwright Chromium')
  for (const scenario of [
    { name: 'one executable', count: 1, executable: true, loadStatus: 0, succeeds: true },
    { name: 'no browser', count: 0, executable: true, loadStatus: 0, succeeds: false },
    { name: 'ambiguous browsers', count: 2, executable: true, loadStatus: 0, succeeds: false },
    { name: 'not executable', count: 1, executable: false, loadStatus: 0, succeeds: false },
    { name: 'profile load failure', count: 1, executable: true, loadStatus: 23, succeeds: false },
  ]) {
    await t.test(scenario.name, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'databehave-sandbox-'))
      try {
        const home = join(directory, 'runner home')
        const browsers = []
        for (let index = 0; index < scenario.count; index++) {
          const browser = join(home, '.cache/ms-playwright', `chromium_headless_shell-${index}`, 'chrome-headless-shell-linux64/chrome-headless-shell')
          await mkdir(join(browser, '..'), { recursive: true })
          await writeFile(browser, '#!/bin/sh\nexit 0\n', { mode: scenario.executable ? 0o700 : 0o600 })
          browsers.push(browser)
        }
        // Capture privileged operations; never load a profile or write outside the fixture.
        const result = spawnSync('bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', `
          sudo() {
            printf '%s\\n' "$*" >> "$TEST_DIR/commands"
            case "$1" in
              tee) cat > "$TEST_DIR/profile" ;;
              apparmor_parser) return "$TEST_LOAD_STATUS" ;;
              *) return 1 ;;
            esac
          }
          ${run}
        `], {
          encoding: 'utf8', timeout: 5000,
          env: { PATH: '/usr/bin:/bin', HOME: home, TEST_DIR: directory, TEST_LOAD_STATUS: String(scenario.loadStatus) },
        })
        assert.ifError(result.error)
        assert.equal(result.status === 0, scenario.succeeds, result.stderr)
        if (scenario.count !== 1 || !scenario.executable) {
          assert.match(result.stderr, /Expected exactly one installed Chromium headless executable/)
          await assert.rejects(readFile(join(directory, 'commands')), { code: 'ENOENT' })
        } else {
          assert.equal(await readFile(join(directory, 'profile'), 'utf8'), `abi <abi/4.0>,
include <tunables/global>
profile databehave-playwright "${browsers[0]}" flags=(unconfined) {
  userns,
}
`)
          assert.equal(await readFile(join(directory, 'commands'), 'utf8'), 'tee /etc/apparmor.d/databehave-playwright\napparmor_parser -r /etc/apparmor.d/databehave-playwright\n')
          assert.equal(result.status, scenario.loadStatus)
        }
      } finally { await rm(directory, { recursive: true, force: true }) }
    })
  }
})

test('publishing is a same-revision CI-gated effect with no install/build', async () => {
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
  assert.doesNotMatch(steps, /npm install|pnpm |npm run|npm ci/)
  assert.match(steps, /needs\.verify\.outputs\.release-artifact-id/)
  assert.match(steps, /node scripts\/release\.mjs publish/)
  assert.ok(!('secrets' in cd.jobs.verify))
})

test('only explicitly selected bootstrap publication receives the npm secret', async () => {
  const cd = await workflow('cd')
  assert.deepEqual(cd.on.workflow_dispatch.inputs.bootstrap, {
    description: 'Enable NPM_TOKEN for the first release before trusted publishing is configured',
    type: 'boolean', default: false,
  })
  assert.doesNotMatch(JSON.stringify({ env: cd.env, verify: cd.jobs.verify, publishEnv: cd.jobs.publish.env }), /secrets\.|NODE_AUTH_TOKEN/)
  const steps = cd.jobs.publish.steps
  const setup = steps.find(step => step.uses?.startsWith('actions/setup-node@'))
  assert.equal(setup.with['registry-url'], "${{ inputs.bootstrap && 'https://registry.npmjs.org' || '' }}")
  const publishing = steps.filter(step => step.run?.includes('node scripts/release.mjs publish'))
  assert.equal(publishing.length, 2)
  const [oidc, bootstrap] = publishing
  assert.equal(oidc.if, '${{ inputs.bootstrap == false }}')
  assert.equal(bootstrap.if, '${{ inputs.bootstrap == true }}')
  assert.equal(bootstrap.shell, 'bash')
  assert.equal(bootstrap['continue-on-error'], undefined)
  assert.deepEqual(bootstrap.env, {
    SOURCE_REVISION: '${{ github.sha }}', NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}',
  })
  assert.equal(oidc.run, 'node scripts/release.mjs publish artifacts/release "$SOURCE_REVISION"')
  for (const step of steps.filter(step => step !== bootstrap)) {
    assert.doesNotMatch(JSON.stringify(step), /secrets\.|NODE_AUTH_TOKEN/)
  }
})

test('bootstrap requires a token and propagates publishing failures without exposing it', async t => {
  const cd = await workflow('cd')
  const bootstrap = cd.jobs.publish.steps.find(step => step.if === '${{ inputs.bootstrap == true }}')
  for (const scenario of [
    { name: 'missing token', token: undefined, publishStatus: 0, status: 1 },
    { name: 'empty secret overrides setup-node placeholder', token: '', publishStatus: 0, status: 1 },
    { name: 'configured token', token: 'synthetic-test-value', publishStatus: 0, status: 0 },
    { name: 'publishing failure', token: 'synthetic-test-value', publishStatus: 23, status: 23 },
  ]) {
    await t.test(scenario.name, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'databehave-bootstrap-'))
      try {
        const sourceSha = 'a'.repeat(40)
        // Replace the release command so these checks cannot publish or authenticate.
        const result = spawnSync('bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', `
          node() {
            printf '%s\\n' "$@" >> "$TEST_DIR/invocation"
            return "$TEST_PUBLISH_STATUS"
          }
          ${bootstrap.run}
        `], {
          encoding: 'utf8', timeout: 5000,
          env: {
            PATH: '/usr/bin:/bin', SOURCE_REVISION: sourceSha, TEST_DIR: directory,
            TEST_PUBLISH_STATUS: String(scenario.publishStatus),
            ...(scenario.token === undefined ? {} : { NODE_AUTH_TOKEN: scenario.token }),
          },
        })
        assert.ifError(result.error)
        assert.equal(result.status, scenario.status, result.stderr)
        if (!scenario.token) {
          assert.match(result.stderr, /Bootstrap publication requires the NPM_TOKEN GitHub secret/)
          await assert.rejects(readFile(join(directory, 'invocation')), { code: 'ENOENT' })
        } else {
          assert.equal(await readFile(join(directory, 'invocation'), 'utf8'), `scripts/release.mjs\npublish\nartifacts/release\n${sourceSha}\n`)
          assert.ok(!`${result.stdout}${result.stderr}`.includes(scenario.token))
        }
      } finally { await rm(directory, { recursive: true, force: true }) }
    })
  }
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
