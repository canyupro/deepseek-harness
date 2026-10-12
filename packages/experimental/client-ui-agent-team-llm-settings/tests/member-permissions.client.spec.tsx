// @vitest-environment jsdom
/**
 * Per-member permissions: the sandbox/approval knob round trip, the named-preset
 * selection the controller stages, and the selector row the editor renders.
 *
 * A member stores two knobs but selects one name, so each case stages the layer
 * it asserts: dropping a knob, the name resolution, or the control turns the
 * matching case red instead of leaving an unasserted field behind.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { TeamMemberPermissionCatalog } from '@deepseek-ai/dsh-experimental-agent-team-llm-settings'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { AgentTeamLlmCard, type AgentTeamLlmCardProps } from '../src/client/AgentTeamLlmCard.tsx'
import {
  AgentTeamLlmCardController, type AgentTeamLlmCardState, type AgentTeamLlmSettings,
} from '../src/client/agent-team-llm-card-controller.ts'
import {
  agentTeamLlmMemberDrafts, agentTeamLlmMemberPermission, agentTeamLlmMemberPermissionKnobs,
  agentTeamLlmTeamMemberOf, emptyAgentTeamLlmMember, sameAgentTeamLlmMember,
  type AgentTeamLlmMemberDraft,
} from '../src/client/team-document.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const SESSION = SessionId('session-1')

/**
 * The options the Host serves. One label equals its key, so the card renders its
 * own localized copy for it; the other carries a Host label, which must win.
 */
const CATALOG: TeamMemberPermissionCatalog = {
  presets: [
    { name: 'read-only', label: 'read-only', sandbox: 'read-only', approval: 'never' },
    { name: 'danger-full-access', label: 'Full access', sandbox: 'danger-full-access', approval: 'ask' },
  ],
  custom: { name: 'custom', label: 'Custom' },
}

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

describe('member permission draft round trip', () => {
  it('reads stored knobs into the draft and absent ones as the inherit value', () => {
    const drafts = agentTeamLlmMemberDrafts({
      members: [
        { name: 'recon', description: 'Reads.', sandboxMode: 'read-only', approvalPolicy: 'never' },
        { name: 'writer', description: 'Writes.' },
      ],
    })

    expect(drafts[0]?.sandboxMode).toBe('read-only')
    expect(drafts[0]?.approvalPolicy).toBe('never')
    expect(drafts[1]?.sandboxMode).toBe('')
    expect(drafts[1]?.approvalPolicy).toBe('')
  })

  it('omits both knobs entirely when the draft inherits the team default', () => {
    const stored = agentTeamLlmTeamMemberOf(draft())

    // `toBeUndefined` would also pass for a stored `sandboxMode: undefined`,
    // which the Host document format would reject as a non-mode.
    expect(stored).not.toHaveProperty('sandboxMode')
    expect(stored).not.toHaveProperty('approvalPolicy')
    expect(stored).toEqual({ name: 'recon', description: 'Reads the tree.', context: 'fresh' })
  })

  it('writes the knobs the draft declares', () => {
    expect(agentTeamLlmTeamMemberOf(draft({ sandboxMode: 'danger-full-access', approvalPolicy: 'ask' })))
      .toMatchObject({ sandboxMode: 'danger-full-access', approvalPolicy: 'ask' })
  })

  it('survives a draft -> document -> draft cycle unchanged', () => {
    const original = draft({ sandboxMode: 'workspace-write', approvalPolicy: 'never', prompt: 'Read first.' })

    const [again] = agentTeamLlmMemberDrafts({ members: [agentTeamLlmTeamMemberOf(original)] })

    expect(again?.sandboxMode).toBe('workspace-write')
    expect(again?.approvalPolicy).toBe('never')
    expect(again?.prompt).toBe('Read first.')
    expect(sameAgentTeamLlmMember(original, again!)).toBe(true)
  })

  it('treats a changed knob as a different member and an unchanged one as the same', () => {
    const base = draft({ sandboxMode: 'read-only', approvalPolicy: 'never' })

    expect(sameAgentTeamLlmMember(base, draft({ sandboxMode: 'workspace-write', approvalPolicy: 'never' }))).toBe(false)
    // The pair is what the row stores, so an approval-only change is a change.
    expect(sameAgentTeamLlmMember(base, draft({ sandboxMode: 'read-only', approvalPolicy: 'ask' }))).toBe(false)
    expect(sameAgentTeamLlmMember(base, draft({ sandboxMode: 'read-only', approvalPolicy: 'never' }))).toBe(true)
    expect(sameAgentTeamLlmMember(base, draft())).toBe(false)
  })
})

