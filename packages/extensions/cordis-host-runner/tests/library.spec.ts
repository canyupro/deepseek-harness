import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadLibrary, saveLibrary,
  type LibraryPluginRecord,
} from '../src/library-store.ts'
import type { CordisDynamicPluginId } from '../src/types.ts'
import { AGENT_A, running, setup } from './helpers.ts'

/**
 * The personal-plugin library lifecycle: saving a session-owned plugin
 * persists it and re-owns it, the three states drive authorization and the
 * active run, removal clears both planes, and a restart re-mounts enabled
 * plugins from the persisted document.
 */

const HOST_CODE = `
  return {
    apply(ctx) {
      ctx.effect(() => harness.handle('ping', async () => ({ pong: true })))
    },
  }
`

const CLIENT_CODE = `
  return {
    apply(ctx) {
      ctx.effect(() => {})
    },
  }
`

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-library-runner-'))
}

function libRecord(pluginId: string, state: LibraryPluginRecord['state']): LibraryPluginRecord {
  return {
    pluginId,
    sessionId: AGENT_A.id,
    name: 'saved',
    purpose: 'a persisted plugin',
    state,
    currentPackageId: 'pkg-1',
    approvedClientPackages: ['pkg-1'],
    clientVersionUpdatesApproved: false,
    packages: [{ packageId: 'pkg-1', name: 'saved', purpose: 'v1', hostCode: HOST_CODE }],
  }
}

