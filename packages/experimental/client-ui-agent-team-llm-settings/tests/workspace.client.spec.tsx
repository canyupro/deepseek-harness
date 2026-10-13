// @vitest-environment jsdom
/**
 * The workspace layer of the card: the Workspace picker the sidebar feeds, the
 * team document read and write, and the member rows of the selected Workspace.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, RemoteError, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { AgentTeamLlmCard, type AgentTeamLlmCardProps } from '../src/client/AgentTeamLlmCard.tsx'
import {
  AgentTeamLlmCardController, type AgentTeamLlmCardState, type AgentTeamLlmSettings,
} from '../src/client/agent-team-llm-card-controller.ts'
import type { AgentTeamLlmTeamDocument, AgentTeamLlmTeamDocuments } from '../src/client/team-document.ts'
import { en } from '../src/client/locales.ts'
import { workspaceRow, workspaceSource, type ScriptedWorkspaces } from './workspace-source.client.ts'

afterEach(cleanup)

/** The Session the main view retains, which decides the default Workspace. */
const SESSION = SessionId('session-1')

/** The Workspace the sidebar lists first, accounting for {@link SESSION}. */
const ALPHA = workspaceRow('ws-alpha', 'alpha', '/projects/alpha', [SESSION])
/** A second Workspace the picker can switch to. */
const BETA = workspaceRow('ws-beta', 'beta', '/projects/beta')
/** A Workspace the operator adds to the sidebar later. */
const GAMMA = workspaceRow('ws-gamma', 'gamma', '/projects/gamma')

const t = (key: keyof typeof en) => en[key]

const GLOBAL: AgentTeamLlmSettings = {
  enabled: false,
  allowedRoutes: [],
  roleRoutes: [],
  defaultProvider: '',
  defaultModel: '',
}

/** The document one project stores, with the routes its members may run on. */
const TEAM_DOCUMENT: AgentTeamLlmTeamDocument = {
  version: 1,
  enabled: true,
  allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
  members: [
    {
      name: 'scout', description: 'Reads the repository', context: 'fork', provider: 'alpha', model: 'fast',
    },
    { name: 'writer', description: 'Edits the code' },
  ],
}

/** Scripted workspace Remote over one stored document. */
function documents(options: {
  read?: (
    ...args: Parameters<AgentTeamLlmTeamDocuments['readTeamDocument']>
  ) => ReturnType<AgentTeamLlmTeamDocuments['readTeamDocument']>
  save?: () => ReturnType<AgentTeamLlmTeamDocuments['saveTeamDocument']>
} = {}) {
  const readTeamDocument = vi.fn(options.read ?? (() => Promise.resolve({
    ok: true as const,
    value: { path: '/projects/alpha/.dsh/team.json', document: TEAM_DOCUMENT },
  })))
  const saveTeamDocument = vi.fn(options.save ?? (() => Promise.resolve({
    ok: true as const, value: { path: '/projects/alpha/.dsh/team.json' },
  })))
  const listMemberPermissionPresets = vi.fn(() => Promise.resolve({
    ok: true as const, value: { presets: [], custom: { name: 'custom', label: 'custom' } },
  }))
  return {
    slice: {
      readTeamDocument, saveTeamDocument, listMemberPermissionPresets,
    } satisfies AgentTeamLlmTeamDocuments,
    readTeamDocument,
    saveTeamDocument,
    listMemberPermissionPresets,
  }
}

const CATALOG = { remote: { session: { modelCatalog: () => Promise.resolve({
  ok: true as const,
  value: { groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }], failures: [] },
}) } } }

/** A ready global section, the workspace Remote, the sidebar, and the controller bound to all three. */
async function bench(options: {
  documents?: AgentTeamLlmTeamDocuments
  session?: SessionId | undefined
  workspaces?: ScriptedWorkspaces
} = {}) {
  const host = stubConfigForm<AgentTeamLlmSettings>()
  host.publish({ status: 'ready', writable: true, revision: 1, value: GLOBAL, user: {} })
  const workspaces = options.workspaces ?? workspaceSource([ALPHA, BETA])
  const controller = new AgentTeamLlmCardController(
    host.scope,
    CATALOG as never,
    options.documents ?? documents().slice,
    () => ('session' in options ? options.session : SESSION),
    workspaces,
  )
  const face = controller.inject()
  const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
  await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
  return { host, controller, face, state, workspaces }
}

