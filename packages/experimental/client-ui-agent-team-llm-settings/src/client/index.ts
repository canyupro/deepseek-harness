/**
 * The Agent Teams child LLM routing settings card, browser entry: it mounts the
 * Host `agentTeamLlm` Remote contribution the workspace layer reads and writes
 * through, then registers the card that edits the `agent-team-llm-settings`
 * document teammates are routed on, and the per-project team document that
 * overrides it. The card registers into the Plugins page's `plugins.item` slot
 * while the Host serves that namespace, so a deployment that never composed the
 * Host team LLM settings plugin shows no trace of it.
 */

import type { Context } from '@deepseek-ai/cordis'
import teamRemote from '@deepseek-ai/dsh-experimental-agent-team-llm-settings/remote'
import { mountAgentTeamLlmSettingsCard } from './mount.ts'

export { inject } from './mount.ts'
export type { AgentTeamLlmCardProps } from './AgentTeamLlmCard.tsx'
export type { AgentTeamLlmFieldsProps } from './AgentTeamLlmFields.tsx'
export type { AgentTeamLlmMembersProps } from './AgentTeamLlmMembers.tsx'
export type {
  AgentTeamLlmCandidate, AgentTeamLlmCardFace, AgentTeamLlmCardState, AgentTeamLlmRoleRoute,
  AgentTeamLlmRoleState, AgentTeamLlmRoute, AgentTeamLlmScopeKey, AgentTeamLlmSettings,
  AgentTeamLlmWorkspaceState, AgentTeamLlmWorkspaceStatus,
} from './agent-team-llm-card-controller.ts'
export type {
  AgentTeamLlmMemberDraft, AgentTeamLlmMemberProblemKey, AgentTeamLlmMemberState,
  AgentTeamLlmTeamDocument, AgentTeamLlmTeamDocumentRead, AgentTeamLlmTeamDocumentWrite,
  AgentTeamLlmTeamDocuments, AgentTeamLlmTeamMember,
} from './team-document.ts'
export type { AgentTeamLlmProblemKey, AgentTeamLlmSettingsLocaleKey } from './locales.ts'

/**
 * Mount the team LLM routing settings card and the Remote behind its workspace layer.
 * @param ctx - the browser plugin context.
 * @returns the disposer that withdraws the card and the Remote mount.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountAgentTeamLlmSettingsCard(ctx, teamRemote)
}
