/** Browser entry registering the Agent Teams conversation-header action. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import teamRemote from '@deepseek-ai/dsh-experimental-agent-team/remote'
import { mountAgentTeamUi } from './mount.ts'

export { inject } from './mount.ts'
export type { TeamActionInjected, TeamActionProps } from './TeamAction.tsx'
export type { TeamKey } from './locales.ts'

/**
 * Mount the Team Remote contribution and register the Team locale dictionaries
 * and header action on the Client Context.
 * @param ctx - Client Context with the declared `inject` services available.
 * @returns the disposer that withdraws the panel and the Remote mount.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountAgentTeamUi(ctx, teamRemote)
}
