// @vitest-environment jsdom
/** The workspace layer of the card: scope switching, the team document read and write, and member rows. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  read?: () => ReturnType<AgentTeamLlmTeamDocuments['readTeamDocument']>
  save?: () => ReturnType<AgentTeamLlmTeamDocuments['saveTeamDocument']>
} = {}) {
  const readTeamDocument = vi.fn(options.read ?? (() => Promise.resolve({
    ok: true as const,
    value: { path: '/project/.dsh/team.json', document: TEAM_DOCUMENT },
  })))
  const saveTeamDocument = vi.fn(options.save ?? (() => Promise.resolve({
    ok: true as const, value: { path: '/project/.dsh/team.json' },
  })))
  return { slice: { readTeamDocument, saveTeamDocument } satisfies AgentTeamLlmTeamDocuments, readTeamDocument, saveTeamDocument }
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
    workspace: { status: 'ready', path: '/project/.dsh/team.json', error: undefined, reason: undefined },
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
      workspace: { status: 'unavailable', path: undefined, error: undefined, reason: 'noProjectRoot' },
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
      workspace: { status: 'error', path: undefined, error: 'the document is not valid JSON', reason: undefined },
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
      workspace: { status: 'error', path: undefined, error: 'the document is not valid JSON', reason: undefined },
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
