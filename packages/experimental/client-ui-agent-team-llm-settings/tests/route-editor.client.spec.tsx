// @vitest-environment jsdom
/**
 * The route editor: one row per route with its effort, the hand-typed add form
 * for what the directory cannot render, and the selectors that keep offering a
 * stored route the authorized list no longer carries.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { AgentTeamLlmCard, type AgentTeamLlmCardProps } from '../src/client/AgentTeamLlmCard.tsx'
import { agentTeamLlmCandidates } from '../src/client/agent-team-llm-card-controller.ts'
import type { AgentTeamLlmCandidate, AgentTeamLlmCardState } from '../src/client/agent-team-llm-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const shell: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}

/** One authorized-route candidate, overridable per case. */
function allowed(overrides: Partial<AgentTeamLlmCandidate> = {}): AgentTeamLlmCandidate {
  return {
    key: 'alpha\0fast',
    provider: 'alpha',
    model: 'fast',
    providerName: 'Alpha API',
    modelName: 'Fast',
    available: true,
    selected: true,
    ...overrides,
  }
}

/** The card over one snapshot in the global layer, where the route editor lives. */
function renderCard(state: Partial<AgentTeamLlmCardState> = {}) {
  const store = createSnapshotStore<AgentTeamLlmCardState>({
    ...shell,
    scope: 'global',
    workspace: { status: 'ready', path: '/project/.dsh/team.json', error: undefined, reason: undefined, candidates: [], workspaceId: undefined },
    enabled: true,
    candidates: [allowed()],
    allowed: [allowed()],
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

describe('authorized route add form', () => {
  it('stays disabled until both halves are typed, then adds the pair and clears the fields', () => {
    const { actions } = renderCard()
    const add = screen.getByRole('button', { name: en.agentTeamLlmRouteAdd }) as HTMLButtonElement
    const provider = screen.getByLabelText(en.agentTeamLlmRouteProvider)
    const model = screen.getByLabelText(en.agentTeamLlmRouteModel)

    expect(add).toHaveProperty('disabled', true)

    fireEvent.change(provider, { target: { value: 'beta' } })
    expect(add).toHaveProperty('disabled', true)
    fireEvent.change(model, { target: { value: 'deep' } })
    expect(add).toHaveProperty('disabled', false)

    fireEvent.click(add)

    expect(actions.addAllowedRoute).toHaveBeenCalledWith('beta', 'deep')
    // The typed pair is editor-local, so it is cleared after the staged add.
    expect((provider as HTMLInputElement).value).toBe('')
    expect((model as HTMLInputElement).value).toBe('')
  })

  it('offers the hand-typed form before anything is authorized', () => {
    renderCard({ allowed: [], candidates: [] })

    // The add form is the block's permanent content; with no route that the
    // directory cannot render, the block repeats no row.
    expect(screen.getByRole('button', { name: en.agentTeamLlmRouteAdd })).toBeTruthy()
    expect(screen.getByLabelText(en.agentTeamLlmRouteProvider)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.agentTeamLlmRouteRemove })).toBeNull()
  })
})

describe('authorized route row controls', () => {
  it('edits and removes only the route the directory cannot render', () => {
    const { actions } = renderCard({
      allowed: [allowed(), allowed({ key: 'legacy\0old', provider: 'legacy', model: 'old', providerName: 'legacy', modelName: 'old', available: false, reasoningEffort: 'high' })],
    })

    // The advertised route carries its effort in the directory list; the stored
    // route the directory no longer advertises is the block's only row.
    const efforts = screen.getAllByLabelText(en.agentTeamLlmRouteEffort) as HTMLInputElement[]
    expect(efforts.map(input => input.value)).toEqual(['', 'high'])
    expect(screen.getAllByRole('button', { name: en.agentTeamLlmRouteRemove })).toHaveLength(1)

    fireEvent.change(efforts[1]!, { target: { value: 'low' } })
    expect(actions.setRouteEffort).toHaveBeenCalledWith('legacy\0old', 'low')

    fireEvent.click(screen.getByRole('button', { name: en.agentTeamLlmRouteRemove }))
    expect(actions.removeAllowedRoute).toHaveBeenCalledWith('legacy\0old')
  })

  it('renders an advertised route once, with its effort in the same row', () => {
    const stored = [{ provider: 'alpha', model: 'fast', reasoningEffort: 'high' }]
    const projected = agentTeamLlmCandidates(
      [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
      stored,
      new Set(['alpha\0fast']),
    )

    renderCard({ candidates: projected, allowed: projected })

    // The directory list holds the route's only row: the default-route select
    // also names it, so the count is scoped to the list.
    const directory = screen.getByRole('group')
    expect(within(directory).getAllByText('Alpha API · alpha/fast')).toHaveLength(1)
    // The directory list owns authorization, so the hand-typed block keeps no
    // row for it and offers no second remove control.
    expect(screen.queryByRole('button', { name: en.agentTeamLlmRouteRemove })).toBeNull()
    expect(screen.getByLabelText(en.agentTeamLlmRouteEffort)).toHaveProperty('value', 'high')
  })

  it('shows a stored effort on a route the catalog still advertises', () => {
    // The regression this pins: an authorized route the live catalog still
    // advertises kept its effort in the stored document, but the candidate
    // projection dropped it, so the row rendered blank and the operator could
    // neither see nor clear the value.
    //
    // The candidates are derived through the real `agentTeamLlmCandidates`, not
    // hand-written into the store: injecting a ready candidate would let this
    // pass even with the projection reverted.
    const stored = [{ provider: 'alpha', model: 'fast', reasoningEffort: 'high' }]
    const projected = agentTeamLlmCandidates(
      [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
      stored,
      new Set(['alpha\0fast']),
    )

    expect(projected).toEqual([expect.objectContaining({ key: 'alpha\0fast', available: true, reasoningEffort: 'high' })])

    const { actions } = renderCard({ candidates: projected, allowed: projected })

    const efforts = screen.getAllByLabelText(en.agentTeamLlmRouteEffort) as HTMLInputElement[]
    expect(efforts[0]?.value).toBe('high')

    // Clearing it still stages the empty string, which drops the field.
    fireEvent.change(efforts[0]!, { target: { value: '' } })
    expect(actions.setRouteEffort).toHaveBeenCalledWith('alpha\0fast', '')
  })

  it('locks every route control while the section is read-only', () => {
    renderCard({
      writable: true,
      saving: true,
      allowed: [allowed(), allowed({ key: 'legacy\0old', provider: 'legacy', model: 'old', providerName: 'legacy', modelName: 'old', available: false })],
    })

    expect(screen.getByRole('button', { name: en.agentTeamLlmRouteAdd })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.agentTeamLlmRouteProvider)).toHaveProperty('disabled', true)
    expect(screen.getAllByLabelText(en.agentTeamLlmRouteEffort)[0]).toHaveProperty('disabled', true)
    expect(screen.getAllByRole('button', { name: en.agentTeamLlmRouteRemove })[0]).toHaveProperty('disabled', true)
    expect(screen.getAllByRole('checkbox')[0]).toHaveProperty('disabled', true)
  })
})

describe('stored routes the authorized list no longer carries', () => {
  it('still offers a stored default that is not authorized', () => {
    renderCard({ defaultRoute: { provider: 'legacy', model: 'old' } })

    const select = screen.getByLabelText(en.agentTeamLlmDefault) as HTMLSelectElement
    expect(select.value).toBe('legacy\0old')
    expect([...select.options].map(option => option.value)).toContain('legacy\0old')
  })

  it('does not duplicate a default that is already authorized', () => {
    renderCard({ defaultRoute: { provider: 'alpha', model: 'fast' } })

    const select = screen.getByLabelText(en.agentTeamLlmDefault) as HTMLSelectElement
    // One "none" option plus one per authorized route; a default that is itself
    // authorized must not be offered twice.
    expect([...select.options].map(option => option.value)).toEqual(['', 'alpha\0fast'])
    expect(select.value).toBe('alpha\0fast')
  })

  it('still offers a preset route that is not authorized, and edits every preset field', () => {
    const { actions } = renderCard({
      roles: [{ name: 'scout', key: 'legacy\0old', route: { provider: 'legacy', model: 'old', reasoningEffort: 'high' } }],
    })

    const routes = screen.getAllByLabelText(en.agentTeamLlmRoleRoute) as HTMLSelectElement[]
    expect(routes[0]?.value).toBe('legacy\0old')
    expect([...routes[0]!.options].map(option => option.value)).toContain('legacy\0old')

    const efforts = screen.getAllByLabelText(en.agentTeamLlmRoleEffort) as HTMLInputElement[]
    expect(efforts[0]?.value).toBe('high')

    fireEvent.change(screen.getAllByLabelText(en.agentTeamLlmRoleName)[0]!, { target: { value: 'scout-2' } })
    fireEvent.change(routes[0]!, { target: { value: 'alpha\0fast' } })
    fireEvent.change(efforts[0]!, { target: { value: 'low' } })
    fireEvent.click(screen.getByRole('button', { name: en.agentTeamLlmRoleRemove }))

    expect(actions.setRoleName).toHaveBeenCalledWith(0, 'scout-2')
    expect(actions.setRoleRoute).toHaveBeenCalledWith(0, 'alpha\0fast')
    expect(actions.setRoleEffort).toHaveBeenCalledWith(0, 'low')
    expect(actions.removeRole).toHaveBeenCalledWith(0)
  })
})
