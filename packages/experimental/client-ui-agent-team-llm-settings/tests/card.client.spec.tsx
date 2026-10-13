// @vitest-environment jsdom
/** The Agent Team LLM routing card as the Plugins page renders it: one form with one save. */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { AgentTeamLlmCard, type AgentTeamLlmCardProps } from '../src/client/AgentTeamLlmCard.tsx'
import type {
  AgentTeamLlmCandidate, AgentTeamLlmCardState, AgentTeamLlmRoleState,
} from '../src/client/agent-team-llm-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const settled: SettingsFormShell = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

function candidate(overrides: Partial<AgentTeamLlmCandidate> = {}): AgentTeamLlmCandidate {
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

function role(overrides: Partial<AgentTeamLlmRoleState> = {}): AgentTeamLlmRoleState {
  return { name: 'scout', key: 'alpha\0fast', route: { provider: 'alpha', model: 'fast' }, ...overrides }
}

/** The Plugins page asks a configuration entry for its one-liner or its form. */
type ConfigView = 'summary' | 'page'

function renderCard(state: Partial<AgentTeamLlmCardState> = {}, view: ConfigView = 'page') {
  const store = createSnapshotStore<AgentTeamLlmCardState>({
    ...settled,
    scope: 'global',
    workspace: { status: 'ready', path: '/project/.dsh/team.json', error: undefined, reason: undefined, candidates: [], workspaceId: undefined },
    enabled: false,
    candidates: [],
    allowed: [],
    defaultRoute: { provider: '', model: '' },
    roles: [],
    members: [],
    catalogStatus: 'idle',
    catalogPartial: false,
    memberPermissions: null,
    conflicted: false,
    problems: [],
    ...state,
  })
  const actions = {
    setScope: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    setMemberName: vi.fn(),
    setMemberDescription: vi.fn(),
    setMemberContext: vi.fn(),
    setMemberRoute: vi.fn(),
    retryWorkspace: vi.fn(),
    toggleEnabled: vi.fn(),
    toggleRoute: vi.fn(),
    setDefaultRoute: vi.fn(),
    retryCatalog: vi.fn(),
    addRole: vi.fn(),
    removeRole: vi.fn(),
    setRoleName: vi.fn(),
    setRoleRoute: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  }
  const props = {
    ...actions,
    view,
    t,
    useAgentTeamLlmCard: bindSnapshotSelector(store),
  } as AgentTeamLlmCardProps
  render(<AgentTeamLlmCard {...props} />)
  return { actions, store }
}

describe('AgentTeamLlmCard', () => {
  it('renders its one-liner in the summary view', () => {
    renderCard({}, 'summary')

    expect(document.body.textContent).toBe(en.description)
  })

  it('renders the switch with the hint for its current state and stages a toggle', () => {
    const { actions } = renderCard()

    const control = screen.getByRole('switch', { name: en.agentTeamLlmToggle })
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(en.agentTeamLlmOff)).toBeTruthy()
    expect(screen.queryByRole('group')).toBeNull()
    fireEvent.click(control)

    expect(actions.toggleEnabled).toHaveBeenCalledOnce()
  })

  it('groups authorized candidates by provider while enabled and stages a route toggle', () => {
    const { actions } = renderCard({
      enabled: true,
      catalogStatus: 'ready',
      candidates: [
        candidate(),
        candidate({ key: 'alpha\0deep', model: 'deep', modelName: 'Deep', selected: false }),
        candidate({
          key: 'legacy\0old',
          provider: 'legacy',
          model: 'old',
          providerName: 'legacy',
          modelName: 'old',
          available: false,
        }),
      ],
      allowed: [candidate(), candidate({ key: 'legacy\0old', selected: true, available: false })],
    })

    expect(screen.getByText(en.agentTeamLlmChoose)).toBeTruthy()
    expect(screen.getByText('Alpha API', { exact: true })).toBeTruthy()
    expect(screen.getByText(en.agentTeamLlmUnavailableGroup)).toBeTruthy()
    expect(screen.getByText(en.agentTeamLlmUnavailable)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Fast/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Deep/ }))
    expect(actions.toggleRoute.mock.calls).toEqual([['alpha\0fast'], ['alpha\0deep']])
  })

  it('reports directory progress, failures, partial loads, and an empty directory', () => {
    renderCard({ enabled: true, catalogStatus: 'loading' })
    expect(screen.getByRole('status').textContent).toBe(en.agentTeamLlmLoading)

    cleanup()
    const { actions } = renderCard({ enabled: true, catalogStatus: 'error' })
    fireEvent.click(screen.getByRole('button', { name: en.agentTeamLlmRetry }))
    expect(actions.retryCatalog).toHaveBeenCalledOnce()

    cleanup()
    renderCard({
      enabled: true,
      catalogStatus: 'ready',
      catalogPartial: true,
      candidates: [candidate({ available: false })],
    })
    expect(screen.getByText(en.agentTeamLlmPartial)).toBeTruthy()

    cleanup()
    renderCard({ enabled: true, catalogStatus: 'ready' })
    expect(screen.getByText(en.agentTeamLlmEmpty)).toBeTruthy()
  })

  it('offers no-default plus the authorized routes, keeps a stored partial default visible, and stages a choice', () => {
    const { actions } = renderCard({
      enabled: true,
      catalogStatus: 'ready',
      candidates: [candidate()],
      allowed: [candidate()],
      defaultRoute: { provider: 'beta', model: '' },
    })

    const select = screen.getByLabelText(en.agentTeamLlmDefault) as HTMLSelectElement
    expect(select.value).toBe('beta\0')
    expect([...select.options].map(option => option.value)).toEqual(['', 'alpha\0fast', 'beta\0'])
    expect([...select.options].map(option => option.textContent)).toEqual([
      en.agentTeamLlmDefaultNone, 'Alpha API · alpha/fast', 'beta/',
    ])
    fireEvent.change(select, { target: { value: 'alpha\0fast' } })

    expect(actions.setDefaultRoute).toHaveBeenCalledWith('alpha\0fast')
  })

  it('renders preset rows and stages every preset edit', () => {
    const { actions } = renderCard({
      enabled: true,
      catalogStatus: 'ready',
      candidates: [candidate()],
      allowed: [candidate()],
      roles: [role(), role({ name: '', key: 'beta\0deep', route: { provider: 'beta', model: 'deep' } })],
    })

    const names = screen.getAllByLabelText(en.agentTeamLlmRoleName) as HTMLInputElement[]
    expect(names).toHaveLength(2)
    expect(names[0]!.value).toBe('scout')
    const routes = screen.getAllByLabelText(en.agentTeamLlmRoleRoute) as HTMLSelectElement[]
    expect(routes[1]!.value).toBe('beta\0deep')
    expect([...routes[1]!.options].map(option => option.value)).toEqual(['', 'alpha\0fast', 'beta\0deep'])

    fireEvent.change(names[0]!, { target: { value: 'scout-2' } })
    fireEvent.change(routes[0]!, { target: { value: '' } })
    fireEvent.click(screen.getAllByRole('button', { name: en.agentTeamLlmRoleRemove })[1]!)
    fireEvent.click(screen.getByRole('button', { name: en.agentTeamLlmRoleAdd }))

    expect(actions.setRoleName).toHaveBeenCalledWith(0, 'scout-2')
    expect(actions.setRoleRoute).toHaveBeenCalledWith(0, '')
    expect(actions.removeRole).toHaveBeenCalledWith(1)
    expect(actions.addRole).toHaveBeenCalledOnce()
  })

  it('says so when there are no preset rows', () => {
    renderCard({ enabled: true, catalogStatus: 'ready' })

    expect(screen.getByText(en.agentTeamLlmRolesEmpty)).toBeTruthy()
  })

  it('reports every violated Host rule and blocks the save', () => {
    renderCard({
      enabled: true,
      dirty: true,
      invalid: true,
      problems: ['agentTeamLlmRequiredRoutes', 'agentTeamLlmRoleNameDuplicate'],
    })

    expect(screen.getByText(en.agentTeamLlmRequiredRoutes)).toBeTruthy()
    expect(screen.getByText(en.agentTeamLlmRoleNameDuplicate)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('distinguishes a stale draft from a rejected save and blocks the save while conflicted', () => {
    renderCard({ dirty: true, conflicted: true })

    expect(screen.getByText(en.agentTeamLlmConflict)).toBeTruthy()
    expect(screen.queryByText(en.saveFailed)).toBeNull()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('reports a rejected save and blocks the save while nothing is dirty', () => {
    renderCard({ dirty: true, failed: true })
    expect(screen.getByText(en.saveFailed)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', false)

    cleanup()
    renderCard()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('locks every control while read-only and shows the read-only notice', () => {
    const { actions } = renderCard({
      writable: false,
      enabled: true,
      catalogStatus: 'ready',
      candidates: [candidate()],
      allowed: [candidate()],
      roles: [role()],
    })

    expect(screen.getByRole('status').textContent).toBe(en.readOnly)
    const control = screen.getByRole('switch')
    expect(control).toHaveProperty('disabled', true)
    fireEvent.click(control)
    expect(actions.toggleEnabled).not.toHaveBeenCalled()
    expect(screen.getByLabelText(en.agentTeamLlmDefault)).toHaveProperty('disabled', true)
    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true)
    expect(screen.getAllByLabelText(en.agentTeamLlmRoleName)[0]).toHaveProperty('disabled', true)
  })

  it('locks every control while a save is crossing the wire', () => {
    renderCard({
      dirty: true,
      saving: true,
      enabled: true,
      catalogStatus: 'ready',
      candidates: [candidate()],
      allowed: [candidate()],
      roles: [role()],
    })

    expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true)
    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true)
    expect(screen.getAllByLabelText(en.agentTeamLlmRoleName)[0]).toHaveProperty('disabled', true)
    expect((screen.getAllByRole('button', { name: en.agentTeamLlmRoleAdd })[0])).toHaveProperty('disabled', true)
  })

  it('says so when the namespace is not served, and follows the snapshot', () => {
    const { store } = renderCard({ available: false })

    expect(screen.getByRole('status').textContent).toBe(en.unavailable)
    expect(screen.queryByRole('switch')).toBeNull()

    cleanup()
    const live = renderCard({ enabled: false })
    act(() => { live.store.set({ ...live.store.getSnapshot(), enabled: true, catalogStatus: 'ready' }) })
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(store.getSnapshot().enabled).toBe(false)
  })

  it('discards its draft when the card leaves the page', () => {
    const { actions } = renderCard({ dirty: true })

    cleanup()

    expect(actions.discard).toHaveBeenCalledOnce()
  })

  it('renders one save control for the whole card', () => {
    renderCard({ dirty: true, enabled: true, catalogStatus: 'ready', candidates: [candidate()], allowed: [candidate()] })

    const group = screen.getByRole('group')
    expect(within(group).getByText(en.agentTeamLlmAllowed)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en.save })).toHaveLength(1)
  })
})
