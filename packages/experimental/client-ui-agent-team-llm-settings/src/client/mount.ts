/** Source-safe browser registration: the workspace Remote mount behind the settings card. */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the ctx.sessions Context merge naming the Session whose workspace
// root the Host resolves for the workspace layer.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the `mainView` retention source the workspace layer follows.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the generated `agentTeamLlm` namespace this plugin mounts.
import type {} from '@deepseek-ai/dsh-experimental-agent-team-llm-settings/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { AgentTeamLlmCard } from './AgentTeamLlmCard.tsx'
import { AGENT_TEAM_LLM_NS, AgentTeamLlmCardController } from './agent-team-llm-card-controller.ts'
import { en, zh, type AgentTeamLlmSettingsLocaleKey } from './locales.ts'
import type { AgentTeamLlmTeamDocuments } from './team-document.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent Team LLM routing settings card copy. */
    'settings.agentTeamLlm': AgentTeamLlmSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.agentTeamLlm'

/** Required services (cordis fiber inject): the Remote carrier the contribution mounts into. */
export const inject = ['remote']

/** The workspace document slice the card stages against. */
function teamDocuments(ctx: Context): AgentTeamLlmTeamDocuments {
  return ctx.remote.agentTeamLlm
}

/**
 * The Session whose workspace root the Host resolves for the workspace layer.
 *
 * The main view names the session the user is looking at and is the exact answer
 * wherever it is held. Nothing holds main-view retention on the settings page,
 * which would otherwise grey the workspace tab out for a session that does have
 * a project root, so the most recently updated session stands in: every Session
 * resolves a project root or none, and the newest one is the likeliest subject
 * of settings being edited. That fallback is a heuristic — the card shows the
 * resolved document path, so a wrong guess is visible rather than silent.
 * @param ctx - the browser plugin context carrying the Session catalog.
 * @returns a reader for the Session identity, or undefined while the catalog holds none.
 */
function workspaceSession(ctx: Context): () => SessionId | undefined {
  return () => {
    const rows = Object.values(ctx.sessions.list.getSnapshot().byId)
    const mainView = rows.find(row => (row.retainedBy.mainView ?? 0) > 0)
    if (mainView !== undefined) return mainView.id
    return rows.reduce<typeof rows[number] | undefined>((newest, row) =>
      newest === undefined || row.updatedAt > newest.updatedAt ? row : newest, undefined)?.id
  }
}

function registerUi(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-agent-team-llm-settings: dictionaries')
  const card = new AgentTeamLlmCardController(
    ctx.configForms.get(AGENT_TEAM_LLM_NS),
    ctx,
    teamDocuments(ctx),
    workspaceSession(ctx),
  )
  ctx.effect(() => () => { card.dispose() }, 'client-ui-agent-team-llm-settings: form subscription')
  // The model catalogue is not part of the settings section: adapters come and
  // go, and a document commit elsewhere can change which routes are stored.
  ctx.effect(
    () => ctx.remote.$on('llm/adapters-updated', () => { card.refreshCatalog() }),
    'client-ui-agent-team-llm-settings: adapter invalidations',
  )
  ctx.effect(
    () => ctx.remote.$on('settings/document-updated', () => { card.refreshCatalog() }),
    'client-ui-agent-team-llm-settings: settings invalidations',
  )
  ctx.effect(
    () => ctx.on('connection/reset', () => { card.resetConnection() }),
    'client-ui-agent-team-llm-settings: connection generation',
  )
  ctx.effect(() => ctx.configForms.whileServed([AGENT_TEAM_LLM_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item',
    id: 'agent-team-llm',
    order: 31,
    label: () => t('title'),
    locale: NS,
    inject: () => card.inject(),
  }, AgentTeamLlmCard))), 'client-ui-agent-team-llm-settings: page')
}

/**
 * Mount the Host `agentTeamLlm` Remote contribution and register the routing card.
 * @param ctx - browser Context with `remote` available.
 * @param contribution - the generated `agentTeamLlm` Remote contribution.
 * @returns the disposer that withdraws the card and the Remote mount.
 */
export async function mountAgentTeamLlmSettingsCard(
  ctx: Context,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(
    ['remote.agentTeamLlm', 'remote.session', 'configForms', 'locale', 'sessions', 'slots'],
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
