// @vitest-environment jsdom
/**
 * The per-member sandbox scope: the draft round trip, the controller's staging
 * and save payload, and the row control the editor renders.
 *
 * Each case stages the field it asserts, so dropping sandbox handling from any
 * one of those layers turns the matching case red instead of leaving an
 * unasserted field behind.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { AgentTeamLlmCard, type AgentTeamLlmCardProps } from '../src/client/AgentTeamLlmCard.tsx'
import {
  AgentTeamLlmCardController, type AgentTeamLlmCardState, type AgentTeamLlmSettings,
} from '../src/client/agent-team-llm-card-controller.ts'
import {
  agentTeamLlmMemberDrafts, agentTeamLlmTeamMemberOf, emptyAgentTeamLlmMember,
  sameAgentTeamLlmMember, type AgentTeamLlmMemberDraft,
} from '../src/client/team-document.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const SESSION = SessionId('session-1')

/** A staged row with every required field filled, so each case changes one thing. */
function draft(overrides: Partial<AgentTeamLlmMemberDraft> = {}): AgentTeamLlmMemberDraft {
  return { ...emptyAgentTeamLlmMember(), name: 'recon', description: 'Reads the tree.', ...overrides }
}

/** Make the stub Host accept every write the way a ready section would. */
function acceptWrites<T>(host: ReturnType<typeof stubConfigForm<T>>): void {
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const section: Record<string, unknown> = { ...host.scope.getSnapshot().value as object }
    const user: Record<string, unknown> = {}
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        section[field] = op.value
        user[field] = op.value
      }
    }
    host.publish({ value: section as T, user })
    return Promise.resolve(true)
  })
}

describe('member sandbox draft round trip', () => {
  it('reads a stored scope into the draft and an absent scope as the inherit value', () => {
    const drafts = agentTeamLlmMemberDrafts({
      members: [
        { name: 'recon', description: 'Reads.', sandboxMode: 'read-only' },
        { name: 'writer', description: 'Writes.' },
      ],
    })

    expect(drafts[0]?.sandboxMode).toBe('read-only')
    expect(drafts[1]?.sandboxMode).toBe('')
  })

  it('omits the key entirely when the draft inherits the team default', () => {
    const stored = agentTeamLlmTeamMemberOf(draft())

    // `toBeUndefined` would also pass for a stored `sandboxMode: undefined`,
    // which the Host document format would reject as a non-mode.
    expect(stored).not.toHaveProperty('sandboxMode')
    expect(stored).toEqual({ name: 'recon', description: 'Reads the tree.', context: 'fresh' })
  })

  it('writes the scope the draft declares', () => {
    expect(agentTeamLlmTeamMemberOf(draft({ sandboxMode: 'danger-full-access' })))
      .toMatchObject({ sandboxMode: 'danger-full-access' })
  })

  it('survives a draft -> document -> draft cycle unchanged', () => {
    const original = draft({ sandboxMode: 'workspace-write', prompt: 'Read first.' })

    const [again] = agentTeamLlmMemberDrafts({ members: [agentTeamLlmTeamMemberOf(original)] })

    expect(again?.sandboxMode).toBe('workspace-write')
    expect(again?.prompt).toBe('Read first.')
    expect(sameAgentTeamLlmMember(original, again!)).toBe(true)
  })

  it('treats a changed scope as a different member and an unchanged one as the same', () => {
    const base = draft({ sandboxMode: 'read-only' })

    expect(sameAgentTeamLlmMember(base, draft({ sandboxMode: 'workspace-write' }))).toBe(false)
    expect(sameAgentTeamLlmMember(base, draft({ sandboxMode: 'read-only' }))).toBe(true)
    expect(sameAgentTeamLlmMember(base, draft())).toBe(false)
  })
})