describe('member permission name resolution', () => {
  it('selects the inherit, configured-preset, and derived values of one knob pair', () => {
    expect(agentTeamLlmMemberPermission(draft(), CATALOG)).toBe('')
    expect(agentTeamLlmMemberPermission(draft({ sandboxMode: 'read-only', approvalPolicy: 'never' }), CATALOG))
      .toBe('read-only')
    // No configured preset carries this pair, so the Host's derived value names it.
    expect(agentTeamLlmMemberPermission(draft({ sandboxMode: 'workspace-write', approvalPolicy: 'never' }), CATALOG))
      .toBe('custom')
  })

  it('carries the machine pair rather than claiming an option the Host never confirmed', () => {
    expect(agentTeamLlmMemberPermission(draft({ sandboxMode: 'read-only', approvalPolicy: 'never' }), null))
      .toBe('read-only|never')
    expect(agentTeamLlmMemberPermission(draft(), null)).toBe('')
  })

  it('writes a configured preset pair and inherits for every other name', () => {
    expect(agentTeamLlmMemberPermissionKnobs('danger-full-access', CATALOG))
      .toEqual({ sandboxMode: 'danger-full-access', approvalPolicy: 'ask' })
    expect(agentTeamLlmMemberPermissionKnobs('', CATALOG))
      .toEqual({ sandboxMode: '', approvalPolicy: '' })
    // The derived value is a display state, never a switch target.
    expect(agentTeamLlmMemberPermissionKnobs('custom', CATALOG))
      .toEqual({ sandboxMode: '', approvalPolicy: '' })
    // An option the Host no longer advertises must not invent a pair.
    expect(agentTeamLlmMemberPermissionKnobs('sudo', CATALOG))
      .toEqual({ sandboxMode: '', approvalPolicy: '' })
  })
})

