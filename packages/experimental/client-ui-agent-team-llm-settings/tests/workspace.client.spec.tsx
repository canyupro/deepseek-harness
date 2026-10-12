// @vitest-environment jsdom
/** The workspace layer of the card: scope switching, the team document read and write, and member rows. */

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

afterEach(cleanup)

/** The Session whose workspace root the Host resolves for the workspace layer. */
const SESSION = SessionId('session-1')

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
  candidates?: () => ReturnType<AgentTeamLlmTeamDocuments['listWorkspaceCandidates']>
} = {}) {
  const readTeamDocument = vi.fn(options.read ?? (() => Promise.resolve({
    ok: true as const,
    value: { path: '/project/.dsh/team.json', document: TEAM_DOCUMENT },
  })))
  const saveTeamDocument = vi.fn(options.save ?? (() => Promise.resolve({
    ok: true as const, value: { path: '/project/.dsh/team.json' },
  })))
  const listWorkspaceCandidates = vi.fn(options.candidates ?? (() => Promise.resolve({
    ok: true as const, value: [] as const,
  })))
  return {
    slice: { readTeamDocument, saveTeamDocument, listWorkspaceCandidates } satisfies AgentTeamLlmTeamDocuments,
    readTeamDocument,
    saveTeamDocument,
    listWorkspaceCandidates,
  }
}

const CATALOG = { remote: { session: { modelCatalog: () => Promise.resolve({
  ok: true as const,
  value: { groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }], failures: [] },
}) } } }

/** A ready global section, the workspace Remote, and the controller bound to both. */
async function bench(options: {
  documents?: AgentTeamLlmTeamDocuments
  session?: SessionId | undefined
} = {}) {
  const host = stubConfigForm<AgentTeamLlmSettings>()
  host.publish({ status: 'ready', writable: true, revision: 1, value: GLOBAL, user: {} })
  const controller = new AgentTeamLlmCardController(
    host.scope,
    CATALOG as never,
    options.documents ?? documents().slice,
    () => ('session' in options ? options.session : SESSION),
  )
  const face = controller.inject()
  const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
  await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
  return { host, controller, face, state }
}

