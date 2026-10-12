import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import {
  AgentTeamLlmCardController, agentTeamLlmCandidates, agentTeamLlmRouteKey,
  type AgentTeamLlmSettings,
} from '../src/client/agent-team-llm-card-controller.ts'
import type { AgentTeamLlmTeamDocumentRead, AgentTeamLlmTeamDocuments } from '../src/client/team-document.ts'

/** The Session whose workspace root the Host resolves for the workspace layer. */
const SESSION = SessionId('session-1')

/** A workspace document slice answering every read with `document` at `path`. */
function noTeamDocuments(read: Partial<AgentTeamLlmTeamDocumentRead> = {}): AgentTeamLlmTeamDocuments {
  return {
    readTeamDocument: () => Promise.resolve({
      ok: true as const, value: { path: '/project/.dsh/team.json', document: { version: 1 as const }, ...read },
    }),
    saveTeamDocument: () => Promise.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json' } }),
    listWorkspaceCandidates: () => Promise.resolve({ ok: true as const, value: [] }),
  }
}

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubConfigForm<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value: value as T, user })
    return Promise.resolve(true)
  })
  host.unset.mockImplementation((field: string) => {
    const user = Object.fromEntries(Object.entries(layer()).filter(([key]) => key !== field))
    const base = host.scope.getSnapshot().base as Record<string, unknown> | undefined
    host.publish({ value: { ...section(), [field]: base?.[field] } as T, user })
  })
}

/** The card plugin's context, scripted down to the namespaces a card reaches. */
function ctxWith(namespaces: object) {
  return { remote: namespaces } as never
}