describe('member permission controller staging', () => {
  /** A ready global section, an answering permission catalog, and the controller bound to both. */
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
      listMemberPermissionPresets: () => Promise.resolve({ ok: true as const, value: CATALOG }),
    }
    const controller = new AgentTeamLlmCardController(host.scope, catalog as never, documents, () => SESSION)
    const face = controller.inject()
    return { host, documents, face, state: () => face.hooks.agentTeamLlmCard.getSnapshot() }
  }

  it('stages both knobs of the chosen preset on a global member and marks the draft dirty', async () => {
    const { face, state } = globalBench([
      { name: 'recon', description: 'Reads the tree.' },
      { name: 'writer', description: 'Writes the report.' },
    ])
    await vi.waitFor(() => { expect(state().memberPermissions).not.toBeNull() })

    expect(state().members.map(member => member.permission)).toEqual(['', ''])
    face.setMemberPermissions(1, 'danger-full-access')

    expect(state().members[1]?.sandboxMode).toBe('danger-full-access')
    expect(state().members[1]?.approvalPolicy).toBe('ask')
    expect(state().members[1]?.permission).toBe('danger-full-access')
    // Only the permissions changed, so this is exactly the "dirty" case the save button keys on.
    expect(state().dirty).toBe(true)
  })

  it('stages the inherit knobs for a name the Host does not advertise', async () => {
    const { face, state } = globalBench([{ name: 'recon', description: 'Reads the tree.', sandboxMode: 'read-only', approvalPolicy: 'never' }])
    await vi.waitFor(() => { expect(state().memberPermissions).not.toBeNull() })
    expect(state().members[0]?.permission).toBe('read-only')

    // An unknown value must clear the pair rather than invent a mode the Host refuses.
    face.setMemberPermissions(0, 'sudo')

    expect(state().members[0]?.sandboxMode).toBe('')
    expect(state().members[0]?.approvalPolicy).toBe('')
  })

  it('saves the preset knobs through the global members op', async () => {
    const { host, face, state } = globalBench([{ name: 'recon', description: 'Reads the tree.' }])
    acceptWrites(host)
    await vi.waitFor(() => { expect(state().memberPermissions).not.toBeNull() })

    face.setMemberPermissions(0, 'danger-full-access')
    face.save()

    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: true },
        { op: 'set', path: ['allowedRoutes'], value: [{ provider: 'alpha', model: 'fast' }] },
        { op: 'set', path: ['roleRoutes'], value: [] },
        { op: 'set', path: ['defaultProvider'], value: 'alpha' },
        { op: 'set', path: ['defaultModel'], value: 'fast' },
        {
          op: 'set',
          path: ['members'],
          value: [{
            name: 'recon', description: 'Reads the tree.', context: 'fresh',
            sandboxMode: 'danger-full-access', approvalPolicy: 'ask',
          }],
        },
      ], 1)
    })
  })

  it('writes the preset knobs into the workspace document and settles the draft', async () => {
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
      listMemberPermissionPresets: () => Promise.resolve({ ok: true as const, value: CATALOG }),
    }
    const catalog = {
      remote: { session: { modelCatalog: () => Promise.resolve({ ok: true as const, value: { groups: [], failures: [] } }) } },
    }
    const controller = new AgentTeamLlmCardController(host.scope, catalog as never, documents, () => SESSION)
    const face = controller.inject()
    const state = () => face.hooks.agentTeamLlmCard.getSnapshot()
    await vi.waitFor(() => { expect(state().workspace.status).toBe('ready') })

    face.setScope('workspace')
    face.setMemberPermissions(0, 'danger-full-access')
    face.save()

    await vi.waitFor(() => { expect(documents.saveTeamDocument).toHaveBeenCalledOnce() })
    expect(documents.saveTeamDocument).toHaveBeenCalledWith(SESSION, {
      version: 1,
      members: [{
        name: 'recon', description: 'Reads the tree.', context: 'fresh',
        sandboxMode: 'danger-full-access', approvalPolicy: 'ask',
      }],
    }, expect.any(AbortSignal))
    expect(state().dirty).toBe(false)
  })

  it('keeps a row declaring knobs on its machine pair until the Host answers', async () => {
    const host = stubConfigForm<AgentTeamLlmSettings>()
    host.publish({
      status: 'ready', writable: true, revision: 1,
      value: {
        enabled: true, allowedRoutes: [{ provider: 'alpha', model: 'fast' }], roleRoutes: [],
        defaultProvider: 'alpha', defaultModel: 'fast',
        members: [{ name: 'recon', description: 'Reads the tree.', sandboxMode: 'read-only', approvalPolicy: 'never' }],
      },
      user: {},
    })
    const pending = new Promise<never>(() => {})
    const documents = {
      readTeamDocument: () => Promise.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json', document: null } }),
      saveTeamDocument: vi.fn(() => Promise.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json' } })),
      listWorkspaceCandidates: () => Promise.resolve({ ok: true as const, value: [] }),
      listMemberPermissionPresets: () => pending,
    }
    const catalog = {
      remote: { session: { modelCatalog: () => Promise.resolve({ ok: true as const, value: { groups: [], failures: [] } }) } },
    }
    const controller = new AgentTeamLlmCardController(host.scope, catalog as never, documents, () => SESSION)
    const state = () => controller.inject().hooks.agentTeamLlmCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })

    expect(state().memberPermissions).toBeNull()
    expect(state().members[0]?.permission).toBe('read-only|never')
  })
})

