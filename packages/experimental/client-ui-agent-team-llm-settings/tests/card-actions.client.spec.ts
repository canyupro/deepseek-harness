/**
 * The card's route create / read / update / delete actions, the reasoning-effort
 * controls, and the workspace document scope rules.
 *
 * Each case drives one action and asserts the state or payload it produces, so
 * removing the action's guard or its write turns exactly that case red.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import {
  AgentTeamLlmCardController, type AgentTeamLlmCardState, type AgentTeamLlmSettings,
} from '../src/client/agent-team-llm-card-controller.ts'
import type { AgentTeamLlmTeamDocument, AgentTeamLlmTeamDocuments } from '../src/client/team-document.ts'

const SESSION = SessionId('session-1')
const ALPHA = [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }, { id: 'deep', name: 'Deep' }] }]

const EMPTY: AgentTeamLlmSettings = {
  enabled: false, allowedRoutes: [], roleRoutes: [], defaultProvider: '', defaultModel: '',
}

/** Make the stub Host accept every write the way a ready section would. */
function acceptWrites<T>(host: ReturnType<typeof stubConfigForm<T>>): void {
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...host.scope.getSnapshot().value as Record<string, unknown> }
    const user: Record<string, unknown> = {}
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      }
    }
    host.publish({ value: value as T, user })
    return Promise.resolve(true)
  })
}

/** Workspace documents scripted over one stored document. */
function documents(document?: AgentTeamLlmTeamDocument) {
  const readTeamDocument = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { path: '/project/.dsh/team.json', document: document ?? null },
  }))
  const saveTeamDocument = vi.fn(() => Promise.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json' } }))
  return { slice: { readTeamDocument, saveTeamDocument } satisfies AgentTeamLlmTeamDocuments, readTeamDocument, saveTeamDocument }
}

interface Options {
  value?: Partial<AgentTeamLlmSettings>
  document?: AgentTeamLlmTeamDocument
  session?: SessionId | undefined
}

/** A ready section, a live catalog, the workspace Remote, and the controller. */
function bench(options: Options = {}) {
  const host = stubConfigForm<AgentTeamLlmSettings>()
  host.publish({ status: 'ready', writable: true, revision: 1, value: { ...EMPTY, ...options.value }, user: {} })
  const catalog = {
    remote: { session: { modelCatalog: () => Promise.resolve({ ok: true as const, value: { groups: ALPHA, failures: [] } }) } },
  }
  const remote = documents(options.document)
  const controller = new AgentTeamLlmCardController(
    host.scope, catalog as never, remote.slice, () => ('session' in options ? options.session : SESSION),
  )
  const face = controller.inject()
  const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
  return { host, remote, controller, face, state }
}

/** Wait until the directory has loaded, so actions that read it are settled. */
async function ready(state: () => AgentTeamLlmCardState): Promise<void> {
  await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
}

describe('allowed route create and delete', () => {
  it('authorizes a hand-filled route the catalog does not advertise', async () => {
    const { face, state } = bench({ value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] } })
    await ready(state)

    face.addAllowedRoute('beta', 'deep')

    expect([...state().allowed].map(candidate => candidate.key)).toEqual(['alpha\0fast', 'beta\0deep'])
    expect(state().dirty).toBe(true)
    // A stored-but-unadvertised route stays removable rather than disappearing.
    expect(state().candidates.find(candidate => candidate.key === 'beta\0deep'))
      .toMatchObject({ available: false, providerName: 'beta', modelName: 'deep' })
  })

  it('stages nothing for a half-filled pair or a route already authorized', async () => {
    const { face, state } = bench({ value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] } })
    await ready(state)
    const before = state().dirty

    face.addAllowedRoute('beta', '')
    face.addAllowedRoute('', 'deep')
    face.addAllowedRoute('alpha', 'fast')

    expect(state().dirty).toBe(before)
    expect([...state().allowed].map(candidate => candidate.key)).toEqual(['alpha\0fast'])
  })

  it('drops an authorized route and leaves a preset naming it invalid', async () => {
    const { host, face, state } = bench({
      value: {
        enabled: true,
        allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
        roleRoutes: [{ name: 'scout', provider: 'alpha', model: 'fast' }],
      },
    })
    acceptWrites(host)
    await ready(state)

    face.removeAllowedRoute('alpha\0fast')

    expect([...state().allowed].map(candidate => candidate.key)).toEqual([])
    expect(state().problems).toEqual(['agentTeamLlmRequiredRoutes', 'agentTeamLlmRouteNotAllowed'])
    expect(state().invalid).toBe(true)
    // The preset keeps its own fields, so the user must repoint it rather than
    // lose the value silently.
    expect(state().roles[0]).toMatchObject({ name: 'scout', key: 'alpha\0fast' })

    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('ignores a delete for a route the draft never held', async () => {
    const { face, state } = bench({ value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] } })
    await ready(state)

    face.removeAllowedRoute('ghost\0route')

    expect(state().dirty).toBe(false)
    expect([...state().allowed].map(candidate => candidate.key)).toEqual(['alpha\0fast'])
  })
})