/** A Remote answer the test settles by hand, for the races the controller guards. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

type ReadAnswer = Awaited<ReturnType<AgentTeamLlmTeamDocuments['readTeamDocument']>>
type WriteAnswer = Awaited<ReturnType<AgentTeamLlmTeamDocuments['saveTeamDocument']>>

describe('AgentTeamLlmCardController workspace layer', () => {
  it('reads the project document on mount and switches to it as its own layer', async () => {
    const remote = documents()
    const { face, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    expect(remote.readTeamDocument).toHaveBeenCalledWith(ALPHA.workspaceId, expect.any(AbortSignal))
    expect(state().workspace.workspaceId).toBe(ALPHA.workspaceId)
    expect(state().scope).toBe('global')

    face.setScope('workspace')

    expect(state()).toMatchObject({ scope: 'workspace', enabled: true, dirty: false, invalid: false })
    expect(state().allowed.map(candidate => candidate.key)).toEqual(['alpha\0fast'])
    expect(state().members.map(member => member.name)).toEqual(['scout', 'writer'])
    expect(state().members[1]).toMatchObject({ key: '', problems: [] })
    expect(state().workspace.path).toBe('/projects/alpha/.dsh/team.json')
  })

  it('offers the Workspaces the sidebar lists, in its order', async () => {
    const { state } = await bench({ workspaces: workspaceSource([BETA, ALPHA]) })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    expect(state().workspace.candidates).toEqual([
      { workspaceId: BETA.workspaceId, title: 'beta', path: '/projects/beta' },
      // The live Session is what the operator is looking at, so the row
      // accounting for it is the default even in the sidebar's second position.
      { workspaceId: ALPHA.workspaceId, title: 'alpha', path: '/projects/alpha' },
    ])
    expect(state().workspace.workspaceId).toBe(ALPHA.workspaceId)
  })

  it('keeps one layer\'s staged rows out of the other', async () => {
    const { face, state } = await bench()

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')
    face.setMemberName(0, 'scout-2')

    expect(state().members[0]?.name).toBe('scout-2')
    face.setScope('global')
    expect(state().members).toEqual([])

    face.setScope('workspace')
    expect(state().members[0]?.name).toBe('scout-2')
  })

  it('disables the workspace layer when the Host answers no project root', async () => {
    const remote = documents({
      read: () => Promise.resolve({ ok: true as const, value: { path: null, document: null } }),
    })
    const { face, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('unavailable') })
    face.setScope('workspace')

    expect(state().scope).toBe('global')
    expect(state().workspace.path).toBeUndefined()
    expect(state().workspace.reason).toBe('noProjectRoot')
  })

  it('treats a project that stores no document as an empty one', async () => {
    const remote = documents({
      read: () => Promise.resolve({
        ok: true as const,
        value: { path: '/projects/alpha/.dsh/team.json', document: null },
      }),
    })
    const { face, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')

    expect(state()).toMatchObject({ scope: 'workspace', enabled: false, members: [], dirty: false })
    expect(state().workspace.path).toBe('/projects/alpha/.dsh/team.json')
  })

  it('shows a Workspace the operator adds to the sidebar without asking the Host', async () => {
    const remote = documents()
    const workspaces = workspaceSource([ALPHA])
    const { state } = await bench({ documents: remote.slice, workspaces })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    workspaces.set([ALPHA, GAMMA])
    workspaces.notify()

    // The acceptance path: a Workspace added in the sidebar reaches the card as
    // client state, with no Host request behind it.
    expect(state().workspace.candidates.map(candidate => candidate.workspaceId))
      .toEqual([ALPHA.workspaceId, GAMMA.workspaceId])
    expect(state().workspace.candidates[1]).toEqual({
      workspaceId: GAMMA.workspaceId, title: 'gamma', path: '/projects/gamma',
    })
    // The default did not move, so the card keeps the document it already read.
    expect(remote.readTeamDocument).toHaveBeenCalledOnce()
  })

  it('re-reads the document when the sidebar\'s new first row takes over the default', async () => {
    const remote = documents({
      read: workspaceId => Promise.resolve({
        ok: true as const,
        value: {
          path: `${String(workspaceId)}/.dsh/team.json`,
          document: { version: 1 as const, members: [{ name: 'owner', description: `owns ${String(workspaceId)}` }] },
        },
      }),
    })
    const workspaces = workspaceSource([ALPHA])
    const { state } = await bench({ documents: remote.slice, session: undefined, workspaces })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    expect(state().workspace.workspaceId).toBe(ALPHA.workspaceId)

    workspaces.set([GAMMA, ALPHA])
    workspaces.notify()

    await vi.waitFor(() => { expect(state().workspace.workspaceId).toBe(GAMMA.workspaceId) })
    expect(remote.readTeamDocument).toHaveBeenLastCalledWith(GAMMA.workspaceId, expect.any(AbortSignal))
    expect(state().workspace.path).toBe(`${String(GAMMA.workspaceId)}/.dsh/team.json`)
  })

  it('drops a selected Workspace the sidebar removes and falls back to the default', async () => {
    const remote = documents({
      read: workspaceId => Promise.resolve({
        ok: true as const,
        value: {
          path: `${String(workspaceId)}/.dsh/team.json`,
          document: { version: 1 as const, members: [{ name: 'owner', description: `owns ${String(workspaceId)}` }] },
        },
      }),
    })
    const workspaces = workspaceSource([ALPHA, BETA])
    const { face, state } = await bench({ documents: remote.slice, session: undefined, workspaces })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    face.setWorkspace(BETA.workspaceId)
    await vi.waitFor(() => { expect(state().workspace.workspaceId).toBe(BETA.workspaceId) })

    // The sidebar no longer lists the picked row, so the default takes over
    // instead of resolving a document the Host cannot name.
    workspaces.set([ALPHA])
    workspaces.notify()

    await vi.waitFor(() => { expect(state().workspace.workspaceId).toBe(ALPHA.workspaceId) })
    expect(state().workspace.candidates.map(candidate => candidate.workspaceId)).toEqual([ALPHA.workspaceId])
    expect(remote.readTeamDocument).toHaveBeenLastCalledWith(ALPHA.workspaceId, expect.any(AbortSignal))
  })

  it('reports an empty sidebar as no Workspace, not as a failure', async () => {
    const remote = documents()
    const { state } = await bench({ documents: remote.slice, workspaces: workspaceSource([]) })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('unavailable') })
    expect(state().workspace.reason).toBe('noWorkspace')
    expect(state().workspace.candidates).toEqual([])
    expect(state().workspace.error).toBeUndefined()
    expect(remote.readTeamDocument).not.toHaveBeenCalled()
  })

  it('waits for the sidebar projection before calling an empty list empty', async () => {
    const remote = documents()
    const workspaces = workspaceSource([], 'pending')
    const { state } = await bench({ documents: remote.slice, workspaces })

    // An unanswered projection is not an empty sidebar: the list may still arrive.
    expect(state().workspace).toMatchObject({ status: 'loading', reason: undefined })
    expect(remote.readTeamDocument).not.toHaveBeenCalled()

    workspaces.set([ALPHA])
    workspaces.notify()

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    expect(remote.readTeamDocument).toHaveBeenCalledWith(ALPHA.workspaceId, expect.any(AbortSignal))
  })

  it('adds, edits, and removes member rows', async () => {
    const { face, state } = await bench()

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')

    face.addMember()
    face.setMemberName(2, 'reviewer')
    face.setMemberDescription(2, 'Checks the diff')
    face.setMemberContext(2, 'fork')
    face.setMemberRoute(2, 'alpha\0fast')
    expect(state().members[2]).toMatchObject({
      name: 'reviewer',
      description: 'Checks the diff',
      context: 'fork',
      key: 'alpha\0fast',
      route: { provider: 'alpha', model: 'fast' },
      problems: [],
    })

    face.setMemberRoute(2, '')
    face.setMemberContext(2, 'fresh')
    expect(state().members[2]).toMatchObject({ key: '', context: 'fresh' })

    face.removeMember(2)
    expect(state().members.map(member => member.name)).toEqual(['scout', 'writer'])
    face.removeMember(9)
    expect(state().members).toHaveLength(2)
  })

  it('marks every invalid member and refuses the save', async () => {
    const remote = documents({
      read: () => Promise.resolve({
        ok: true as const,
        value: {
          path: '/projects/alpha/.dsh/team.json',
          document: {
            version: 1,
            members: [
              { name: 'lead', description: 'The session lead' },
              { name: 'Bad_Name', description: 'Wrong grammar' },
              { name: 'dupe', description: 'First' },
              { name: 'dupe', description: 'Second' },
              { name: 'half', description: 'No model', provider: 'alpha' },
            ],
          },
        },
      }),
    })
    const { face, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')

    expect(state().members.map(member => member.problems)).toEqual([
      ['agentTeamLlmMemberNameReserved'],
      ['agentTeamLlmMemberNameFormat'],
      ['agentTeamLlmMemberNameDuplicate'],
      ['agentTeamLlmMemberNameDuplicate'],
      ['agentTeamLlmMemberRouteIncomplete'],
    ])
    expect(state()).toMatchObject({ invalid: true, dirty: false })

    face.addMember()
    expect(state().members.at(-1)?.problems)
      .toEqual(['agentTeamLlmMemberNameRequired', 'agentTeamLlmMemberDescriptionRequired'])
    face.save()
    await Promise.resolve()

    expect(remote.saveTeamDocument).not.toHaveBeenCalled()
  })

  it('names every field an unreadable member breaks on', async () => {
    const { face, state } = await bench()

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')
    face.addMember()

    expect(state().members[2]?.problems)
      .toEqual(['agentTeamLlmMemberNameRequired', 'agentTeamLlmMemberDescriptionRequired'])
  })

  it('writes the complete document and settles the draft', async () => {
    const remote = documents()
    const { face, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')
    face.setMemberName(1, 'reviewer')
    face.setMemberDescription(1, 'Checks the diff')
    face.save()

    await vi.waitFor(() => { expect(remote.saveTeamDocument).toHaveBeenCalledOnce() })
    // The overlay writes only what the project document already declared or the
    // draft moved away from what it inherits; everything else keeps inheriting.
    expect(remote.saveTeamDocument).toHaveBeenCalledWith(ALPHA.workspaceId, {
      version: 1,
      enabled: true,
      allowedRoutes: [{ provider: 'alpha', model: 'fast' }],
      members: [
        {
          name: 'scout', description: 'Reads the repository', context: 'fork',
          provider: 'alpha', model: 'fast',
        },
        { name: 'reviewer', description: 'Checks the diff', context: 'fresh' },
      ],
    }, expect.any(AbortSignal))
    expect(state()).toMatchObject({ dirty: false, failed: false, saving: false })
    expect(state().members.map(member => member.name)).toEqual(['scout', 'reviewer'])
  })

  it('reports a refused read and retries it', async () => {
    const failure = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: new RemoteError('gateway/internal', 'the document is not valid JSON', {}),
    }))
    const remote = documents({ read: failure })
    const { face, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('error') })
    expect(state().workspace.error).toBe('the document is not valid JSON')
    face.setScope('workspace')
    expect(state().scope).toBe('global')

    remote.readTeamDocument.mockResolvedValueOnce({
      ok: true as const,
      value: { path: '/projects/alpha/.dsh/team.json', document: TEAM_DOCUMENT },
    })
    face.retryWorkspace()

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    expect(state().workspace.error).toBeUndefined()
  })

  it('keeps the draft and reports a refused write', async () => {
    const remote = documents({
      save: () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'the document has 9 members, 8 is the cap', {}),
      }),
    })
    const { face, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')
    face.setMemberName(1, 'reviewer')
    face.save()

    await vi.waitFor(() => { expect(state().failed).toBe(true) })
    expect(state().workspace.error).toBe('the document has 9 members, 8 is the cap')
    expect(state().members[1]?.name).toBe('reviewer')

    remote.saveTeamDocument.mockResolvedValueOnce({ ok: true as const, value: { path: '/projects/alpha/.dsh/team.json' } })
    face.save()

    await vi.waitFor(() => { expect(state().failed).toBe(false) })
    expect(remote.saveTeamDocument).toHaveBeenCalledTimes(2)
  })

  it('drops both layers and reads again when the connection generation changes', async () => {
    const remote = documents()
    const { controller, face, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')
    face.addMember()

    controller.resetConnection()

    await vi.waitFor(() => { expect(remote.readTeamDocument).toHaveBeenCalledTimes(2) })
    expect(state().members).toHaveLength(2)
  })

  it('ignores member edits outside the workspace layer and after disposal', async () => {
    const { controller, face, state } = await bench()

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.addMember()
    face.setMemberName(0, 'ghost')
    face.removeMember(0)
    face.setMemberDescription(0, 'ghost')
    face.setMemberContext(0, 'fork')
    face.setMemberRoute(0, 'alpha\\0fast')
    expect(state().members).toEqual([])
    expect(state().dirty).toBe(false)

    face.setScope('workspace')
    expect(state().members).toHaveLength(2)
    controller.dispose()
    face.addMember()
    face.setMemberName(2, 'late')
    face.setScope('global')
    face.retryWorkspace()
    face.save()

    await Promise.resolve()
    expect(state().members).toHaveLength(2)
  })

  it('ignores a sidebar notification after the card is disposed', async () => {
    const remote = documents()
    const workspaces = workspaceSource([ALPHA])
    const { controller, state } = await bench({ documents: remote.slice, workspaces })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    controller.dispose()
    workspaces.set([GAMMA])
    workspaces.notify()

    // The disposed card observes neither the sidebar nor the Host, so nothing
    // republishes the row the operator just added.
    expect(state().workspace.candidates.map(candidate => candidate.workspaceId)).toEqual([ALPHA.workspaceId])
    expect(remote.readTeamDocument).toHaveBeenCalledOnce()
  })

  it('ignores a notification round a teardown already overtook', async () => {
    const remote = documents()
    const workspaces = workspaceSource([ALPHA])
    let tearDownCard = (): void => {}
    // A sibling consumer of the same projection, registered before the card the
    // way the sidebar's own view is. The projection notifies a copied listener
    // round, so a listener that disposes the card mid-round still leaves the
    // card's own call queued behind it.
    workspaces.subscribe(() => { tearDownCard() })
    const rest = await bench({ documents: remote.slice, workspaces })
    tearDownCard = () => { rest.controller.dispose() }
    await vi.waitFor(() => { expect(rest.state().workspace.status).toBe('ready') })

    workspaces.set([GAMMA])
    workspaces.notify()

    // The call arrives after teardown, so it must not read, republish, or
    // resolve anything for a card that is gone.
    expect(rest.state().workspace.candidates.map(candidate => candidate.workspaceId)).toEqual([ALPHA.workspaceId])
    expect(remote.readTeamDocument).toHaveBeenCalledOnce()
  })
})

describe('AgentTeamLlmCardController workspace selection', () => {
  /** A document read answered per Workspace identity, so a switch is observable. */
  function perWorkspaceDocuments() {
    return documents({
      read: workspaceId => Promise.resolve({
        ok: true as const,
        value: {
          path: `${String(workspaceId)}/.dsh/team.json`,
          document: { version: 1 as const, members: [{ name: 'owner', description: `owns ${String(workspaceId)}` }] },
        },
      }),
    })
  }

  it('loads the picked Workspace\'s own document rather than the default\'s', async () => {
    const remote = perWorkspaceDocuments()
    const { face, state } = await bench({ documents: remote.slice, session: undefined })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')
    expect(state().members.map(member => member.description)).toEqual([`owns ${ALPHA.workspaceId}`])

    face.setWorkspace(BETA.workspaceId)

    await vi.waitFor(() => {
      expect(state().members.map(member => member.description)).toEqual([`owns ${BETA.workspaceId}`])
    })
    expect(state().workspace.workspaceId).toBe(BETA.workspaceId)
    expect(state().workspace.path).toBe(`${String(BETA.workspaceId)}/.dsh/team.json`)
    expect(remote.readTeamDocument).toHaveBeenLastCalledWith(BETA.workspaceId, expect.any(AbortSignal))
  })

  it('drops the staged workspace draft when the Workspace switches', async () => {
    const remote = perWorkspaceDocuments()
    const { face, state } = await bench({ documents: remote.slice, session: undefined })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')
    face.setMemberName(0, 'edited-in-alpha')
    expect(state().members[0]?.name).toBe('edited-in-alpha')
    expect(state().dirty).toBe(true)

    face.setWorkspace(BETA.workspaceId)

    // The staged edit belonged to alpha's file; carrying it into beta's document
    // would write one project's draft over another project's file.
    await vi.waitFor(() => { expect(state().workspace.workspaceId).toBe(BETA.workspaceId) })
    expect(state().members.map(member => member.name)).toEqual(['owner'])
    expect(state().dirty).toBe(false)
  })

  it('keeps the picked Workspace while the sidebar republishes its rows', async () => {
    const remote = perWorkspaceDocuments()
    const workspaces = workspaceSource([ALPHA, BETA])
    const { face, state } = await bench({ documents: remote.slice, session: undefined, workspaces })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    face.setWorkspace(BETA.workspaceId)
    await vi.waitFor(() => { expect(state().workspace.workspaceId).toBe(BETA.workspaceId) })

    // An unrelated sidebar change: the picked row is still listed, so the read
    // that already answered for it stands.
    workspaces.set([ALPHA, BETA, GAMMA])
    workspaces.notify()

    expect(state().workspace.workspaceId).toBe(BETA.workspaceId)
    expect(remote.readTeamDocument).toHaveBeenCalledTimes(2)
  })
})