describe('saveToLibrary', () => {
  it('persists a session-owned plugin, re-owns it, and keeps it running', async () => {
    const home = tempHome()
    const harness = await setup({ libraryHome: home })
    try {
      const { pluginId, packageId } = harness.runner.define({
        sessionId: AGENT_A.id,
        plugin: { kind: 'new', idPrefix: 'sav' },
        name: 'saveme',
        purpose: 'to save',
        code: { host: HOST_CODE },
      })
      await harness.runner.run(AGENT_A, pluginId, packageId, 'run')
      const receipt = await harness.runner.saveToLibrary(AGENT_A, { pluginId, state: 'on-editable' })
      expect(receipt.ok).toBe(true)
      if (!receipt.ok) return
      expect(receipt.state).toBe('on-editable')
      const persisted = loadLibrary(home).plugins.find(plugin => plugin.pluginId === pluginId)
      expect(persisted?.state).toBe('on-editable')
      expect(persisted?.packages[0]?.hostCode).toBe(HOST_CODE)
      // The plugin keeps its real session owner (no synthetic library
      // session) and stays running, marked as persisted.
      expect(running(harness.runner, AGENT_A)).toHaveLength(1)
      const row = harness.runner.inventory().find(entry => entry.pluginId === pluginId)
      expect(row?.libraryState).toBe('on-editable')
      expect(row?.activeRun).toBeDefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refuses when the library is not enabled', async () => {
    const harness = await setup()
    try {
      const { pluginId, packageId } = harness.runner.define({
        sessionId: AGENT_A.id,
        plugin: { kind: 'new', idPrefix: 'sav' },
        name: 'saveme',
        purpose: 'to save',
        code: { host: HOST_CODE },
      })
      await harness.runner.run(AGENT_A, pluginId, packageId, 'run')
      const receipt = await harness.runner.saveToLibrary(AGENT_A, { pluginId, state: 'on-editable' })
      expect(receipt).toEqual({ ok: false, reason: 'library-unavailable', message: 'the personal plugin library is not enabled' })
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })

  it('refuses an unknown plugin or an invalid state', async () => {
    const home = tempHome()
    const harness = await setup({ libraryHome: home })
    try {
      const missing = await harness.runner.saveToLibrary(AGENT_A, { pluginId: 'nope' as never, state: 'off' })
      expect(missing.ok).toBe(false)
      if (!missing.ok) expect(missing.reason).toBe('plugin-missing')
      const { pluginId, packageId } = harness.runner.define({
        sessionId: AGENT_A.id,
        plugin: { kind: 'new', idPrefix: 'sav' },
        name: 'saveme',
        purpose: 'to save',
        code: { host: HOST_CODE },
      })
      await harness.runner.run(AGENT_A, pluginId, packageId, 'run')
      const invalid = await harness.runner.saveToLibrary(AGENT_A, { pluginId, state: 'running' as never })
      expect(invalid.ok).toBe(false)
      if (!invalid.ok) expect(invalid.reason).toBe('state-invalid')
    } finally {
      rmSync(home, { recursive: true, force: true })
      await harness.ctx.fiber.dispose()
    }
  })
})

describe('setLibraryState', () => {
  async function savedPlugin(home: string): Promise<{ harness: Awaited<ReturnType<typeof setup>>; pluginId: CordisDynamicPluginId }> {
    const harness = await setup({ libraryHome: home })
    const { pluginId, packageId } = harness.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'sav' },
      name: 'saveme',
      purpose: 'to save',
      code: { host: HOST_CODE },
    })
    await harness.runner.run(AGENT_A, pluginId, packageId, 'run')
    await harness.runner.saveToLibrary(AGENT_A, { pluginId, state: 'on-editable' })
    return { harness, pluginId }
  }

  it('stops a running plugin when set to off', async () => {
    const home = tempHome()
    const { harness, pluginId } = await savedPlugin(home)
    try {
      const receipt = await harness.runner.setLibraryState(AGENT_A, { pluginId, state: 'off' })
      expect(receipt.ok).toBe(true)
      const row = harness.runner.inventory().find(entry => entry.pluginId === pluginId)
      expect(row?.libraryState).toBe('off')
      expect(row?.activeRun).toBeUndefined()
      expect(loadLibrary(home).plugins.find(plugin => plugin.pluginId === pluginId)?.state).toBe('off')
    } finally {
      rmSync(home, { recursive: true, force: true })
      await harness.ctx.fiber.dispose()
    }
  })

  it('re-activates a stopped plugin when set back to a running state', async () => {
    const home = tempHome()
    const { harness, pluginId } = await savedPlugin(home)
    try {
      await harness.runner.setLibraryState(AGENT_A, { pluginId, state: 'off' })
      expect(harness.runner.inventory().find(entry => entry.pluginId === pluginId)?.activeRun).toBeUndefined()
      await harness.runner.setLibraryState(AGENT_A, { pluginId, state: 'frozen' })
      const row = harness.runner.inventory().find(entry => entry.pluginId === pluginId)
      expect(row?.libraryState).toBe('frozen')
      expect(row?.activeRun).toBeDefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
      await harness.ctx.fiber.dispose()
    }
  })

  it('grants plugin-wide approval in on-editable but requires it for new versions in frozen', async () => {
    const home = tempHome()
    const harness = await setup({ libraryHome: home })
    try {
      // A client-bearing plugin: its first run needs approval, then it is saved.
      const { pluginId, packageId } = harness.runner.define({
        sessionId: AGENT_A.id,
        plugin: { kind: 'new', idPrefix: 'sav' },
        name: 'saveme',
        purpose: 'to save',
        code: { client: CLIENT_CODE },
      })
      harness.gateway.answer = 'approve'
      const first = await harness.runner.run(AGENT_A, pluginId, packageId, 'run')
      if (!first.ok) throw new Error(first.message)
      expect(first.status).toBe('awaiting-approval')
      await harness.gateway.answering
      await harness.runner.saveToLibrary(AGENT_A, { pluginId, state: 'on-editable' })

      // In on-editable, a new version runs without a fresh approval.
      const second = harness.runner.define({
        sessionId: AGENT_A.id,
        plugin: { kind: 'existing', pluginId },
        name: 'saveme',
        purpose: 'v2',
        code: { client: CLIENT_CODE },
      })
      harness.gateway.answer = 'approve'
      const updated = await harness.runner.run(AGENT_A, pluginId, second.packageId, 'update')
      if (!updated.ok) throw new Error(updated.message)
      expect(updated.status).toBe('starting')
      await harness.gateway.answering

      // In frozen, a newer version needs a fresh approval again.
      await harness.runner.setLibraryState(AGENT_A, { pluginId, state: 'frozen' })
      const third = harness.runner.define({
        sessionId: AGENT_A.id,
        plugin: { kind: 'existing', pluginId },
        name: 'saveme',
        purpose: 'v3',
        code: { client: CLIENT_CODE },
      })
      harness.gateway.answer = 'approve'
      const frozen = await harness.runner.run(AGENT_A, pluginId, third.packageId, 'update')
      if (!frozen.ok) throw new Error(frozen.message)
      expect(frozen.status).toBe('awaiting-approval')
    } finally {
      rmSync(home, { recursive: true, force: true })
      await harness.ctx.fiber.dispose()
    }
  })

  it('refuses a plugin that is not in the library', async () => {
    const home = tempHome()
    const harness = await setup({ libraryHome: home })
    try {
      const receipt = await harness.runner.setLibraryState(AGENT_A, { pluginId: 'nope' as never, state: 'off' })
      expect(receipt.ok).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
      await harness.ctx.fiber.dispose()
    }
  })
})