function modelsApi(options: {
  groups?: readonly {
    id: string
    name: string
    models: readonly { id: string; name: string }[]
  }[]
  failures?: readonly { id: string; name: string; message: string }[]
  error?: string
} = {}) {
  const models = vi.fn(() => Promise.resolve({
    ...(options.error === undefined
      ? { ok: true as const, value: { groups: options.groups ?? [], failures: options.failures ?? [] } }
      : { ok: false as const, error: new RemoteError('gateway/internal', options.error, {}) }),
  }))
  return { ctx: ctxWith({ session: { modelCatalog: models } }), models }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

/** One adapter directory entry used by the catalogue tests. */
const ALPHA = [{
  id: 'alpha',
  name: 'Alpha API',
  models: [{ id: 'fast', name: 'Fast' }, { id: 'deep', name: 'Deep' }],
}]

/** The accepted document a case starts from when it stages nothing unusual. */
const EMPTY: AgentTeamLlmSettings = {
  enabled: false,
  allowedRoutes: [],
  roleRoutes: [],
  defaultProvider: '',
  defaultModel: '',
}

/** A ready Host section plus the card controller bound to it. */
function bench(
  value: Partial<AgentTeamLlmSettings> = {},
  groups: readonly {
    id: string
    name: string
    models: readonly { id: string; name: string }[]
  }[] = ALPHA,
) {
  const host = stubConfigForm<AgentTeamLlmSettings>()
  host.publish({ status: 'ready', writable: true, revision: 1, value: { ...EMPTY, ...value }, user: {} })
  const directory = modelsApi({ groups })
  const controller = new AgentTeamLlmCardController(
    host.scope, directory.ctx, noTeamDocuments(), () => SESSION,
  )
  const face = controller.inject()
  const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
  return { host, directory, controller, face, state }
}

describe('agentTeamLlmCandidates', () => {
  it('joins stored routes with the live catalog without dropping unavailable choices', () => {
    const candidates = agentTeamLlmCandidates(
      [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
      [{ provider: 'legacy', model: 'old', reasoningEffort: 'high' }],
      new Set(['legacy\0old']),
    )

    expect(candidates).toEqual([
      {
        key: 'alpha\0fast', provider: 'alpha', model: 'fast', providerName: 'Alpha API',
        modelName: 'Fast', available: true, selected: false,
      },
      {
        key: 'legacy\0old', provider: 'legacy', model: 'old', providerName: 'legacy',
        modelName: 'old', reasoningEffort: 'high', available: false, selected: true,
      },
    ])
  })
})

describe('AgentTeamLlmCardController', () => {
  it('loads the adapter directory without waiting for the switch', async () => {
    const { directory, state } = bench()

    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    expect(directory.models).toHaveBeenCalledOnce()
    expect(state().invalid).toBe(false)
  })

  it('saves the switch, routes, default, and presets as one revision-fenced mutation', async () => {
    const { host, face, state } = bench()
    acceptWrites(host)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    face.toggleEnabled()
    face.toggleRoute('alpha\0fast')
    face.setDefaultRoute('alpha\0fast')
    face.addRole()
    face.setRoleName(0, 'scout')
    face.setRoleRoute(0, 'alpha\0fast')
    expect(state()).toMatchObject({ dirty: true, invalid: false, enabled: true })

    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: true },
        { op: 'set', path: ['allowedRoutes'], value: [{ provider: 'alpha', model: 'fast' }] },
        { op: 'set', path: ['roleRoutes'], value: [{ name: 'scout', provider: 'alpha', model: 'fast' }] },
        { op: 'set', path: ['defaultProvider'], value: 'alpha' },
        { op: 'set', path: ['defaultModel'], value: 'fast' },
        { op: 'set', path: ['members'], value: [] },
      ], 1)
    })

    expect(state()).toMatchObject({ dirty: false, saving: false, failed: false })
  })

  it('keeps a stored reasoning effort on a route the draft did not replace', async () => {
    const { host, face, state } = bench({
      allowedRoutes: [{ provider: 'alpha', model: 'fast', reasoningEffort: 'high' }],
    })
    acceptWrites(host)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    face.toggleEnabled()
    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: true },
        { op: 'set', path: ['allowedRoutes'], value: [{ provider: 'alpha', model: 'fast', reasoningEffort: 'high' }] },
        { op: 'set', path: ['roleRoutes'], value: [] },
        { op: 'set', path: ['defaultProvider'], value: '' },
        { op: 'set', path: ['defaultModel'], value: '' },
        { op: 'set', path: ['members'], value: [] },
      ], 1)
    })
  })

  it('starts an empty draft when a ready test scope has no decoded value', () => {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({ status: 'ready', writable: true, revision: 0, value: undefined })
    const controller = new AgentTeamLlmCardController(host.scope, modelsApi().ctx, noTeamDocuments(), () => SESSION)
    const face = controller.inject()

    face.toggleEnabled()

    expect(face.hooks.agentTeamLlmCard.getSnapshot()).toMatchObject({
      enabled: true, dirty: true, invalid: true, problems: ['agentTeamLlmRequiredRoutes'],
    })
  })

  it('keeps the Host value and reports a rejected write', async () => {
    const { face, state } = bench()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    face.toggleEnabled()
    face.toggleRoute('alpha\0fast')
    face.save()
    await vi.waitFor(() => { expect(state().failed).toBe(true) })

    expect(state()).toMatchObject({ enabled: true, dirty: true, saving: false })
  })

  it('enforces route membership only while routing is enabled', async () => {
    const { host, face, state } = bench({
      enabled: false,
      allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
      roleRoutes: [{ name: 'scout', provider: 'beta', model: 'deep' }],
      defaultProvider: 'beta',
      defaultModel: 'deep',
    })
    acceptWrites(host)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    expect(state()).toMatchObject({ invalid: false, problems: [] })
    face.toggleEnabled()
    expect(state().problems).toEqual(['agentTeamLlmRouteNotAllowed'])
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()

    face.toggleEnabled()
    expect(state()).toMatchObject({ dirty: false, invalid: false, problems: [] })
  })

  it('refuses a preset with no name or no route, and duplicate preset names', async () => {
    const { host, face, state } = bench({
      enabled: true,
      allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
      roleRoutes: [{ name: 'scout', provider: 'alpha', model: 'fast' }],
    })
    acceptWrites(host)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    face.addRole()
    expect(state().problems).toEqual(['agentTeamLlmRoleNameRequired', 'agentTeamLlmRoleRouteRequired'])
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()

    face.setRoleName(1, 'scout')
    expect(state().problems).toEqual(['agentTeamLlmRoleNameDuplicate', 'agentTeamLlmRoleRouteRequired'])
    face.setRoleName(1, 'scout-2')
    face.setRoleRoute(1, 'alpha\0fast')
    expect(state()).toMatchObject({ invalid: false, dirty: true, problems: [] })
  })

  it('refuses an enabled document with no authorized route', async () => {
    const { host, face, state } = bench()
    acceptWrites(host)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    face.toggleEnabled()
    expect(state().problems).toEqual(['agentTeamLlmRequiredRoutes'])
    expect(state().invalid).toBe(true)
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('refuses a default route carrying only one of its two fields, and lets the draft repair it', async () => {
    const { host, face, state } = bench({ defaultProvider: 'alpha', defaultModel: '' })
    acceptWrites(host)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    expect(state()).toMatchObject({ invalid: true, problems: ['agentTeamLlmDefaultIncomplete'] })
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()

    face.setDefaultRoute('')
    expect(state()).toMatchObject({ invalid: false, dirty: true, problems: [] })
    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: false },
        { op: 'set', path: ['allowedRoutes'], value: [] },
        { op: 'set', path: ['roleRoutes'], value: [] },
        { op: 'set', path: ['defaultProvider'], value: '' },
        { op: 'set', path: ['defaultModel'], value: '' },
        { op: 'set', path: ['members'], value: [] },
      ], 1)
    })
  })

  it('refuses a preset with no name and repairs it through the staged row', async () => {
    const { host, face, state } = bench({ enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] })
    acceptWrites(host)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    face.addRole()
    expect(state().problems).toEqual(['agentTeamLlmRoleNameRequired', 'agentTeamLlmRoleRouteRequired'])
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()

    face.setRoleName(0, 'scout')
    face.setRoleRoute(0, 'alpha\0fast')
    expect(state()).toMatchObject({ invalid: false, dirty: true, problems: [] })
  })

  it('reports a directory error and retries it', async () => {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({ status: 'ready', writable: true, value: EMPTY, user: {} })
    const directory = modelsApi({ error: 'offline' })
    const controller = new AgentTeamLlmCardController(host.scope, directory.ctx, noTeamDocuments(), () => SESSION)
    const face = controller.inject()
    const state = () => face.hooks.agentTeamLlmCard.getSnapshot()

    await vi.waitFor(() => { expect(state().catalogStatus).toBe('error') })
    face.retryCatalog()
    await vi.waitFor(() => { expect(directory.models).toHaveBeenCalledTimes(2) })
  })

  it('reloads the model catalog after invalidation', async () => {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({ status: 'ready', writable: true, revision: 1, value: EMPTY, user: {} })
    const models = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { groups: ALPHA, failures: [] } })
      .mockResolvedValueOnce({
        ok: true, value: { groups: [{ id: 'beta', name: 'Beta', models: [{ id: 'new', name: 'New' }] }], failures: [] },
      })
    const controller = new AgentTeamLlmCardController(
      host.scope, ctxWith({ session: { modelCatalog: models } }), noTeamDocuments(), () => SESSION,
    )
    const face = controller.inject()
    const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
    await vi.waitFor(() => { expect(state().candidates[0]?.provider).toBe('alpha') })

    controller.refreshCatalog()

    await vi.waitFor(() => { expect(state().candidates[0]?.provider).toBe('beta') })
    expect(models).toHaveBeenCalledTimes(2)
  })

  it('discards every staged field back to the accepted document', async () => {
    const { face, state } = bench({
      enabled: true,
      allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
      defaultProvider: 'alpha',
      defaultModel: 'fast',
    })
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    face.toggleEnabled()
    face.toggleRoute('alpha\0fast')
    face.setDefaultRoute('')
    face.addRole()
    expect(state().dirty).toBe(true)

    face.discard()

    expect(state()).toMatchObject({
      dirty: false, invalid: false, enabled: true, problems: [], roles: [],
    })
    expect(state().allowed.map(candidate => candidate.key)).toEqual(['alpha\0fast'])
    expect(state().defaultRoute).toEqual({ provider: 'alpha', model: 'fast' })
  })

  it('ignores a route or preset row the draft no longer holds', async () => {
    const { face, state } = bench()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    face.toggleRoute('missing')
    face.removeRole(3)
    face.setRoleName(3, 'scout')
    face.setRoleRoute(3, 'alpha\0fast')

    expect(state().dirty).toBe(false)
  })

  it('rejects a draft after the Host revision changes', async () => {
    const { host, face, state } = bench()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    face.toggleEnabled()
    face.toggleRoute('alpha\0fast')

    host.publish({
      revision: 2,
      value: { ...EMPTY, allowedRoutes: [{ provider: 'beta', model: 'deep' }] },
    })

    expect(state()).toMatchObject({ conflicted: true, invalid: true, dirty: true, failed: false })
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()

    face.discard()
    expect(state()).toMatchObject({ conflicted: false, dirty: false, enabled: false })
  })

  it('settles a draft when a newer Host revision already contains it', async () => {
    const { host, face, state } = bench()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    face.toggleEnabled()
    face.toggleRoute('alpha\0fast')

    host.publish({
      revision: 2,
      value: { ...EMPTY, enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] },
    })

    expect(state()).toMatchObject({ conflicted: false, dirty: false, enabled: true })
  })

  it('drops a draft when the connection generation changes', async () => {
    const { host, face, controller, state } = bench()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    face.toggleEnabled()
    face.toggleRoute('alpha\0fast')

    controller.resetConnection()
    host.publish({ revision: 1, value: { ...EMPTY, enabled: true, allowedRoutes: [] } })

    expect(state()).toMatchObject({ conflicted: false, dirty: false, enabled: true })
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
  })

  it('suppresses duplicate actions and late save settlements', async () => {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    const catalog = modelsApi({ groups: ALPHA })
    const write = deferred<undefined>()
    const mutate = vi.fn(async (ops: readonly SettingsPathOpView[]) => {
      await write.promise
      const enabled = ops.find(op => op.path[0] === 'enabled')
      const allowedRoutes = ops.find(op => op.path[0] === 'allowedRoutes')
      host.publish({ value: {
        ...EMPTY,
        enabled: enabled?.op === 'set' ? enabled.value as boolean : false,
        allowedRoutes: allowedRoutes?.op === 'set' ? allowedRoutes.value as never[] : [],
      } })
      return true
    })
    const controller = new AgentTeamLlmCardController(
      { ...host.scope, mutate }, catalog.ctx, noTeamDocuments(), () => SESSION,
    )
    const face = controller.inject()
    const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
    host.publish({ status: 'ready', writable: true, revision: 1, value: EMPTY, user: {} })
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    face.toggleEnabled()
    face.toggleRoute('alpha\0fast')
    face.save()
    expect(state().saving).toBe(true)
    face.toggleEnabled()
    face.toggleRoute('alpha\0fast')
    face.save()
    face.discard()
    controller.dispose()
    write.resolve(undefined)
    await write.promise

    expect(mutate).toHaveBeenCalledOnce()
  })

  it('suppresses duplicate directory loads and late settlements', async () => {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({ status: 'ready', writable: true, value: EMPTY, user: {} })
    const pending = deferred<never>()
    const models = vi.fn(() => pending.promise)
    const controller = new AgentTeamLlmCardController(
      host.scope, ctxWith({ session: { modelCatalog: models } }), noTeamDocuments(), () => SESSION,
    )
    const face = controller.inject()

    face.retryCatalog()
    expect(models).toHaveBeenCalledOnce()
    controller.dispose()
    pending.resolve({ ok: false, error: new RemoteError('gateway/internal', 'late failure', {}) } as never)
    await pending.promise

    expect(face.hooks.agentTeamLlmCard.getSnapshot().catalogStatus).toBe('loading')
  })

  it('ignores writes while read-only and scope notifications after disposal', () => {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({ status: 'ready', writable: false, value: EMPTY, user: {} })
    const controller = new AgentTeamLlmCardController(host.scope, modelsApi().ctx, noTeamDocuments(), () => SESSION)
    const face = controller.inject()

    face.toggleEnabled()
    face.toggleRoute('alpha\0fast')
    face.setDefaultRoute('alpha\0fast')
    face.addRole()
    face.removeRole(0)
    face.setRoleName(0, 'scout')
    face.setRoleRoute(0, 'alpha\0fast')
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()
    expect(face.hooks.agentTeamLlmCard.getSnapshot().enabled).toBe(false)

    controller.dispose()
    controller.refreshCatalog()
    controller.resetConnection()
    face.toggleEnabled()
    face.retryCatalog()
    face.save()
    host.publish({ value: { ...EMPTY, enabled: true } })

    expect(host.mutate).not.toHaveBeenCalled()
    expect(face.hooks.agentTeamLlmCard.getSnapshot().enabled).toBe(false)
  })

  it('keeps the routing key of a stored route the catalog no longer advertises', async () => {
    const { host, face, state } = bench({
      enabled: true,
      allowedRoutes: [{ provider: 'legacy', model: 'old' }],
    })
    acceptWrites(host)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    expect(state().candidates.at(-1)).toMatchObject({ key: 'legacy\0old', available: false, selected: true })
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()
    expect(agentTeamLlmRouteKey({ provider: 'legacy', model: 'old' })).toBe('legacy\0old')
  })
})
