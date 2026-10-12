// @vitest-environment jsdom
/**
 * The card's scope tabs and the workspace layer notices, including the two
 * distinct reasons a workspace layer can be unavailable.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { AgentTeamLlmCard, type AgentTeamLlmCardProps } from '../src/client/AgentTeamLlmCard.tsx'
import type { AgentTeamLlmCardState } from '../src/client/agent-team-llm-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const shell: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}

type Workspace = AgentTeamLlmCardState['workspace']

/** The card over one snapshot. */
function renderCard(state: Partial<AgentTeamLlmCardState> = {}) {
  const store = createSnapshotStore<AgentTeamLlmCardState>({
    ...shell,
    scope: 'global',
    workspace: { status: 'ready', path: '/project/.dsh/team.json', error: undefined, reason: undefined, candidatesStatus: 'ready', candidates: [], sessionId: undefined },
    enabled: true,
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

describe('card scope tabs', () => {
  it('asks for each layer when its tab is pressed', () => {
    const { actions } = renderCard({ scope: 'global' })
    const [global, workspace] = screen.getAllByRole('tab') as HTMLButtonElement[]

    expect(global!.getAttribute('aria-selected')).toBe('true')
    expect(workspace).toHaveProperty('disabled', false)

    fireEvent.click(workspace!)
    expect(actions.setScope).toHaveBeenCalledWith('workspace')

    fireEvent.click(global!)
    expect(actions.setScope).toHaveBeenLastCalledWith('global')
  })

  it('marks the workspace tab selected in that layer', () => {
    renderCard({ scope: 'workspace' })

    const [global, workspace] = screen.getAllByRole('tab')
    expect(global!.getAttribute('aria-selected')).toBe('false')
    expect(workspace!.getAttribute('aria-selected')).toBe('true')
  })
})

describe('workspace layer notices', () => {
  it('reports a layer that is still being read', () => {
    renderCard({ workspace: { status: 'loading', path: undefined, error: undefined, reason: undefined, candidatesStatus: 'idle', candidates: [], sessionId: undefined } })

    expect(screen.getByRole('status').textContent).toBe(en.agentTeamLlmWorkspaceLoading)
  })

  it('names no session separately from no project root', () => {
    renderCard({ workspace: { status: 'unavailable', path: undefined, error: undefined, reason: 'noSession', candidatesStatus: 'ready', candidates: [], sessionId: undefined } })
    expect(screen.getByRole('status').textContent).toBe(en.agentTeamLlmWorkspaceNoSession)

    cleanup()
    renderCard({ workspace: { status: 'unavailable', path: undefined, error: undefined, reason: 'noProjectRoot', candidatesStatus: 'ready', candidates: [], sessionId: undefined } })
    // The two boundaries get different copy, so a greyed tab names its cause.
    expect(screen.getByRole('status').textContent).toBe(en.agentTeamLlmWorkspaceNoProjectRoot)
    expect(en.agentTeamLlmWorkspaceNoSession).not.toBe(en.agentTeamLlmWorkspaceNoProjectRoot)

    cleanup()
    renderCard({ workspace: { status: 'unavailable', path: undefined, error: undefined } as Workspace })
    expect(screen.getByRole('status').textContent).toBe(en.agentTeamLlmWorkspaceUnavailable)
  })

  it('disables the workspace tab while the layer cannot be read', () => {
    renderCard({ workspace: { status: 'unavailable', path: undefined, error: undefined, reason: 'noSession', candidatesStatus: 'ready', candidates: [], sessionId: undefined } })

    const [, workspace] = screen.getAllByRole('tab')
    expect(workspace!).toHaveProperty('disabled', true)
  })
})