describe('removeFromLibrary', () => {
  it('removes the persisted record, the run, and the plugin', async () => {
    const home = tempHome()
    const harness = await setup({ libraryHome: home })
    try {
      const { pluginId, packageId } = harness.runner.define({
        sessionId: AGENT_A.id,
        plugin: { kind: 'new', idPrefix: 'sav' },
        name: 'saveme',
        purpose: 'to save',
        code: { host: HOST_CODE },
      })
      await harness.runner.run(AGENT_A, pluginId, packageId, 'run')
      await harness.runner.saveToLibrary(AGENT_A, { pluginId, state: 'on-editable' })
      const receipt = await harness.runner.removeFromLibrary(AGENT_A, pluginId)
      expect(receipt.ok).toBe(true)
      if (!receipt.ok) return
      expect(receipt.wasRunning).toBe(true)
      expect(harness.runner.inventory().find(entry => entry.pluginId === pluginId)).toBeUndefined()
      expect(loadLibrary(home).plugins.find(plugin => plugin.pluginId === pluginId)).toBeUndefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
      await harness.ctx.fiber.dispose()
    }
  })
})

describe('mountLibrary', () => {
  it('re-creates and activates every enabled library plugin at boot', async () => {
    const home = tempHome()
    try {
      saveLibrary(home, { version: 1, plugins: [libRecord('lib-a', 'on-editable'), libRecord('lib-b', 'off')] })
      const harness = await setup({ libraryHome: home })
      await harness.runner.mountLibrary()
      const rows = harness.runner.inventory()
      const editable = rows.find(entry => entry.pluginId === 'lib-a')
      expect(editable?.libraryState).toBe('on-editable')
      expect(editable?.activeRun).toBeDefined()
      const dormant = rows.find(entry => entry.pluginId === 'lib-b')
      expect(dormant?.libraryState).toBe('off')
      expect(dormant?.activeRun).toBeUndefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('keeps a frozen library plugin running', async () => {
    const home = tempHome()
    try {
      saveLibrary(home, { version: 1, plugins: [libRecord('lib-a', 'frozen')] })
      const harness = await setup({ libraryHome: home })
      await harness.runner.mountLibrary()
      const frozen = harness.runner.inventory().find(entry => entry.pluginId === 'lib-a')
      expect(frozen?.libraryState).toBe('frozen')
      expect(frozen?.activeRun).toBeDefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('arms a no-approval run request for a client-half library plugin at mount', async () => {
    const home = tempHome()
    try {
      const record = libRecord('lib-c', 'frozen')
      record.packages = [{
        packageId: 'pkg-1', name: 'saved', purpose: 'v1', clientCode: 'return { apply(ctx) { ctx.effect(() => {}) } }',
      }]
      saveLibrary(home, { version: 1, plugins: [record] })
      const harness = await setup({ libraryHome: home })
      await harness.runner.mountLibrary()
      const row = harness.runner.inventory().find(entry => entry.pluginId === 'lib-c')
      // The host half is not yet running: the browser orchestrator owns the
      // client-half activation via a no-approval request it can reconcile.
      expect(row?.libraryState).toBe('frozen')
      expect(row?.activeRun).toBeUndefined()
      expect(row?.latestRun?.status).toBe('starting-host')
      expect(row?.latestRun?.requiresApproval).toBe(false)
      expect(row?.latestRun?.approvalRequestId).toBeDefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
