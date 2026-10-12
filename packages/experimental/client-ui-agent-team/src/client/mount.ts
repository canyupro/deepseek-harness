/** Source-safe Agent Teams browser registration and its Host Remote mount. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ctx.remote Context merge, the forwarded-event key face, and
// the `remote.agentTeams` / `remote.permissionPresets` namespaces this plugin
// reads once the generated contributions are mounted.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the conversation slot map the header action registers into.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: merges the `permissions` Session projection this panel reads the
// current member preset from. No value import: preset options ride the Remote.
import type {} from '@deepseek-ai/dsh-permission-presets/client'
import type { PresetOption } from '@deepseek-ai/dsh-permission-presets/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: the generated `agentTeams` namespace this plugin mounts.
import type {} from '@deepseek-ai/dsh-experimental-agent-team/remote'
import { TeamAction, type TeamActionInjected } from './TeamAction.tsx'
import { en, NS, zh, type TeamKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent Teams roster, permission, and task-board copy. */
    'agent-team': TeamKey
  }
}

/** Required browser service: the Remote carrier the Team contribution mounts into. */
export const inject = ['remote']

/**
 * Build the roster's business actions over the mounted Remote namespaces.
 * Preset options are the deployment's configured named presets: the derived
 * `custom` value and the review integration's live `auto` are not switch
 * targets here, and the table they come from is fixed at Host composition, so
 * one successful read is cached for the plugin's lifetime.
 * @param ctx - browser Context with the injected Session, navigation, and Remote services.
 * @returns the actions the header action injects into its component.
 */
function rosterActions(ctx: ClientContext): TeamActionInjected {
  const sessions = ctx.sessions
  const leadSessionId = (sessionId: SessionId): SessionId => {
    const address = sessions.binding(sessionId)?.session.getSnapshot().subagent?.address
    return address?.parentSessionId ?? sessionId
  }
  let configuredPresets: readonly PresetOption[] | null = null

  return {
    openTeammate(sessionId: SessionId, childSessionId: SessionId): void {
      const parentSessionId = leadSessionId(sessionId)
      if ((sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) === 0) return
      if (childSessionId === parentSessionId) {
        ctx.uiWorkspace.openSession(parentSessionId)
        return
      }
      ctx.uiWorkspace.openSession({
        parentSessionId,
        childSessionId,
        mode: 'continuable',
      })
    },
    async loadPresets(): Promise<readonly PresetOption[]> {
      if (configuredPresets !== null) return configuredPresets
      const result = await ctx.remote.permissionPresets.catalog()
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      configuredPresets = result.value.defaultOptions
      return configuredPresets
    },
    async retargetMember(
      callerSessionId: SessionId,
      memberSessionId: SessionId,
      preset: string,
    ): Promise<void> {
      const result = await ctx.remote.agentTeams.rePolicyMember(callerSessionId, {
        member: memberSessionId,
        preset,
      })
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    },
  }
}

/** Register the Team locale dictionaries, header action, and its roster actions. */
function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-agent-team: dictionaries')
  const actions = rosterActions(ctx)
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'agent-team',
      order: -20,
      locale: NS,
      inject: () => actions,
    }, TeamAction),
  )
}

/**
 * Mount the Host `agentTeams` Remote contribution and register the Team panel.
 * @param ctx - browser Context carrying the Remote carrier.
 * @param contribution - the generated `agentTeams` Remote contribution.
 * @returns the disposer that withdraws the panel and the Remote mount.
 */
export async function mountAgentTeamUi(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(
    ['remote.agentTeams', 'remote.permissionPresets', 'sessions', 'uiWorkspace', 'slots', 'locale'],
    registerUi,
  )
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