describe('member permission row control', () => {
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
      memberPermissions: CATALOG,
      members: [{
        name: 'recon', description: 'Reads the tree.', prompt: '', context: 'fresh', sandboxMode: '',
        approvalPolicy: '', key: '', route: { provider: '', model: '' }, permission: '', problems: [],
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
      setMemberPermissions: vi.fn(), setMemberRoute: vi.fn(), setMemberRouteFields: vi.fn(),
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

  it('offers the inherit value and every configured preset the Host serves', () => {
    renderCard({ scope: 'global' })

    const control = screen.getByLabelText(en.agentTeamLlmMemberSandbox) as HTMLSelectElement
    expect(control.value).toBe('')
    expect([...control.options].map(option => option.value)).toEqual(['', 'read-only', 'danger-full-access'])
    // The card localizes a conventional key it owns; a Host label wins when the
    // deployment renamed the preset.
    expect([...control.options].map(option => option.textContent)).toEqual([
      en.agentTeamLlmMemberSandboxInherit,
      en.agentTeamLlmMemberSandboxReadOnly,
      'Full access',
    ])
    expect(control).toHaveProperty('disabled', false)
  })

  it('stages the chosen preset name and locks the selector while read-only', () => {
    const { actions } = renderCard({ scope: 'global' })
    const control = screen.getByLabelText(en.agentTeamLlmMemberSandbox)

    fireEvent.change(control, { target: { value: 'danger-full-access' } })
    expect(actions.setMemberPermissions).toHaveBeenCalledWith(0, 'danger-full-access')

    cleanup()
    renderCard({ scope: 'global', writable: false })
    expect(screen.getByLabelText(en.agentTeamLlmMemberSandbox)).toHaveProperty('disabled', true)
  })

  it('shows the selected preset by name on its row', () => {
    renderCard({
      scope: 'global',
      members: [{
        name: 'recon', description: 'Reads the tree.', prompt: '', context: 'fresh',
        sandboxMode: 'danger-full-access', approvalPolicy: 'ask',
        key: '', route: { provider: '', model: '' }, permission: 'danger-full-access', problems: [],
      }],
    })

    expect((screen.getByLabelText(en.agentTeamLlmMemberSandbox) as HTMLSelectElement).value)
      .toBe('danger-full-access')
  })

  it('shows the derived value for a pair no configured preset matches, as a locked row', () => {
    renderCard({
      scope: 'global',
      members: [{
        name: 'recon', description: 'Reads the tree.', prompt: '', context: 'fresh',
        sandboxMode: 'workspace-write', approvalPolicy: 'never',
        key: '', route: { provider: '', model: '' }, permission: 'custom', problems: [],
      }],
    })

    const control = screen.getByLabelText(en.agentTeamLlmMemberSandbox) as HTMLSelectElement
    expect(control.value).toBe('custom')
    const derived = [...control.options].find(option => option.value === 'custom')!
    expect(derived.textContent).toBe('Custom')
    // The derived value is a display state, so it is not a switch target.
    expect(derived).toHaveProperty('disabled', true)
  })

  it('shows the machine pair while the Host has not answered with its catalog', () => {
    renderCard({
      scope: 'global',
      memberPermissions: null,
      members: [{
        name: 'recon', description: 'Reads the tree.', prompt: '', context: 'fresh',
        sandboxMode: 'read-only', approvalPolicy: 'never',
        key: '', route: { provider: '', model: '' }, permission: 'read-only|never', problems: [],
      }],
    })

    const control = screen.getByLabelText(en.agentTeamLlmMemberSandbox) as HTMLSelectElement
    expect(control.value).toBe('read-only|never')
    expect([...control.options].map(option => option.textContent)).toEqual([
      en.agentTeamLlmMemberSandboxInherit,
      'read-only|never',
    ])
  })
})