describe('reasoning effort controls', () => {
  it('sets and clears an authorized route effort in the saved document', async () => {
    const { host, face, state } = bench({ value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] } })
    acceptWrites(host)
    await ready(state)

    face.setRouteEffort('alpha\0fast', 'high')
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

    // The effort is cleared by staging the empty string, which drops the field
    // rather than storing an empty one.
    face.setRouteEffort('alpha\0fast', '')
    face.save()

    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenLastCalledWith([
        { op: 'set', path: ['enabled'], value: true },
        { op: 'set', path: ['allowedRoutes'], value: [{ provider: 'alpha', model: 'fast' }] },
        { op: 'set', path: ['roleRoutes'], value: [] },
        { op: 'set', path: ['defaultProvider'], value: '' },
        { op: 'set', path: ['defaultModel'], value: '' },
        { op: 'set', path: ['members'], value: [] },
      ], 1)
    })
  })

  it('ignores an effort for a route the draft does not hold', async () => {
    const { face, state } = bench({ value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] } })
    await ready(state)

    face.setRouteEffort('ghost\0route', 'high')

    expect(state().dirty).toBe(false)
  })

  it('sets and clears a preset effort, and ignores a row that is gone', async () => {
    const { face, state } = bench({
      value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }], roleRoutes: [{ name: 'scout', provider: 'alpha', model: 'fast' }] },
    })
    await ready(state)

    face.setRoleEffort(0, 'low')
    expect(state().roles[0]?.route.reasoningEffort).toBe('low')

    face.setRoleEffort(0, '')
    expect(state().roles[0]?.route).not.toHaveProperty('reasoningEffort')

    face.setRoleEffort(7, 'high')
    expect(state().roles).toHaveLength(1)
  })

  it('sets and clears a member effort, and ignores a row that is gone', async () => {
    const { face, state } = bench({
      value: {
        enabled: true,
        allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
        members: [{ name: 'recon', description: 'Reads.' }],
      },
    })
    await ready(state)

    face.setMemberEffort(0, 'high')
    expect(state().members[0]?.route.reasoningEffort).toBe('high')

    face.setMemberEffort(0, '')
    expect(state().members[0]?.route).not.toHaveProperty('reasoningEffort')

    face.setMemberEffort(9, 'high')
    expect(state().members).toHaveLength(1)
  })
})

