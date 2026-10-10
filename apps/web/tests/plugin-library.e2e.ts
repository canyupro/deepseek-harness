/**
 * The personal plugin library mounts saved plugins into the runner at Host boot
 * through the real dsh-base + dsh-web-app Loader composition, and reports the
 * activation precondition a saved Client-half plugin depends on instead of
 * failing silently.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { openSettings } from './support.ts'

const FIXTURE_LIBRARY = fileURLToPath(new URL('./fixtures/plugin-library/library.json', import.meta.url))

/** Source-free activation facts the Cordis panel and the inventory row share. */
interface RunnerRunFacts {
  pluginId: string
  libraryState?: string
  currentPackageId?: string
  packages: { packageId: string; name: string; hasHostHalf: boolean; hasClientHalf: boolean }[]
  latestRun?: {
    status: string
    host: { status: string; error?: string }
    error?: { phase: string; message: string }
  }
}

describe('personal plugin library in the real web composition', () => {
  let root: string
  let home: string
  let scaffold: WebScaffold
  let browser: Browser

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-plugin-library-'))
    home = join(root, 'home')
    // The library is the Host's own durable document: seed it before boot so the
    // saved plugin auto-mounts exactly as it does for a user's saved plugins.
    await mkdir(join(home, 'plugins'), { recursive: true })
    await copyFile(FIXTURE_LIBRARY, join(home, 'plugins', 'library.json'))
    scaffold = await launchWebScaffold({ harnessHome: home })
    browser = await chromium.launch()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  /** @returns the runner's inventory rows, exactly as the Cordis panel reads them. */
  function inventory(): RunnerRunFacts[] {
    const runner = scaffold.ctx.get('dynamicCordisRunner') as { inventory?: () => RunnerRunFacts[] } | undefined
    return runner?.inventory?.() ?? []
  }

  /**
   * Activation is asynchronous: the Host arms the run and the browser settles it.
   * @returns the one saved plugin's attempt once it reaches a terminal status.
   */
  async function settledRun(): Promise<RunnerRunFacts['latestRun']> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = inventory()[0]?.latestRun
      if (run !== undefined && run.status !== 'starting-host' && run.status !== 'starting') return run
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return inventory()[0]?.latestRun
  }

  it('mounts the saved plugin into the runner with both halves intact', async () => {
    expect(await readFile(join(home, 'plugins', 'library.json'), 'utf8')).toContain('"usage-stats"')
    const rows = inventory()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      pluginId: 'tfix-1',
      libraryState: 'frozen',
      currentPackageId: 'pkg-1',
      packages: [{ packageId: 'pkg-1', name: 'usage-stats', hasHostHalf: true, hasClientHalf: true }],
    })
  })

  it('activates without its authoring session and renders its Settings section', async () => {
    // A saved Client-half plugin must not depend on the session that authored it:
    // that session may be gone, or its write handle owned by another process. The
    // browser settles the armed request and the section renders the plugin's own code.
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 960 } })
    const page = await context.newPage()
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})

    const run = await settledRun()
    expect(run?.status).toBe('running')
    expect(run?.error).toBeUndefined()
    expect(run?.host.status).toBe('running')

    await openSettings(page, 'zh')
    const section = page.getByRole('button', { name: '使用统计', exact: true })
    await section.waitFor({ state: 'visible', timeout: 15_000 })
    await section.click()
    const panel = page.locator('[data-usage-stats-fixture="panel"]')
    await panel.waitFor({ state: 'visible', timeout: 15_000 })
    expect(await panel.isVisible()).toBe(true)
    expect(await page.locator('[data-usage-stats-fixture="total"]').textContent()).toBe('累计 Token')
    await context.close()
  })
})