describe('AgentTeamLlmCardController workspace races', () => {
  it('ignores a pick while the workspace document is still being read', async () => {
    const read = deferred<ReadAnswer>()
    const remote = documents()
    remote.readTeamDocument.mockImplementation(() => read.promise)
    const { face, state } = await bench({ documents: remote.slice, session: SESSION })

    await vi.waitFor(() => { expect(remote.readTeamDocument).toHaveBeenCalledOnce() })
    face.setWorkspace(BETA.workspaceId)
    // The read already crossing the wire answers for the Workspace it started on.
    face.retryWorkspace()

    expect(remote.readTeamDocument).toHaveBeenCalledOnce()
    expect(state().workspace.workspaceId).toBe(ALPHA.workspaceId)

    read.resolve({ ok: true as const, value: { path: '/projects/alpha/.dsh/team.json', document: TEAM_DOCUMENT } })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
  })

  it('ignores a pick while a save is in flight', async () => {
    const write = deferred<WriteAnswer>()
    const remote = documents()
    remote.saveTeamDocument.mockImplementation(() => write.promise)
    const { face, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')
    face.setMemberName(1, 'reviewer')
    face.save()
    await vi.waitFor(() => { expect(state().saving).toBe(true) })

    face.setWorkspace(BETA.workspaceId)
    expect(remote.readTeamDocument).toHaveBeenCalledTimes(1)

    write.resolve({ ok: true as const, value: { path: '/projects/alpha/.dsh/team.json' } })
    await vi.waitFor(() => { expect(state().saving).toBe(false) })
  })

  it('ignores a pick after the controller is disposed', async () => {
    const remote = documents()
    const { controller, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    controller.dispose()
    controller.inject().setWorkspace(BETA.workspaceId)

    expect(remote.readTeamDocument).toHaveBeenCalledOnce()
  })

  it('drops a document read the connection generation already replaced', async () => {
    const first = deferred<ReadAnswer>()
    const remote = documents()
    remote.readTeamDocument.mockReturnValueOnce(first.promise)
    const { controller, state } = await bench({ documents: remote.slice })
    await vi.waitFor(() => { expect(remote.readTeamDocument).toHaveBeenCalledOnce() })

    controller.resetConnection()
    await vi.waitFor(() => { expect(remote.readTeamDocument).toHaveBeenCalledTimes(2) })

    // The first answer belongs to the connection that is gone, so it must not
    // install a path or a document the reconnect just dropped.
    first.resolve({ ok: true as const, value: { path: '/stale/.dsh/team.json', document: TEAM_DOCUMENT } })
    await Promise.resolve()
    await Promise.resolve()

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    expect(state().workspace.path).toBe('/projects/alpha/.dsh/team.json')
  })
})

const shell: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}

/** The card as the Plugins page renders it, over one snapshot. */
function renderCard(state: Partial<AgentTeamLlmCardState> = {}) {
  const store = createSnapshotStore<AgentTeamLlmCardState>({
    ...shell,
    scope: 'global',
    workspace: {
      status: 'ready', path: '/projects/alpha/.dsh/team.json', error: undefined, reason: undefined,
      candidates: [], workspaceId: undefined,
    },
    enabled: false,
    candidates: [],
    allowed: [],
    defaultRoute: { provider: '', model: '' },
    roles: [],
    members: [],
    catalogStatus: 'ready',
    catalogPartial: false,
    memberPermissions: null,
    conflicted: false,
    problems: [],
    ...state,
  })
  const actions = {
    setScope: vi.fn(), setMemberName: vi.fn(), setMemberRoute: vi.fn(), setMemberDescription: vi.fn(),
    setMemberContext: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), retryWorkspace: vi.fn(),
    toggleEnabled: vi.fn(), toggleRoute: vi.fn(), setDefaultRoute: vi.fn(), retryCatalog: vi.fn(),
    addRole: vi.fn(), removeRole: vi.fn(), setRoleName: vi.fn(), setRoleRoute: vi.fn(),
    setRoleEffort: vi.fn(), setWorkspace: vi.fn(),
    save: vi.fn(), discard: vi.fn(),
  }
  const props = {
    ...actions,
    view: 'page',
    t,
    useAgentTeamLlmCard: bindSnapshotSelector(store),
  } as AgentTeamLlmCardProps
  render(<AgentTeamLlmCard {...props} />)
  return { actions, store }
}

