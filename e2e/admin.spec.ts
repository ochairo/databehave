import { test, expect } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  await request.delete('/databehave/overrides')
  const response = await request.get('/databehave/scenarios')
  const body: { scenarios: { name: string }[] } = await response.json()
  for (const scenario of body.scenarios) await request.delete(`/databehave/scenarios/${scenario.name}`)
})

test('resolved routes, overrides and saved scenarios work through the browser', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/databehave')
  await expect(page.getByRole('heading', { name: 'Mock Injection' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.locator('dbh-operation-row').filter({ hasText: '/hello' }).click()
  const panel = page.locator('dbh-inject-error-panel')
  await panel.getByRole('combobox').selectOption('http-status')
  await panel.getByRole('spinbutton').fill('503')
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect.poll(async () => (await request.get('/hello')).status()).toBe(503)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.getByRole('button', { name: /^Scenarios/ }).click()
  page.once('dialog', dialog => dialog.accept('browser-scenario'))
  await page.getByRole('button', { name: 'Save current as…' }).click()
  await expect(page.getByRole('button', { name: 'Scenarios (1)' })).toBeVisible()

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect.poll(async () => (await request.get('/hello')).status()).toBe(200)
  await page.getByRole('button', { name: 'Scenarios (1)' }).click()
  await page.getByRole('button', { name: 'Load', exact: true }).click()
  await expect.poll(async () => (await request.get('/hello')).status()).toBe(503)
  await page.screenshot({ path: test.info().outputPath('admin-scenario.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('method fallback includes HEAD and OPTIONS and keyboard search stays usable', async ({ page }) => {
  await page.goto('/databehave')
  await expect(page.locator('dbh-operation-row').filter({ hasText: '/head' })).toBeVisible()
  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    await page.getByRole('checkbox', { name: method, exact: true }).uncheck()
  }
  await expect(page.locator('dbh-operation-row').filter({ hasText: '/head' })).toBeVisible()
  await expect(page.locator('dbh-operation-row').filter({ hasText: '/options' })).toBeVisible()
  await page.getByRole('heading', { name: 'Mock Injection' }).click()
  await page.keyboard.press('/')
  await expect(page.getByPlaceholder('Search path or summary…')).toBeFocused()
  await expect(page.locator('.right-panel')).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('foreign local origin cannot change admin state despite permissive application CORS', async ({ page, request }) => {
  await request.post('/databehave/overrides', {
    data: { matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 502 } },
  })
  await page.goto('http://127.0.0.1:17844')
  const blocked = await page.evaluate(async () => {
    const attempts = [
      { method: 'DELETE' },
      { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 503 } }) },
    ]
    return Promise.all(attempts.map(async options => {
      try { await fetch('http://127.0.0.1:17843/databehave/overrides', options); return false }
      catch { return true }
    }))
  })
  expect(blocked).toEqual([true, true])
  const state = await (await request.get('/databehave/overrides')).json()
  expect(state.overrides).toHaveLength(1)
  expect((await request.get('/hello')).status()).toBe(502)
})

test('scenario validation retains the active override on malformed input', async ({ page, request }) => {
  await request.post('/databehave/overrides', {
    data: { matcher: { kind: 'exact', method: 'GET', path: '/hello' }, mode: { kind: 'http-status', status: 502 } },
  })
  await page.goto('/databehave')
  await expect(page.getByRole('heading', { name: 'Mock Injection' })).toBeVisible()
  const result = await request.post('/databehave/scenarios', { data: { name: 'invalid', overrides: [null] } })
  expect(result.status()).toBe(400)
  expect((await request.get('/hello')).status()).toBe(502)
  await page.getByRole('button', { name: 'Active overrides', exact: true }).click()
  await expect(page.locator('dbh-active-overrides-panel')).toContainText('/hello')
})

test('scenario controls follow the advertised storage capability', async ({ page }) => {
  let scenarioRequests = 0
  await page.route('**/databehave/openapi-routes', async route => {
    const response = await route.fetch()
    const catalog = await response.json()
    await route.fulfill({ response, json: { ...catalog, features: { scenarios: false } } })
  })
  page.on('request', request => { if (request.url().endsWith('/databehave/scenarios')) scenarioRequests++ })
  await page.goto('/databehave')
  await expect(page.locator('dbh-operation-row').filter({ hasText: '/hello' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Scenarios/ })).toHaveCount(0)
  expect(scenarioRequests).toBe(0)
})
