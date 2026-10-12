/** One settings card for the two Host-owned Agent Teams routing documents. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AgentTeamLlmFields } from './AgentTeamLlmFields.tsx'
import { AgentTeamLlmMembers } from './AgentTeamLlmMembers.tsx'
import type { AgentTeamLlmCardFace } from './agent-team-llm-card-controller.ts'
import css from './AgentTeamLlmFields.module.css'
import { formLabels } from './locales.ts'

/** Framework-derived props for the Agent Team LLM routing card. */
export type AgentTeamLlmCardProps = PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.agentTeamLlm'> & InjectFace<AgentTeamLlmCardFace>

/**
 * The last segment of a working directory, for the session picker. The browser
 * has no `node:path`, so both separators are cut on.
 * @param cwd - Absolute working directory the Host reported.
 * @returns Its final path segment, or the whole string when it names none.
 */
function workspaceSessionName(cwd: string): string {
  const segments = cwd.split(/[/\\]+/).filter(segment => segment !== '')
  return segments[segments.length - 1] ?? cwd
}

/**
 * Render the scope switch and the routing document of the selected scope.
 * @param props - the view asked for, locale copy, the card snapshot, and its actions.
 * @returns the one-liner, or the card for one of the two layers.
 */
export function AgentTeamLlmCard(props: AgentTeamLlmCardProps) {
  const { t } = props
  const state = props.useAgentTeamLlmCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  // A draft a newer Host revision invalidated cannot be saved; fold it into the
  // shell exactly as the Subagent card folds its conflicted model form.
  const shell = { ...state, invalid: state.invalid || (state.dirty && state.conflicted) }
  const workspace = state.workspace
  const workspaceReady = workspace.status === 'ready'
  return (
    <SettingsForm labels={formLabels(t)} state={shell} onSave={props.save} onDiscard={props.discard}>
      <div className={css.scope}>
        <div className={css.scopeTabs} role="tablist" aria-label={t('agentTeamLlmScopeLabel')}>
          <button
            type="button"
            role="tab"
            className={css.scopeTab}
            aria-selected={state.scope === 'global'}
            onClick={() => { props.setScope('global') }}
          >
            {t('agentTeamLlmScopeGlobal')}
          </button>
          <button
            type="button"
            role="tab"
            className={css.scopeTab}
            aria-selected={state.scope === 'workspace'}
            disabled={!workspaceReady}
            onClick={() => { props.setScope('workspace') }}
          >
            {t('agentTeamLlmScopeWorkspace')}
          </button>
        </div>
        {workspace.status === 'loading'
          ? <p className={css.notice} role="status">{t('agentTeamLlmWorkspaceLoading')}</p>
          : null}
        {workspace.status === 'unavailable'
          ? (
            <p className={css.notice} role="status">
              {/* Two boundaries can stop this layer; naming which one keeps a
                  greyed tab attributable instead of a guess. */}
              {t(workspace.reason === 'noSession'
                ? 'agentTeamLlmWorkspaceNoSession'
                : workspace.reason === 'noProjectRoot'
                  ? 'agentTeamLlmWorkspaceNoProjectRoot'
                  : 'agentTeamLlmWorkspaceUnavailable')}
            </p>
          )
          : null}
      </div>
      {state.scope === 'global'
        ? (
          <>
            <AgentTeamLlmFields
              t={t}
              state={state}
              toggleEnabled={props.toggleEnabled}
              toggleRoute={props.toggleRoute}
              addAllowedRoute={props.addAllowedRoute}
              removeAllowedRoute={props.removeAllowedRoute}
              setRouteEffort={props.setRouteEffort}
              setDefaultRoute={props.setDefaultRoute}
              retryCatalog={props.retryCatalog}
              addRole={props.addRole}
              removeRole={props.removeRole}
              setRoleName={props.setRoleName}
              setRoleRoute={props.setRoleRoute}
              setRoleEffort={props.setRoleEffort}
            />
            <AgentTeamLlmMembers
              t={t}
              members={state.members}
              allowed={state.allowed}
              editable={state.writable && !state.saving}
              addMember={props.addMember}
              removeMember={props.removeMember}
              setMemberName={props.setMemberName}
              setMemberDescription={props.setMemberDescription}
              setMemberPrompt={props.setMemberPrompt}
              setMemberContext={props.setMemberContext}
              setMemberSandboxMode={props.setMemberSandboxMode}
              setMemberRoute={props.setMemberRoute}
              setMemberRouteFields={props.setMemberRouteFields}
              setMemberEffort={props.setMemberEffort}
            />
          </>
        )
        : (
          <>
            <div className={css.workspace}>
              {workspace.candidates.length > 0
                ? (
                  <label className={css.workspaceField}>
                    <span className={css.fieldLabel}>{t('agentTeamLlmWorkspaceSession')}</span>
                    <select
                      className={css.select}
                      value={workspace.sessionId ?? ''}
                      aria-label={t('agentTeamLlmWorkspaceSession')}
                      disabled={workspace.status === 'loading' || state.saving || !state.writable}
                      onChange={(event) => {
                        // Resolve the offered row rather than branding the raw
                        // string, so the branded identity the Host minted is the
                        // one the card carries on.
                        const chosen = workspace.candidates
                          .find(candidate => candidate.sessionId === event.target.value)
                        if (chosen !== undefined) props.setWorkspaceSession(chosen.sessionId)
                      }}
                    >
                      {workspace.candidates.map(candidate => (
                        <option key={candidate.sessionId} value={candidate.sessionId} title={candidate.cwd}>
                          {workspaceSessionName(candidate.cwd)}
                        </option>
                      ))}
                    </select>
                  </label>
                )
                : null}
              {workspace.error !== undefined
                ? (
                  // A refused read is retried; a refused write is corrected in
                  // the rows below and saved again.
                  <div className={css.catalogError} role="alert">
                    <span>{`${workspace.status === 'error'
                      ? t('agentTeamLlmWorkspaceLoadFailed')
                      : t('agentTeamLlmWorkspaceSaveFailed')} ${workspace.error}`}</span>
                    {workspace.status === 'error'
                      ? (
                        <button type="button" onClick={props.retryWorkspace}>
                          {t('agentTeamLlmWorkspaceRetry')}
                        </button>
                      )
                      : null}
                  </div>
                )
                : null}
              {workspace.path !== undefined
                ? (
                  <p className={css.workspacePath} aria-label={t('agentTeamLlmWorkspacePath')}>
                    {workspace.path}
                  </p>
                )
                : null}
            </div>
            <AgentTeamLlmFields
              t={t}
              state={state}
              toggleEnabled={props.toggleEnabled}
              toggleRoute={props.toggleRoute}
              addAllowedRoute={props.addAllowedRoute}
              removeAllowedRoute={props.removeAllowedRoute}
              setRouteEffort={props.setRouteEffort}
              setDefaultRoute={props.setDefaultRoute}
              retryCatalog={props.retryCatalog}
              addRole={props.addRole}
              removeRole={props.removeRole}
              setRoleName={props.setRoleName}
              setRoleRoute={props.setRoleRoute}
              setRoleEffort={props.setRoleEffort}
            />
            <AgentTeamLlmMembers
              t={t}
              members={state.members}
              allowed={state.allowed}
              editable={state.writable && !state.saving}
              addMember={props.addMember}
              removeMember={props.removeMember}
              setMemberName={props.setMemberName}
              setMemberDescription={props.setMemberDescription}
              setMemberPrompt={props.setMemberPrompt}
              setMemberContext={props.setMemberContext}
              setMemberSandboxMode={props.setMemberSandboxMode}
              setMemberRoute={props.setMemberRoute}
              setMemberRouteFields={props.setMemberRouteFields}
              setMemberEffort={props.setMemberEffort}
            />
          </>
        )}
    </SettingsForm>
  )
}
