// @vitest-environment jsdom
/**
 * The remaining member-row controls the per-file coverage gate still needs: the
 * prompt textarea and the hand-filled route fields. The permission preset
 * control is covered in `member-permissions.client.spec.tsx`.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

/** One staged member row, overridable per case. */
function member(overrides: Partial<Extract<AgentTeamLlmCardState['members'][number], object>> = {}) {
  return {
    name: 'recon',
    description: 'Reads the tree.',
    prompt: '',
    context: 'fresh' as const,
    sandboxMode: '' as const,
    approvalPolicy: '' as const,
    key: '',
    route: { provider: '', model: '' },
    permission: '',
    problems: [],
    ...overrides,
  }
}

/** The card over one snapshot, in the workspace layer where rows are editable. */
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
    members: [member()],
    catalogStatus: 'ready',
    catalogPartial: false,
    memberPermissions: null,
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

describe('member row prompt and route fields', () => {
  it('stages the prompt typed into the textarea', () => {
    const { actions } = renderCard()

    const prompt = screen.getByLabelText(en.agentTeamLlmMemberPrompt) as HTMLTextAreaElement
    expect(prompt.value).toBe('')

    fireEvent.change(prompt, { target: { value: 'Read the layout first.' } })

    expect(actions.setMemberPrompt).toHaveBeenCalledWith(0, 'Read the layout first.')
  })

  it('shows the stored prompt on the row', () => {
    renderCard({ members: [member({ prompt: 'Read first.' })] })

    expect((screen.getByLabelText(en.agentTeamLlmMemberPrompt) as HTMLTextAreaElement).value)
      .toBe('Read first.')
  })

  it('keeps the paired route half while the other field is edited', () => {
    const { actions } = renderCard({
      members: [member({ route: { provider: 'alpha', model: 'fast', reasoningEffort: 'high' } })],
    })

    // The routes editor's add-route form reuses both labels, so the member's
    // pair is read from the row that owns the member prompt.
    const row = screen.getByLabelText(en.agentTeamLlmMemberPrompt).parentElement!
    fireEvent.change(within(row).getByLabelText(en.agentTeamLlmRouteProvider), { target: { value: 'beta' } })
    expect(actions.setMemberRouteFields).toHaveBeenCalledWith(0, 'beta', 'fast')

    fireEvent.change(within(row).getByLabelText(en.agentTeamLlmRouteModel), { target: { value: 'deep' } })
    expect(actions.setMemberRouteFields).toHaveBeenCalledWith(0, 'alpha', 'deep')
  })

  it('stages a route effort and renders the stored one', () => {
    const { actions } = renderCard({
      members: [member({ route: { provider: 'alpha', model: 'fast', reasoningEffort: 'high' } })],
    })

    const effort = screen.getByLabelText(en.agentTeamLlmRouteEffort) as HTMLInputElement
    expect(effort.value).toBe('high')

    fireEvent.change(effort, { target: { value: '' } })

    expect(actions.setMemberEffort).toHaveBeenCalledWith(0, '')
  })

  it('stages fresh when the context control is set back from fork', () => {
    const { actions } = renderCard({ members: [member({ context: 'fork' })] })

    fireEvent.change(screen.getByLabelText(en.agentTeamLlmMemberContext), { target: { value: 'fresh' } })
    expect(actions.setMemberContext).toHaveBeenCalledWith(0, 'fresh')

    fireEvent.change(screen.getByLabelText(en.agentTeamLlmMemberContext), { target: { value: 'fork' } })
    expect(actions.setMemberContext).toHaveBeenLastCalledWith(0, 'fork')
  })

  it('keeps a stored route selectable after it leaves the authorized list', () => {
    renderCard({
      members: [member({ key: 'legacy\0old', route: { provider: 'legacy', model: 'old' } })],
    })

    const select = screen.getByLabelText(en.agentTeamLlmMemberRoute) as HTMLSelectElement
    expect(select.value).toBe('legacy\0old')
    // The stored pair is still offered even though no authorized route carries it.
    expect([...select.options].map(option => option.value)).toContain('legacy\0old')
  })

  it('does not offer a route row the member does not hold', () => {
    renderCard()

    const select = screen.getByLabelText(en.agentTeamLlmMemberRoute) as HTMLSelectElement
    expect([...select.options].map(option => option.value)).toEqual([''])
  })
})