describe('AgentTeamLlmCardController workspace layer', () => {
  it('reads the project document on mount and switches to it as its own layer', async () => {
    const remote = documents()
    const { face, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    expect(remote.readTeamDocument).toHaveBeenCalledWith(SESSION, expect.any(AbortSignal))
    expect(state().scope).toBe('global')

    face.setScope('workspace')

    expect(state()).toMatchObject({ scope: 'workspace', enabled: true, dirty: false, invalid: false })
    expect(state().allowed.map(candidate => candidate.key)).toEqual(['alpha\0fast'])
    expect(state().members.map(member => member.name)).toEqual(['scout', 'writer'])
    expect(state().members[1]).toMatchObject({ key: '', problems: [] })
    expect(state().workspace.path).toBe('/project/.dsh/team.json')
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

  it('disables the workspace layer when no project root backs the session', async () => {
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

  it('disables the workspace layer while no session project is open', async () => {
    const remote = documents()
    const { state } = await bench({ documents: remote.slice, session: undefined })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('unavailable') })
    expect(state().workspace.reason).toBe('noSession')
    expect(remote.readTeamDocument).not.toHaveBeenCalled()
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
          path: '/project/.dsh/team.json',
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
    expect(remote.saveTeamDocument).toHaveBeenCalledWith(SESSION, {
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
      value: { path: '/project/.dsh/team.json', document: TEAM_DOCUMENT },
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

    remote.saveTeamDocument.mockResolvedValueOnce({ ok: true as const, value: { path: '/project/.dsh/team.json' } })
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
})

const shell: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}

/** The card as the Plugins page renders it, over one snapshot. */
function renderCard(state: Partial<AgentTeamLlmCardState> = {}) {
  const store = createSnapshotStore<AgentTeamLlmCardState>({
    ...shell,
    scope: 'global',
    workspace: { status: 'ready', path: '/project/.dsh/team.json', error: undefined, reason: undefined, candidatesStatus: 'ready', candidates: [], sessionId: undefined },
    enabled: false,
    candidates: [],
    allowed: [],
    defaultRoute: { provider: '', model: '' },
    roles: [],
    members: [],
    catalogStatus: 'ready',
    catalogPartial: false,
    conflicted: false,
    problems: [],
    ...state,
  })
  const actions = {
    setScope: vi.fn(), setMemberName: vi.fn(), setMemberRoute: vi.fn(), setMemberDescription: vi.fn(),
    setMemberContext: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), retryWorkspace: vi.fn(),
    toggleEnabled: vi.fn(), toggleRoute: vi.fn(), setDefaultRoute: vi.fn(), retryCatalog: vi.fn(),
    addRole: vi.fn(), removeRole: vi.fn(), setRoleName: vi.fn(), setRoleRoute: vi.fn(),
    setRoleEffort: vi.fn(), setWorkspaceSession: vi.fn(),
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
  it('disables the workspace tab and explains a session with no project root', () => {
    const { actions } = renderCard({
      workspace: { status: 'unavailable', path: undefined, error: undefined, reason: 'noProjectRoot', candidatesStatus: 'ready', candidates: [], sessionId: undefined },
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
      workspace: { status: 'error', path: undefined, error: 'the document is not valid JSON', reason: undefined, candidatesStatus: 'ready', candidates: [], sessionId: undefined },
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
        path: '/project/.dsh/team.json',
        error: '"/project" has no .git ancestor to own a team document',
        reason: undefined,
        candidatesStatus: 'ready',
        candidates: [],
        sessionId: undefined,
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
      workspace: { status: 'error', path: undefined, error: 'the document is not valid JSON', reason: undefined, candidatesStatus: 'ready', candidates: [], sessionId: undefined },
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
          key: 'alpha\0fast', route: { provider: 'alpha', model: 'fast' }, problems: [],
        },
        {
          name: 'writer', description: 'Edits the code', prompt: '', context: 'fresh', sandboxMode: '',
          key: '', route: { provider: '', model: '' }, problems: ['agentTeamLlmMemberNameFormat'],
        },
      ],
    })

    expect(screen.getByLabelText(en.agentTeamLlmWorkspacePath).textContent).toBe('/project/.dsh/team.json')
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

/** One project the Host offers, in newest-created-first order. */
const ALPHA = { sessionId: SessionId('session-alpha'), cwd: '/projects/alpha', createdAt: 20 }
const BETA = { sessionId: SessionId('session-beta'), cwd: '/projects/beta', createdAt: 10 }

/** A document read answered per Session identity, so a switch is observable. */
function perProjectDocuments() {
  return documents({
    read: sessionId => Promise.resolve({
      ok: true as const,
      value: {
        path: `${String(sessionId)}/.dsh/team.json`,
        document: { version: 1 as const, members: [{ name: 'owner', description: `owns ${String(sessionId)}` }] },
      },
    }),
  })
}

/** A Remote answer the test settles by hand, for the races the controller guards. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

type CandidateAnswer = Awaited<ReturnType<AgentTeamLlmTeamDocuments['listWorkspaceCandidates']>>
type ReadAnswer = Awaited<ReturnType<AgentTeamLlmTeamDocuments['readTeamDocument']>>
type WriteAnswer = Awaited<ReturnType<AgentTeamLlmTeamDocuments['saveTeamDocument']>>

describe('AgentTeamLlmCardController candidate fallback', () => {
  it('resolves the newest-created candidate when no live session and no selection', async () => {
    const remote = documents({ candidates: () => Promise.resolve({ ok: true as const, value: [ALPHA, BETA] }) })
    const { face, state } = await bench({ documents: remote.slice, session: undefined })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    // No tier above the list resolves, so the first candidate is the subject.
    expect(remote.readTeamDocument).toHaveBeenCalledWith(ALPHA.sessionId, expect.any(AbortSignal))
    expect(state().workspace.sessionId).toBe(ALPHA.sessionId)
    expect(face.hooks.agentTeamLlmCard.getSnapshot().workspace.candidates.map(c => c.sessionId))
      .toEqual([ALPHA.sessionId, BETA.sessionId])
  })

  it('never lets a candidate displace a live main-view session', async () => {
    const remote = documents({ candidates: () => Promise.resolve({ ok: true as const, value: [ALPHA, BETA] }) })
    const { state } = await bench({ documents: remote.slice, session: SESSION })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    // The retained session is what the operator is looking at; the picker still
    // lists the projects, but it must not become the subject of the read.
    expect(remote.readTeamDocument).toHaveBeenCalledWith(SESSION, expect.any(AbortSignal))
    expect(remote.readTeamDocument).not.toHaveBeenCalledWith(ALPHA.sessionId, expect.any(AbortSignal))
    expect(remote.listWorkspaceCandidates).not.toHaveBeenCalled()
  })

  it('keeps the picked session over the newest candidate', async () => {
    const remote = documents({ candidates: () => Promise.resolve({ ok: true as const, value: [ALPHA, BETA] }) })
    const { face, state } = await bench({ documents: remote.slice, session: undefined })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    expect(state().workspace.sessionId).toBe(ALPHA.sessionId)

    face.setWorkspaceSession(BETA.sessionId)

    await vi.waitFor(() => { expect(state().workspace.sessionId).toBe(BETA.sessionId) })
    // A selection outranks the list's own order.
    expect(remote.readTeamDocument).toHaveBeenLastCalledWith(BETA.sessionId, expect.any(AbortSignal))
  })

  it('loads the picked project\'s own document rather than the first candidate\'s', async () => {
    const remote = perProjectDocuments()
    remote.listWorkspaceCandidates.mockImplementation(() =>
      Promise.resolve({ ok: true as const, value: [ALPHA, BETA] }))
    const { face, state } = await bench({ documents: remote.slice, session: undefined })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')
    expect(state().members.map(member => member.description)).toEqual([`owns ${ALPHA.sessionId}`])

    face.setWorkspaceSession(BETA.sessionId)

    await vi.waitFor(() => { expect(state().members.map(member => member.description)).toEqual([`owns ${BETA.sessionId}`]) })
    expect(state().workspace.path).toBe(`${BETA.sessionId}/.dsh/team.json`)
  })

  it('drops the staged workspace draft when the session switches', async () => {
    const remote = perProjectDocuments()
    remote.listWorkspaceCandidates.mockImplementation(() =>
      Promise.resolve({ ok: true as const, value: [ALPHA, BETA] }))
    const { face, state } = await bench({ documents: remote.slice, session: undefined })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setScope('workspace')
    face.setMemberName(0, 'edited-in-alpha')
    expect(state().members[0]?.name).toBe('edited-in-alpha')
    expect(state().dirty).toBe(true)

    face.setWorkspaceSession(BETA.sessionId)

    // The staged edit belonged to alpha's file; carrying it into beta's document
    // would write one project's draft over another project's file.
    await vi.waitFor(() => { expect(state().workspace.sessionId).toBe(BETA.sessionId) })
    expect(state().members.map(member => member.name)).toEqual(['owner'])
    expect(state().dirty).toBe(false)
  })

  it('reports an empty candidate list as no session, not as a failure', async () => {
    const remote = documents({ candidates: () => Promise.resolve({ ok: true as const, value: [] }) })
    const { state } = await bench({ documents: remote.slice, session: undefined })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('unavailable') })
    expect(state().workspace.reason).toBe('noSession')
    expect(state().workspace.error).toBeUndefined()
    expect(remote.readTeamDocument).not.toHaveBeenCalled()
  })

  it('reports a refused candidate list as an error carrying its message', async () => {
    const remote = documents({
      candidates: () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'the session corpus is unavailable', {}),
      }),
    })
    const { state } = await bench({ documents: remote.slice, session: undefined })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('error') })
    // A transport failure blames the transport, not the absence of a session.
    expect(state().workspace.reason).toBeUndefined()
    expect(state().workspace.error).toBe('the session corpus is unavailable')
  })

  it('forgets a selection the Host no longer offers', async () => {
    const remote = perProjectDocuments()
    remote.listWorkspaceCandidates.mockImplementation(() =>
      Promise.resolve({ ok: true as const, value: [ALPHA, BETA] }))
    const { controller, face, state } = await bench({ documents: remote.slice, session: undefined })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    face.setWorkspaceSession(BETA.sessionId)
    await vi.waitFor(() => { expect(state().workspace.sessionId).toBe(BETA.sessionId) })

    // Only alpha survives the refresh, so beta would resolve a stale document.
    remote.listWorkspaceCandidates.mockImplementation(() =>
      Promise.resolve({ ok: true as const, value: [ALPHA] }))
    controller.resetConnection()

    await vi.waitFor(() => { expect(state().workspace.candidates).toHaveLength(1) })
    expect(state().workspace.sessionId).toBe(ALPHA.sessionId)
  })
})

describe('AgentTeamLlmCardController candidate retry', () => {
  /** A Host that refuses the candidate list, with the controller settled on that refusal. */
  async function refusedCandidates() {
    const remote = documents({
      candidates: () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'the session corpus is unavailable', {}),
      }),
    })
    const rest = await bench({ documents: remote.slice, session: undefined })
    await vi.waitFor(() => { expect(rest.state().workspace.status).toBe('error') })
    return { remote, ...rest }
  }

  it('asks the Host again when a refused candidate list is retried', async () => {
    const { remote, face, state } = await refusedCandidates()
    expect(remote.listWorkspaceCandidates).toHaveBeenCalledOnce()

    // The retry crossing the wire is what the published refusal must survive.
    const answer = deferred<CandidateAnswer>()
    remote.listWorkspaceCandidates.mockReturnValueOnce(answer.promise)
    face.retryWorkspace()

    await vi.waitFor(() => { expect(remote.listWorkspaceCandidates).toHaveBeenCalledTimes(2) })
    expect(state().workspace.candidatesStatus).toBe('loading')
    expect(state().workspace.status).toBe('error')

    answer.resolve({
      ok: false as const,
      error: new RemoteError('gateway/internal', 'the session corpus is unavailable', {}),
    })
    await vi.waitFor(() => { expect(state().workspace.candidatesStatus).toBe('error') })

    // A second refusal is still blamed on the transport, never on a missing session.
    expect(state().workspace.status).toBe('error')
    expect(state().workspace.error).toBe('the session corpus is unavailable')
    expect(state().workspace.reason).toBeUndefined()
    expect(remote.readTeamDocument).not.toHaveBeenCalled()
  })

  it('offers the answered candidates when a retry succeeds', async () => {
    const { remote, face, state } = await refusedCandidates()

    remote.listWorkspaceCandidates.mockResolvedValueOnce({ ok: true as const, value: [ALPHA, BETA] })
    face.retryWorkspace()

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    // These two fields are the picker's render condition
    // (`AgentTeamLlmCard.tsx:122` `workspace.candidates.length > 0`).
    expect(state().workspace.candidatesStatus).toBe('ready')
    expect(state().workspace.candidates.map(candidate => candidate.sessionId))
      .toEqual([ALPHA.sessionId, BETA.sessionId])
    expect(state().workspace.sessionId).toBe(ALPHA.sessionId)
    expect(state().workspace.error).toBeUndefined()
    expect(remote.readTeamDocument).toHaveBeenCalledWith(ALPHA.sessionId, expect.any(AbortSignal))
  })

  it('does not fan out a parallel request while a retry is in flight', async () => {
    const { remote, face, state } = await refusedCandidates()
    expect(remote.listWorkspaceCandidates).toHaveBeenCalledOnce()

    const answer = deferred<CandidateAnswer>()
    remote.listWorkspaceCandidates.mockReturnValueOnce(answer.promise)
    face.retryWorkspace()
    await vi.waitFor(() => { expect(remote.listWorkspaceCandidates).toHaveBeenCalledTimes(2) })

    // The second retry re-enters with the list already in flight, so it must
    // return without asking the Host for the same list twice.
    face.retryWorkspace()
    await Promise.resolve()
    await Promise.resolve()
    expect(remote.listWorkspaceCandidates).toHaveBeenCalledTimes(2)

    answer.resolve({ ok: true as const, value: [ALPHA] })
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    expect(state().workspace.sessionId).toBe(ALPHA.sessionId)
  })
})

describe('AgentTeamLlmCardController workspace races', () => {
  it('drops a candidate list the connection generation already replaced', async () => {
    const first = deferred<CandidateAnswer>()
    const second = deferred<CandidateAnswer>()
    const remote = documents()
    remote.listWorkspaceCandidates.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { controller, state } = await bench({ documents: remote.slice, session: undefined })

    await vi.waitFor(() => { expect(remote.listWorkspaceCandidates).toHaveBeenCalledTimes(1) })
    controller.resetConnection()
    await vi.waitFor(() => { expect(remote.listWorkspaceCandidates).toHaveBeenCalledTimes(2) })

    // The first answer belongs to the connection that is gone, so it must not
    // repopulate the list the reconnect just cleared.
    first.resolve({ ok: true as const, value: [ALPHA] })
    await Promise.resolve()
    await Promise.resolve()
    expect(state().workspace.candidates).toEqual([])
    expect(remote.readTeamDocument).not.toHaveBeenCalled()

    second.resolve({ ok: true as const, value: [BETA] })
    await vi.waitFor(() => { expect(state().workspace.sessionId).toBe(BETA.sessionId) })
  })

  it('forgets a pick that an in-flight candidate list does not offer', async () => {
    const pending = deferred<CandidateAnswer>()
    const remote = documents()
    remote.listWorkspaceCandidates.mockImplementation(() => pending.promise)
    const { face, state } = await bench({ documents: remote.slice, session: undefined })

    await vi.waitFor(() => { expect(remote.listWorkspaceCandidates).toHaveBeenCalledOnce() })
    face.setWorkspaceSession(BETA.sessionId)

    // The answer offers only alpha; keeping beta selected would resolve a
    // document for a project the Host has stopped offering.
    await vi.waitFor(() => { expect(state().workspace.sessionId).toBe(BETA.sessionId) })
    pending.resolve({ ok: true as const, value: [ALPHA] })
    await vi.waitFor(() => { expect(state().workspace.candidates).toHaveLength(1) })

    face.retryWorkspace()

    await vi.waitFor(() => { expect(state().workspace.sessionId).toBe(ALPHA.sessionId) })
  })

  it('ignores a pick while the workspace document is still being read', async () => {
    const read = deferred<ReadAnswer>()
    const remote = documents()
    remote.readTeamDocument.mockImplementation(() => read.promise)
    const { face, state } = await bench({ documents: remote.slice, session: SESSION })

    await vi.waitFor(() => { expect(remote.readTeamDocument).toHaveBeenCalledOnce() })
    face.setWorkspaceSession(ALPHA.sessionId)

    // The read already crossing the wire answers for the session it started on.
    expect(remote.readTeamDocument).toHaveBeenCalledOnce()
    expect(state().workspace.sessionId).toBe(SESSION)

    read.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json', document: TEAM_DOCUMENT } })
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

    face.setWorkspaceSession(ALPHA.sessionId)
    expect(remote.readTeamDocument).toHaveBeenCalledTimes(1)

    write.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json' } })
    await vi.waitFor(() => { expect(state().saving).toBe(false) })
  })

  it('ignores a pick after the controller is disposed', async () => {
    const remote = documents()
    const { controller, state } = await bench({ documents: remote.slice })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    controller.dispose()
    controller.inject().setWorkspaceSession(ALPHA.sessionId)

    expect(remote.readTeamDocument).toHaveBeenCalledOnce()
  })
})

describe('AgentTeamLlmCardController live session precedence', () => {
  it('resolves the live main-view session even after the user picked another project', async () => {
    const remote = perProjectDocuments()
    remote.listWorkspaceCandidates.mockImplementation(() =>
      Promise.resolve({ ok: true as const, value: [ALPHA, BETA] }))
    // The settings page itself retains nothing, but the browser table does while
    // the operator is looking at a session; the card follows that table first.
    const { face, state } = await bench({ documents: remote.slice, session: SESSION })

    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })
    expect(state().workspace.sessionId).toBe(SESSION)

    face.setWorkspaceSession(BETA.sessionId)

    // The retained session is what the operator is actually looking at, so it
    // outranks even an explicit pick until it is released.
    await vi.waitFor(() => { expect(remote.readTeamDocument).toHaveBeenCalledTimes(2) })
    expect(state().workspace.sessionId).toBe(SESSION)
    expect(remote.readTeamDocument).toHaveBeenLastCalledWith(SESSION, expect.any(AbortSignal))
  })
})