describe('member sandbox controller staging', () => {
  /** A ready global section, an idle catalog, and the controller bound to both. */
  function globalBench(members: NonNullable<AgentTeamLlmSettings['members']>) {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({
      status: 'ready', writable: true, revision: 1,
      value: {
        enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }], roleRoutes: [],
        defaultProvider: 'alpha', defaultModel: 'fast', members,
      },
      user: {},
    })
    const catalog = {
      remote: { session: { modelCatalog: () => Promise.resolve({ ok: true as const, value: { groups: [], failures: [] } }) } },
    }
    const documents = {
      readTeamDocument: () => Promise.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json', document: null } }),
      saveTeamDocument: vi.fn(() => Promise.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json' } })),
      listWorkspaceCandidates: () => Promise.resolve({ ok: true as const, value: [] }),
    }
    const controller = new AgentTeamLlmCardController(host.scope, catalog as never, documents, () => SESSION)
    const face = controller.inject()
    return { host, documents, face, state: () => face.hooks.agentTeamLlmCard.getSnapshot() }
  }

  it('stages a scope on a global member and marks the draft dirty', async () => {
    const { face, state } = globalBench([
      { name: 'recon', description: 'Reads the tree.' },
      { name: 'writer', description: 'Writes the report.' },
    ])
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    expect(state().members.map(member => member.sandboxMode)).toEqual(['', ''])
    face.setMemberSandboxMode(1, 'danger-full-access')

    expect(state().members[1]?.sandboxMode).toBe('danger-full-access')
    // Only the scope changed, so this is exactly the "dirty" case the save button keys on.
    expect(state().dirty).toBe(true)
  })

  it('saves the scope through the global members op', async () => {
    const { host, face, state } = globalBench([{ name: 'recon', description: 'Reads the tree.' }])
    acceptWrites(host)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    face.setMemberSandboxMode(0, 'read-only')
    face.save()

    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: true },
        { op: 'set', path: ['allowedRoutes'], value: [{ provider: 'alpha', model: 'fast' }] },
        { op: 'set', path: ['roleRoutes'], value: [] },
        { op: 'set', path: ['defaultProvider'], value: 'alpha' },
        { op: 'set', path: ['defaultModel'], value: 'fast' },
        { op: 'set', path: ['members'], value: [{ name: 'recon', description: 'Reads the tree.', context: 'fresh', sandboxMode: 'read-only' }] },
      ], 1)
    })
  })

  it('writes the scope into the workspace document and settles the draft', async () => {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({
      status: 'ready', writable: true, revision: 1,
      value: { enabled: false, allowedRoutes: [], roleRoutes: [], defaultProvider: '', defaultModel: '' },
      user: {},
    })
    const documents = {
      readTeamDocument: () => Promise.resolve({
        ok: true as const,
        value: { path: '/project/.dsh/team.json', document: { version: 1 as const, members: [{ name: 'recon', description: 'Reads the tree.' }] } },
      }),
      saveTeamDocument: vi.fn(() => Promise.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json' } })),
      listWorkspaceCandidates: () => Promise.resolve({ ok: true as const, value: [] }),
    }
    const catalog = {
      remote: { session: { modelCatalog: () => Promise.resolve({ ok: true as const, value: { groups: [], failures: [] } }) } },
    }
    const controller = new AgentTeamLlmCardController(host.scope, catalog as never, documents, () => SESSION)
    const face = controller.inject()
    const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    face.setScope('workspace')
    face.setMemberSandboxMode(0, 'workspace-write')
    face.save()

    await vi.waitFor(() => { expect(documents.saveTeamDocument).toHaveBeenCalledOnce() })
    expect(documents.saveTeamDocument).toHaveBeenCalledWith(SESSION, {
      version: 1,
      members: [{ name: 'recon', description: 'Reads the tree.', context: 'fresh', sandboxMode: 'workspace-write' }],
    }, expect.any(AbortSignal))
    expect(state().dirty).toBe(false)
  })
})

