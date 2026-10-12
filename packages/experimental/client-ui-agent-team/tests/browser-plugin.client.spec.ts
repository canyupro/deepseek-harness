import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PresetOption } from '@deepseek-ai/dsh-permission-presets/client'
import { RemoteError, type TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import teamRemote from '@deepseek-ai/dsh-experimental-agent-team/remote'
import { TeamAction, type TeamActionInjected } from '../src/client/TeamAction.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SESSION = 'team-session' as SessionId
const CHILD = 'team-child' as SessionId

/** The deployment's configured presets, as the permission domain serves them. */
const PRESETS: readonly PresetOption[] = [
  { value: 'read-only', name: 'Read only' },
  { value: 'workspace-write', name: 'Workspace write' },
]

async function bench(options: {
  addressed?: boolean
  catalogFailure?: boolean
  retargetFailure?: boolean
  slotFailure?: boolean
} = {}) {
  const ctx = new Context()
  const navigation: unknown[] = []
  let mainSessionId = options.addressed === true ? CHILD : SESSION
  ctx.provide('sessions', {
    binding: (id: SessionId) => options.addressed === true && id === CHILD
      ? { session: { getSnapshot: () => ({
        subagent: {
          address: {
            parentSessionId: SESSION,
            childSessionId: CHILD,
            mode: 'continuable' as const,
          },
        },
      }) } }
      : undefined,
    refreshProjections: (id: SessionId) => {
      navigation.push(['refresh', id])
      return Promise.resolve()
    },
    retainInfo: (id: SessionId) => ({
      getSnapshot: () => ({
        referenceCount: id === mainSessionId ? 1 : 0,
        retainedBy: id === mainSessionId ? { mainView: 1 } : {},
      }),
      subscribe: () => () => {},
    }),
  })
  ctx.provide('uiWorkspace', {
    openSession: (target: unknown) => { navigation.push(['open', target]) },
  } as never)
  ctx.provide('conversation', {})
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  const collapseHeader = ctx.slots.register({
    name: 'root',
    children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
  } as never, () => null)

  const mounted: TypertRemoteContribution[] = []
  const unmount = vi.fn(async () => {})
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
      mounted.push(contribution)
      return unmount
    }
  }
  new Remote()

  const catalog = vi.fn(() => Promise.resolve(options.catalogFailure === true
    ? { ok: false as const, error: new RemoteError('gateway/internal', 'no permission domain', {}) }
    : {
      ok: true as const,
      value: { options: [...PRESETS], defaultOptions: [...PRESETS], defaultPreset: 'read-only' },
    }))
  // A non-Lead caller is refused by the Host with `TeamError` code
  // `TEAM_NOT_LEAD`. That is the Team domain's own vocabulary, not a
  // `RemoteErrorDetailsMap` entry, so the Gateway folds the refusal into
  // `gateway/internal` and only the message crosses the wire.
  const rePolicyMember = vi.fn(() => Promise.resolve(options.retargetFailure === true
    ? {
      ok: false as const,
      error: new RemoteError(
        'gateway/internal',
        '"researcher" is not the Team Lead and cannot change a member\'s permission preset',
        {},
      ),
    }
    : {
      ok: true as const,
      value: { preset: 'read-only', sandbox: 'read-only' as const, approval: 'never' as const },
    }))
  // The mounted `agentTeams` contribution owns both namespaces this plugin reads.
  ctx.provide('remote.permissionPresets', { catalog })
  ctx.provide('remote.agentTeams', { rePolicyMember })

  if (options.slotFailure === true) {
    vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot failed') })
  }

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = () => ctx.slots.entries('conversation.session.header.actions')
    .find(candidate => candidate.component === TeamAction)
  const actions = (): TeamActionInjected => {
    const injected = entry()!.inject!()
    const { openTeammate, loadPresets, retargetMember } = injected
    if (typeof openTeammate !== 'function' || typeof loadPresets !== 'function'
      || typeof retargetMember !== 'function') {
      throw new Error('Team header action lacks its injected callbacks')
    }
    return {
      openTeammate: openTeammate as TeamActionInjected['openTeammate'],
      loadPresets: loadPresets as TeamActionInjected['loadPresets'],
      retargetMember: retargetMember as TeamActionInjected['retargetMember'],
    }
  }
  return {
    ctx,
    fiber,
    navigation,
    entry,
    actions,
    catalog,
    rePolicyMember,
    mounted,
    unmount,
    collapseHeader,
    select: (sessionId: SessionId) => { mainSessionId = sessionId },
  }
}