describe('AgentTeamLlmCard workspace layer', () => {
  it('disables the workspace tab and explains a Workspace with no project root', () => {
    const { actions } = renderCard({
      workspace: {
        status: 'unavailable', path: undefined, error: undefined, reason: 'noProjectRoot',
        candidates: [], workspaceId: undefined,
      },
    })

    const [global, workspace] = screen.getAllByRole('tab')
    expect(global!.getAttribute('aria-selected')).toBe('true')
    expect(workspace).toHaveProperty('disabled', true)
    expect(screen.getByText(en.agentTeamLlmWorkspaceNoProjectRoot)).toBeTruthy()
    fireEvent.click(workspace!)
    expect(actions.setScope).not.toHaveBeenCalled()
  })

  it('reports a refused read with its Host message and retries it', () => {
    const { actions } = renderCard({
      scope: 'workspace',
      workspace: {
        status: 'error', path: undefined, error: 'the document is not valid JSON', reason: undefined,
        candidates: [], workspaceId: undefined,
      },
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(en.agentTeamLlmWorkspaceLoadFailed)
    expect(alert.textContent).toContain('the document is not valid JSON')
    fireEvent.click(within(alert).getByRole('button', { name: en.agentTeamLlmWorkspaceRetry }))

    expect(actions.retryWorkspace).toHaveBeenCalledOnce()
  })

  it('reports a refused write with its Host message and no read retry', () => {
    renderCard({
      scope: 'workspace',
      dirty: true,
      failed: true,
      workspace: {
        status: 'ready',
        path: '/projects/alpha/.dsh/team.json',
        error: '"/projects/alpha" has no .git ancestor to own a team document',
        reason: undefined,
        candidates: [],
        workspaceId: ALPHA.workspaceId,
      },
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(en.agentTeamLlmWorkspaceSaveFailed)
    expect(alert.textContent).toContain('has no .git ancestor')
    expect(within(alert).queryByRole('button')).toBeNull()
    expect(screen.getByText(en.saveFailed)).toBeTruthy()
  })

  it('keeps a refused read retriable while the document was never read', () => {
    renderCard({
      scope: 'workspace',
      workspace: {
        status: 'error', path: undefined, error: 'the document is not valid JSON', reason: undefined,
        candidates: [], workspaceId: undefined,
      },
    })

    const alert = screen.getByRole('alert')
    expect(within(alert).getByRole('button', { name: en.agentTeamLlmWorkspaceRetry })).toBeTruthy()
    expect(screen.queryByText(en.agentTeamLlmWorkspacePath)).toBeNull()
  })

  it('renders one editable row per member and stages every edit', () => {
    const { actions } = renderCard({
      scope: 'workspace',
      allowed: [{
        key: 'alpha\0fast', provider: 'alpha', model: 'fast', providerName: 'Alpha API',
        modelName: 'Fast', available: true, selected: true,
      }],
      members: [
        {
          name: 'scout', description: 'Reads the repository', prompt: '', context: 'fork', sandboxMode: '',
          approvalPolicy: '', key: 'alpha\0fast', route: { provider: 'alpha', model: 'fast' },
          permission: '', problems: [],
        },
        {
          name: 'writer', description: 'Edits the code', prompt: '', context: 'fresh', sandboxMode: '',
          approvalPolicy: '', key: '', route: { provider: '', model: '' },
          permission: '', problems: ['agentTeamLlmMemberNameFormat'],
        },
      ],
    })

    expect(screen.getByLabelText(en.agentTeamLlmWorkspacePath).textContent).toBe('/projects/alpha/.dsh/team.json')
    const names = screen.getAllByLabelText(en.agentTeamLlmMemberName) as HTMLInputElement[]
    expect(names.map(field => field.value)).toEqual(['scout', 'writer'])
    const descriptions = screen.getAllByLabelText(en.agentTeamLlmMemberDescription) as HTMLInputElement[]
    expect(descriptions.map(field => field.value)).toEqual(['Reads the repository', 'Edits the code'])
    const contexts = screen.getAllByLabelText(en.agentTeamLlmMemberContext) as HTMLSelectElement[]
    expect(contexts.map(field => field.value)).toEqual(['fork', 'fresh'])
    const routes = screen.getAllByLabelText(en.agentTeamLlmMemberRoute) as HTMLSelectElement[]
    expect(routes[0]?.value).toBe('alpha\0fast')
    expect(routes[1]?.value).toBe('')

    fireEvent.change(names[1]!, { target: { value: 'editor' } })
    fireEvent.change(descriptions[1]!, { target: { value: 'Edits the docs' } })
    fireEvent.change(contexts[1]!, { target: { value: 'fork' } })
    fireEvent.change(routes[1]!, { target: { value: 'alpha\0fast' } })
    fireEvent.click(screen.getByRole('button', { name: en.agentTeamLlmMemberAdd }))
    fireEvent.click(screen.getAllByRole('button', { name: en.agentTeamLlmMemberRemove })[0]!)

    expect(actions.setMemberName).toHaveBeenCalledWith(1, 'editor')
    expect(actions.setMemberDescription).toHaveBeenCalledWith(1, 'Edits the docs')
    expect(actions.setMemberContext).toHaveBeenCalledWith(1, 'fork')
    expect(actions.setMemberRoute).toHaveBeenCalledWith(1, 'alpha\0fast')
    expect(actions.addMember).toHaveBeenCalledOnce()
    expect(actions.removeMember).toHaveBeenCalledWith(0)
    expect(screen.getByRole('alert').textContent).toBe(en.agentTeamLlmMemberNameFormat)
  })

  it('says so when a project stores no members', () => {
    renderCard({ scope: 'workspace', members: [] })

    expect(screen.getByText(en.agentTeamLlmMembersEmpty)).toBeTruthy()
  })
})

/** The Workspaces the picker renders for one snapshot. */
const PICKER_ALPHA = workspaceRow('ws-alpha', 'alpha', '/projects/alpha')
const PICKER_WINDOWS = workspaceRow('ws-beta', 'beta', 'C:\\work\\beta')
const PICKER_DEFAULT = workspaceRow('ws-default', 'default-workspace', '/Users/dev/Documents/deepseek-harness')

/** The Workspace picker rendered for one snapshot. */
function renderPicker(state: Partial<AgentTeamLlmCardState> = {}) {
  return renderCard({
    scope: 'workspace',
    workspace: {
      status: 'ready',
      path: '/projects/alpha/.dsh/team.json',
      error: undefined,
      reason: undefined,
      candidates: [PICKER_ALPHA, PICKER_WINDOWS],
      workspaceId: PICKER_ALPHA.workspaceId,
    },
    ...state,
  })
}

describe('AgentTeamLlmCard workspace picker', () => {
  it('renders one option per Workspace with its sidebar title and path', () => {
    renderPicker()

    const picker = screen.getByLabelText(en.agentTeamLlmWorkspacePicker) as HTMLSelectElement
    const options = within(picker).getAllByRole('option') as HTMLOptionElement[]
    expect(picker.value).toBe(PICKER_ALPHA.workspaceId)
    expect(options.map(option => option.value)).toEqual([PICKER_ALPHA.workspaceId, PICKER_WINDOWS.workspaceId])
    expect(options.map(option => option.textContent)).toEqual(['alpha', 'beta'])
    // The full path stays reachable as the tooltip, because two Workspaces of
    // the same directory name are otherwise indistinguishable.
    expect(options.map(option => option.title)).toEqual(['/projects/alpha', 'C:\\work\\beta'])
  })

  it('stages the chosen Workspace identity rather than the raw option string', () => {
    const { actions } = renderPicker()

    fireEvent.change(screen.getByLabelText(en.agentTeamLlmWorkspacePicker), {
      target: { value: PICKER_WINDOWS.workspaceId },
    })

    expect(actions.setWorkspace).toHaveBeenCalledWith(PICKER_WINDOWS.workspaceId)
  })

  it('labels the first-use Workspace the way the sidebar does', () => {
    renderPicker({
      workspace: {
        status: 'ready', path: '/projects/alpha/.dsh/team.json', error: undefined, reason: undefined,
        candidates: [PICKER_DEFAULT, PICKER_ALPHA], workspaceId: PICKER_DEFAULT.workspaceId,
      },
    })

    // The stored title of the first-use Workspace is its directory name; the
    // sidebar shows the localized default instead, so the picker must too.
    const options = within(screen.getByLabelText(en.agentTeamLlmWorkspacePicker))
      .getAllByRole('option') as HTMLOptionElement[]
    expect(options.map(option => option.textContent)).toEqual([en.agentTeamLlmWorkspaceDefault, 'alpha'])
  })

  it('offers the picker before a Workspace resolves', () => {
    const { actions } = renderPicker({
      workspace: {
        status: 'ready', path: '/projects/alpha/.dsh/team.json', error: undefined, reason: undefined,
        candidates: [PICKER_ALPHA, PICKER_WINDOWS], workspaceId: undefined,
      },
    })

    // The sidebar's rows can arrive before a default resolves; they are still
    // the operator's to choose from, so no option may be dropped.
    const picker = screen.getByLabelText(en.agentTeamLlmWorkspacePicker)
    const options = within(picker).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map(option => option.value)).toEqual([PICKER_ALPHA.workspaceId, PICKER_WINDOWS.workspaceId])

    fireEvent.change(picker, { target: { value: PICKER_WINDOWS.workspaceId } })
    expect(actions.setWorkspace).toHaveBeenCalledWith(PICKER_WINDOWS.workspaceId)
  })

  it('ignores a change that names no offered Workspace', () => {
    const { actions } = renderPicker()

    fireEvent.change(screen.getByLabelText(en.agentTeamLlmWorkspacePicker), {
      target: { value: 'ws-nobody-offers' },
    })

    // Only an identity the sidebar published may be staged, never the raw
    // option string.
    expect(actions.setWorkspace).not.toHaveBeenCalled()
  })

  it('disables the picker while the layer reads, while saving, and while read-only', () => {
    const { store } = renderPicker()
    const picker = () => screen.getByLabelText(en.agentTeamLlmWorkspacePicker)
    expect(picker()).toHaveProperty('disabled', false)

    // The store lives outside React, so each write has to be flushed through
    // `act` before the rendered `<select>` reflects it.
    act(() => { store.set({ ...store.getSnapshot(), workspace: { ...store.getSnapshot().workspace, status: 'loading' } }) })
    expect(picker()).toHaveProperty('disabled', true)

    act(() => {
      store.set({
        ...store.getSnapshot(),
        workspace: { ...store.getSnapshot().workspace, status: 'ready' },
        saving: true,
      })
    })
    expect(picker()).toHaveProperty('disabled', true)

    act(() => { store.set({ ...store.getSnapshot(), saving: false, writable: false }) })
    expect(picker()).toHaveProperty('disabled', true)
  })

  it('offers no picker while the sidebar lists no Workspace', () => {
    renderPicker({
      workspace: {
        status: 'ready', path: '/projects/alpha/.dsh/team.json', error: undefined, reason: undefined,
        candidates: [], workspaceId: undefined,
      },
    })

    expect(screen.queryByLabelText(en.agentTeamLlmWorkspacePicker)).toBeNull()
  })
})