describe('hand-filled member routes', () => {
  it('clears the route when both fields go empty', async () => {
    const { face, state } = bench({
      value: {
        enabled: true,
        allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
        members: [{ name: 'recon', description: 'Reads.', provider: 'alpha', model: 'fast' }],
      },
    })
    await ready(state)

    face.setMemberRouteFields(0, '', '')

    expect(state().members[0]?.route).toEqual({ provider: '', model: '' })
    expect(state().members[0]?.problems).toEqual([])
  })

  it('keeps a stored effort while the route is retyped, and reports a half pair', async () => {
    const { face, state } = bench({
      value: {
        enabled: true,
        allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
        members: [{ name: 'recon', description: 'Reads.', provider: 'alpha', model: 'fast', reasoningEffort: 'high' }],
      },
    })
    await ready(state)

    face.setMemberRouteFields(0, 'beta', 'deep')
    expect(state().members[0]?.route).toEqual({ provider: 'beta', model: 'deep', reasoningEffort: 'high' })

    face.setMemberRouteFields(0, 'beta', '')
    expect(state().members[0]?.problems).toEqual(['agentTeamLlmMemberRouteIncomplete'])
    expect(state().invalid).toBe(true)
  })

  it('drops a preset effort with the route it was cleared onto', async () => {
    const { face, state } = bench({
      value: {
        enabled: true,
        allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
        members: [{ name: 'recon', description: 'Reads.', provider: 'alpha', model: 'fast', reasoningEffort: 'high' }],
      },
    })
    await ready(state)

    face.setMemberRouteFields(0, '', '')

    expect(state().members[0]?.route).not.toHaveProperty('reasoningEffort')
  })

  it('reads a default route out of a key the draft never authorized', async () => {
    const { face, state } = bench({ value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] } })
    await ready(state)

    face.setDefaultRoute('beta\0deep')

    expect(state().defaultRoute).toEqual({ provider: 'beta', model: 'deep' })
    // That route is not authorized, so the Host rule for a default is reported.
    expect(state().problems).toContain('agentTeamLlmRouteNotAllowed')
  })

  it('ignores member row edits aimed at a row that is gone', async () => {
    const { face, state } = bench({
      value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }], members: [{ name: 'recon', description: 'Reads.' }] },
    })
    await ready(state)

    face.removeMember(5)
    face.setMemberPrompt(5, 'late')
    face.setMemberName(5, 'late')
    face.setMemberDescription(5, 'late')
    face.setMemberContext(5, 'fork')
    face.setMemberSandboxMode(5, 'read-only')
    face.setMemberRoute(5, 'alpha\0fast')
    face.setMemberRouteFields(5, 'beta', 'deep')
    face.setMemberEffort(5, 'high')

    expect(state().members).toHaveLength(1)
    expect(state().dirty).toBe(false)
  })

  it('ignores a preset removal for a row that is gone', async () => {
    const { face, state } = bench({
      value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }], roleRoutes: [{ name: 'scout', provider: 'alpha', model: 'fast' }] },
    })
    await ready(state)

    face.removeRole(5)

    expect(state().roles).toHaveLength(1)
    expect(state().dirty).toBe(false)
  })

  it('removes the preset row the user picked', async () => {
    const { face, state } = bench({
      value: {
        enabled: true,
        allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
        roleRoutes: [{ name: 'scout', provider: 'alpha', model: 'fast' }, { name: 'writer', provider: 'alpha', model: 'deep' }],
      },
    })
    await ready(state)

    face.removeRole(0)

    expect(state().roles.map(role => role.name)).toEqual(['writer'])
    expect(state().dirty).toBe(true)
  })

  it('stages a prompt on a member row that exists', async () => {
    const { face, state } = bench({
      value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }], members: [{ name: 'recon', description: 'Reads.' }] },
    })
    await ready(state)

    face.setMemberPrompt(0, 'Read the layout first.')

    expect(state().members[0]?.prompt).toBe('Read the layout first.')
    expect(state().dirty).toBe(true)
  })

  it('reads a route key that carries no separator as a provider-only route', async () => {
    const { face, state } = bench({ value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] } })
    await ready(state)

    face.setDefaultRoute('beta')

    expect(state().defaultRoute).toEqual({ provider: 'beta', model: '' })
    expect(state().problems).toContain('agentTeamLlmDefaultIncomplete')
  })

  it('refuses every edit while the section is read-only', async () => {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({
      status: 'ready', writable: false, revision: 1,
      value: {
        ...EMPTY,
        enabled: true,
        allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
        members: [{ name: 'recon', description: 'Reads.' }],
      },
      user: {},
    })
    const catalog = {
      remote: { session: { modelCatalog: () => Promise.resolve({ ok: true as const, value: { groups: ALPHA, failures: [] } }) } },
    }
    const controller = new AgentTeamLlmCardController(host.scope, catalog as never, documents().slice, () => SESSION)
    const face = controller.inject()
    const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
    await ready(state)

    face.removeAllowedRoute('alpha\0fast')
    face.setRouteEffort('alpha\0fast', 'high')
    face.removeMember(0)

    expect([...state().allowed].map(candidate => candidate.key)).toEqual(['alpha\0fast'])
    expect(state().members).toHaveLength(1)
    expect(state().dirty).toBe(false)
  })

  it('drops a workspace save whose session went away after the read', async () => {
    let session: SessionId | undefined = SESSION
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({ status: 'ready', writable: true, revision: 1, value: { ...EMPTY, enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] }, user: {} })
    const catalog = {
      remote: { session: { modelCatalog: () => Promise.resolve({ ok: true as const, value: { groups: ALPHA, failures: [] } }) } },
    }
    const remote = documents({ version: 1, enabled: false })
    const controller = new AgentTeamLlmCardController(host.scope, catalog as never, remote.slice, () => session)
    const face = controller.inject()
    const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    // The layer was readable, then the session that backed it went away.
    session = undefined
    face.setScope('workspace')
    face.toggleEnabled()
    face.save()

    await Promise.resolve()
    expect(remote.saveTeamDocument).not.toHaveBeenCalled()
    expect(state().saving).toBe(false)
  })

  it('ignores a workspace save that settles after the connection moved on', async () => {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({ status: 'ready', writable: true, revision: 1, value: { ...EMPTY, enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] }, user: {} })
    const catalog = {
      remote: { session: { modelCatalog: () => Promise.resolve({ ok: true as const, value: { groups: ALPHA, failures: [] } }) } },
    }
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const saveTeamDocument = vi.fn(() => pending.then(() => ({ ok: true as const, value: { path: '/project/.dsh/team.json' } })))
    const controller = new AgentTeamLlmCardController(
      host.scope,
      catalog as never,
      { readTeamDocument: () => Promise.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json', document: { version: 1 as const, enabled: false } } }), saveTeamDocument },
      () => SESSION,
    )
    const face = controller.inject()
    const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    face.setScope('workspace')
    face.toggleEnabled()
    face.save()
    expect(state().saving).toBe(true)

    controller.resetConnection()
    release()
    await pending

    // The late answer belongs to the previous connection, so it must not settle
    // the fresh draft as a failure.
    expect(state().failed).toBe(false)
  })
})