describe('ui-team browser plugin', () => {
  it('mounts the Team Remote contribution and one disposable header action', async () => {
    const b = await bench()
    expect(inject).toEqual(['remote'])
    expect(b.mounted).toEqual([teamRemote])
    expect(b.entry()).toMatchObject({
      options: { id: 'agent-team', order: -20 },
      locale: 'agent-team',
    })
    const t = b.ctx.locale.bind('agent-team')
    expect(t('trigger')).toBe('Agent Team')

    expect(b.navigation).toEqual([])

    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
    expect(b.unmount).toHaveBeenCalledOnce()
    expect(t('empty')).toBe('empty')
  })

  it('opens a continuable teammate address without touching the parent catalog', async () => {
    const b = await bench()
    b.actions().openTeammate(SESSION, CHILD)
    expect(b.navigation).toEqual([
      ['open', { parentSessionId: SESSION, childSessionId: CHILD, mode: 'continuable' }],
    ])
  })

  it('routes teammate navigation from an addressed teammate conversation back through its Lead', async () => {
    const b = await bench({ addressed: true })
    b.actions().openTeammate(CHILD, CHILD)
    expect(b.navigation).toEqual([
      ['open', { parentSessionId: SESSION, childSessionId: CHILD, mode: 'continuable' }],
    ])
  })

  it('opens the Lead from an addressed teammate conversation', async () => {
    const b = await bench({ addressed: true })
    b.actions().openTeammate(CHILD, SESSION)
    expect(b.navigation).toEqual([['open', SESSION]])
  })

  it('does not open a teammate from a conversation outside the main view', async () => {
    const b = await bench()
    b.select('other-session' as SessionId)
    b.actions().openTeammate(SESSION, CHILD)
    expect(b.navigation).toEqual([])
  })

  it('re-registers after the conversation header slot is collapsed and declared again', async () => {
    const b = await bench()
    expect(b.entry()).toBeDefined()
    b.collapseHeader()
    expect(b.entry()).toBeUndefined()
    b.ctx.slots.register({
      name: 'root',
      children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(b.entry()).toBeDefined()
  })

  it('rolls back the Remote mount when the slot registration fails', async () => {
    await expect(bench({ slotFailure: true })).rejects.toThrow('slot failed')
  })

  it('reads the configured presets once and reports a refused catalog', async () => {
    const b = await bench()
    const presets = await b.actions().loadPresets()
    expect(presets).toEqual(PRESETS)
    // The table is fixed at Host composition, so the second read is served from
    // the first: the panel opens many times over one page lifetime.
    expect(await b.actions().loadPresets()).toEqual(PRESETS)
    expect(b.catalog).toHaveBeenCalledOnce()

    const refused = await bench({ catalogFailure: true })
    await expect(refused.actions().loadPresets()).rejects.toThrow('gateway/internal: no permission domain')
  })

  it('switches a member preset through the Team Remote and reports a refusal', async () => {
    const b = await bench()
    await b.actions().retargetMember(SESSION, CHILD, 'read-only')
    expect(b.rePolicyMember).toHaveBeenCalledWith(SESSION, { member: CHILD, preset: 'read-only' })

    const refused = await bench({ retargetFailure: true })
    await expect(refused.actions().retargetMember(SESSION, CHILD, 'read-only'))
      .rejects.toThrow('gateway/internal: "researcher" is not the Team Lead and cannot change a member\'s permission preset')
  })

  it('keeps the node half inert', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