const PICKER_ALPHA = { sessionId: SessionId('session-alpha'), cwd: '/projects/alpha', createdAt: 20 }
const PICKER_WINDOWS = { sessionId: SessionId('session-win'), cwd: 'C:\\work\\beta', createdAt: 10 }

/** The project picker rendered for one snapshot. */
function renderPicker(state: Partial<AgentTeamLlmCardState> = {}) {
  return renderCard({
    scope: 'workspace',
    workspace: {
      status: 'ready',
      path: '/projects/alpha/.dsh/team.json',
      error: undefined,
      reason: undefined,
      candidatesStatus: 'ready',
      candidates: [PICKER_ALPHA, PICKER_WINDOWS],
      sessionId: PICKER_ALPHA.sessionId,
    },
    ...state,
  })
}

describe('AgentTeamLlmCard project picker', () => {
  it('labels each project by the last segment of its working directory', () => {
    renderPicker()

    const picker = screen.getByLabelText(en.agentTeamLlmWorkspaceSession)
    const options = within(picker).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map(option => option.textContent)).toEqual(['alpha', 'beta'])
    // The full path stays reachable as the tooltip, because the last segment
    // alone cannot tell two checkouts of the same repository apart.
    expect(options.map(option => option.title)).toEqual(['/projects/alpha', 'C:\\work\\beta'])
  })

  it('stages the chosen project identity rather than the raw option string', () => {
    const { actions } = renderPicker()

    fireEvent.change(screen.getByLabelText(en.agentTeamLlmWorkspaceSession), {
      target: { value: PICKER_WINDOWS.sessionId },
    })

    expect(actions.setWorkspaceSession).toHaveBeenCalledWith(PICKER_WINDOWS.sessionId)
  })

  it('keeps a working directory that has no final segment', () => {
    const root = { sessionId: SessionId('session-root'), cwd: '/', createdAt: 30 }
    renderPicker({
      workspace: {
        status: 'ready', path: '/.dsh/team.json', error: undefined, reason: undefined,
        candidatesStatus: 'ready', candidates: [root], sessionId: root.sessionId,
      },
    })

    const options = within(screen.getByLabelText(en.agentTeamLlmWorkspaceSession))
      .getAllByRole('option') as HTMLOptionElement[]
    // Splitting `/` yields no segment to name the project, so the path itself
    // is the only label left.
    expect(options.map(option => option.textContent)).toEqual(['/'])
    expect(options.map(option => option.title)).toEqual(['/'])
  })

  it('offers the picker before a subject resolves', () => {
    const { actions } = renderPicker({
      workspace: {
        status: 'ready', path: '/projects/alpha/.dsh/team.json', error: undefined, reason: undefined,
        candidatesStatus: 'ready', candidates: [PICKER_ALPHA, PICKER_WINDOWS], sessionId: undefined,
      },
    })

    // The list can arrive before a subject resolves; it is still the operator's
    // to choose from, so no option may be dropped while the selection is empty.
    const picker = screen.getByLabelText(en.agentTeamLlmWorkspaceSession)
    const options = within(picker).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map(option => option.value)).toEqual([PICKER_ALPHA.sessionId, PICKER_WINDOWS.sessionId])

    fireEvent.change(picker, { target: { value: PICKER_WINDOWS.sessionId } })
    expect(actions.setWorkspaceSession).toHaveBeenCalledWith(PICKER_WINDOWS.sessionId)
  })

  it('ignores a change that names no offered project', () => {
    const { actions } = renderPicker()

    fireEvent.change(screen.getByLabelText(en.agentTeamLlmWorkspaceSession), {
      target: { value: 'session-nobody-offers' },
    })

    // Only an identity the Host minted may be staged, never the raw option string.
    expect(actions.setWorkspaceSession).not.toHaveBeenCalled()
  })

  it('disables the picker while the layer reads and while a save is in flight', () => {
    const { store } = renderPicker()
    expect(screen.getByLabelText(en.agentTeamLlmWorkspaceSession)).toHaveProperty('disabled', false)

    // The store lives outside React, so each write has to be flushed through
    // `act` before the rendered `<select>` reflects it.
    act(() => { store.set({ ...store.getSnapshot(), workspace: { ...store.getSnapshot().workspace, status: 'loading' } }) })
    expect(screen.getByLabelText(en.agentTeamLlmWorkspaceSession)).toHaveProperty('disabled', true)

    act(() => { store.set({ ...store.getSnapshot(), workspace: { ...store.getSnapshot().workspace, status: 'ready' }, saving: true }) })
    expect(screen.getByLabelText(en.agentTeamLlmWorkspaceSession)).toHaveProperty('disabled', true)
  })

  it('offers no picker while the Host has named no project', () => {
    renderPicker({
      workspace: {
        status: 'ready', path: '/projects/alpha/.dsh/team.json', error: undefined, reason: undefined,
        candidatesStatus: 'ready', candidates: [], sessionId: undefined,
      },
    })

    expect(screen.queryByLabelText(en.agentTeamLlmWorkspaceSession)).toBeNull()
  })
})