describe('workspace document scope', () => {
  it('inherits the global roster when the project document declares none', async () => {
    const { face, state } = bench({
      value: {
        enabled: true,
        allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
        members: [{ name: 'recon', description: 'Global recon.', sandboxMode: 'read-only' }],
      },
      document: { version: 1, enabled: true },
    })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    face.setScope('workspace')

    expect(state().members.map(member => ({ name: member.name, sandboxMode: member.sandboxMode })))
      .toEqual([{ name: 'recon', sandboxMode: 'read-only' }])
  })

  it('writes only the fields the project already declared, plus the ones the draft changed', async () => {
    const { remote, face, state } = bench({
      value: {
        enabled: false,
        allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
        roleRoutes: [{ name: 'scout', provider: 'alpha', model: 'fast' }],
        members: [{ name: 'recon', description: 'Global recon.' }],
      },
      // The project document declares only its roster, so everything else must
      // keep inheriting rather than be written out.
      document: { version: 1, members: [{ name: 'recon', description: 'Project recon.' }] },
    })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    face.setScope('workspace')
    face.setMemberSandboxMode(0, 'read-only')
    face.save()

    await vi.waitFor(() => { expect(remote.saveTeamDocument).toHaveBeenCalledOnce() })
    expect(remote.saveTeamDocument).toHaveBeenCalledWith(SESSION, {
      version: 1,
      members: [{ name: 'recon', description: 'Project recon.', context: 'fresh', sandboxMode: 'read-only' }],
    }, expect.any(AbortSignal))
  })

  it('rewrites a field the draft moved away from what it inherits', async () => {
    const { remote, face, state } = bench({
      value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }], roleRoutes: [], defaultProvider: '', defaultModel: '' },
      document: { version: 1 },
    })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    face.setScope('workspace')
    face.addRole()
    face.setRoleName(0, 'scout')
    face.setRoleRoute(0, 'alpha\0fast')
    face.save()

    await vi.waitFor(() => { expect(remote.saveTeamDocument).toHaveBeenCalledOnce() })
    expect(remote.saveTeamDocument).toHaveBeenCalledWith(SESSION, {
      version: 1,
      roleRoutes: [{ name: 'scout', provider: 'alpha', model: 'fast' }],
    }, expect.any(AbortSignal))
  })

  it('refuses to write while no session project is open', async () => {
    const { remote, face, state } = bench({
      value: { enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }] },
      document: { version: 1, enabled: false },
      session: undefined,
    })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('unavailable') })

    face.setScope('workspace')

    expect(state().scope).toBe('global')
    expect(remote.saveTeamDocument).not.toHaveBeenCalled()
  })
})