describe('member sandbox row control', () => {
  const shell: SettingsFormShell = {
    available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
  }

  /** The card as the Plugins page renders it, over one snapshot. */
  function renderCard(state: Partial<AgentTeamLlmCardState> = {}) {
    const store = createSnapshotStore<AgentTeamLlmCardState>({
      ...shell,
      scope: 'global',
      workspace: { status: 'ready', path: '/project/.dsh/team.json', error: undefined, reason: undefined, candidatesStatus: 'ready', candidates: [], sessionId: undefined },
      enabled: true,
      candidates: [],
      allowed: [],
      defaultRoute: { provider: 'alpha', model: 'fast' },
      roles: [],
      members: [{
        name: 'recon', description: 'Reads the tree.', prompt: '', context: 'fresh', sandboxMode: '',
        key: '', route: { provider: '', model: '' }, problems: [],
      }],
      catalogStatus: 'ready',
      catalogPartial: false,
      conflicted: false,
      problems: [],
      ...state,
    })
    const actions = {
      setScope: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), setMemberName: vi.fn(),
      setMemberDescription: vi.fn(), setMemberPrompt: vi.fn(), setMemberContext: vi.fn(),
      setMemberSandboxMode: vi.fn(), setMemberRoute: vi.fn(), setMemberRouteFields: vi.fn(),
      setMemberEffort: vi.fn(), retryWorkspace: vi.fn(), toggleEnabled: vi.fn(), toggleRoute: vi.fn(),
      addAllowedRoute: vi.fn(), removeAllowedRoute: vi.fn(), setRouteEffort: vi.fn(),
      setDefaultRoute: vi.fn(), retryCatalog: vi.fn(), addRole: vi.fn(), removeRole: vi.fn(),
      setRoleName: vi.fn(), setRoleRoute: vi.fn(), setRoleEffort: vi.fn(),
      save: vi.fn(), discard: vi.fn(),
    }
    const props = { ...actions, view: 'page', t, useAgentTeamLlmCard: bindSnapshotSelector(store) } as AgentTeamLlmCardProps
    render(<AgentTeamLlmCard {...props} />)
    return { actions, store }
  }

  it('renders the scope control in the global scope, where members are editable', () => {
    renderCard({ scope: 'global' })

    const control = screen.getByLabelText(en.agentTeamLlmMemberSandbox) as HTMLSelectElement
    expect(control.value).toBe('')
    expect([...control.options].map(option => option.value)).toEqual([
      '', 'read-only', 'workspace-write', 'danger-full-access',
    ])
    expect([...control.options].map(option => option.textContent)).toEqual([
      en.agentTeamLlmMemberSandboxInherit,
      en.agentTeamLlmMemberSandboxReadOnly,
      en.agentTeamLlmMemberSandboxWorkspaceWrite,
      en.agentTeamLlmMemberSandboxFullAccess,
    ])
    expect(control).toHaveProperty('disabled', false)
  })

  it('stages the chosen scope and falls back to inherit for an unknown value', () => {
    const { actions } = renderCard({ scope: 'global' })
    const control = screen.getByLabelText(en.agentTeamLlmMemberSandbox)

    fireEvent.change(control, { target: { value: 'workspace-write' } })
    expect(actions.setMemberSandboxMode).toHaveBeenCalledWith(0, 'workspace-write')

    // A value the three-mode grammar does not accept must stage the inherit
    // value rather than an unmapped string the Host would refuse.
    fireEvent.change(control, { target: { value: 'sudo' } })
    expect(actions.setMemberSandboxMode).toHaveBeenLastCalledWith(0, '')

    expect(actions.setMemberSandboxMode).toHaveBeenCalledTimes(2)
  })

  it('shows the stored scope on its row and locks it while read-only', () => {
    renderCard({
      scope: 'global',
      members: [{
        name: 'recon', description: 'Reads the tree.', prompt: '', context: 'fresh', sandboxMode: 'danger-full-access',
        key: '', route: { provider: '', model: '' }, problems: [],
      }],
    })

    expect((screen.getByLabelText(en.agentTeamLlmMemberSandbox) as HTMLSelectElement).value)
      .toBe('danger-full-access')

    cleanup()
    renderCard({ scope: 'global', writable: false })
    expect(screen.getByLabelText(en.agentTeamLlmMemberSandbox)).toHaveProperty('disabled', true)
  })
})
