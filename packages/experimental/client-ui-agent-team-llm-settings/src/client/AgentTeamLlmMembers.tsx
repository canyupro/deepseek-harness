/** Row editor for the fixed team composition stored in the workspace team document. */

import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  agentTeamLlmRouteKey,
  type AgentTeamLlmCandidate,
  type AgentTeamLlmCardFace,
} from './agent-team-llm-card-controller.ts'
import type { AgentTeamLlmMemberState } from './team-document.ts'
import { classNameOf } from './class-name.ts'
import css from './AgentTeamLlmFields.module.css'

/** Member editing actions supplied by the owning card. */
export type AgentTeamLlmMembersProps = PropsLocale<'settings.agentTeamLlm'>
  & Pick<AgentTeamLlmCardFace,
    | 'addMember' | 'removeMember' | 'setMemberName' | 'setMemberDescription' | 'setMemberPrompt'
    | 'setMemberContext' | 'setMemberSandboxMode' | 'setMemberRoute' | 'setMemberRouteFields' | 'setMemberEffort'>
  & {
    /** Member rows with their own rules settled. */
    members: readonly AgentTeamLlmMemberState[]
    /** Authorized routes the member selector offers. */
    allowed: readonly AgentTeamLlmCandidate[]
    /** Whether the rows accept edits. */
    editable: boolean
  }

/**
 * Render one editable row per workspace member, with the rules each row breaks.
 * @param props - locale copy, the staged member rows, the authorized routes, and their actions.
 * @returns the composition editor.
 */
export function AgentTeamLlmMembers(props: AgentTeamLlmMembersProps) {
  const { t, members, editable } = props
  const allowedKeys = new Set(props.allowed.map(candidate => candidate.key))
  return (
    <div className={css.field}>
      <span className={css.fieldLabel}>{t('agentTeamLlmMembers')}</span>
      {members.length === 0 ? <p className={css.notice}>{t('agentTeamLlmMembersEmpty')}</p> : null}
      <div className={css.members}>
        {members.map((member, index) => {
          const row = css.memberRow
          const invalid = member.problems.length > 0
          return (
            <div key={index} className={invalid ? `${row} ${css.memberInvalid}` : row}>
              <div className={css.memberFields}>
                <Input
                  className={classNameOf(css.memberName)}
                  value={member.name}
                  aria-label={t('agentTeamLlmMemberName')}
                  placeholder={t('agentTeamLlmMemberNamePlaceholder')}
                  aria-invalid={invalid}
                  disabled={!editable}
                  onChange={(event) => { props.setMemberName(index, event.target.value) }}
                />
                <Input
                  className={classNameOf(css.memberDescription)}
                  value={member.description}
                  aria-label={t('agentTeamLlmMemberDescription')}
                  placeholder={t('agentTeamLlmMemberDescriptionPlaceholder')}
                  disabled={!editable}
                  onChange={(event) => { props.setMemberDescription(index, event.target.value) }}
                />
                <select
                  className={css.select}
                  value={member.context}
                  aria-label={t('agentTeamLlmMemberContext')}
                  disabled={!editable}
                  onChange={(event) => {
                    props.setMemberContext(index, event.target.value === 'fork' ? 'fork' : 'fresh')
                  }}
                >
                  <option value="fresh">{t('agentTeamLlmMemberContextFresh')}</option>
                  <option value="fork">{t('agentTeamLlmMemberContextFork')}</option>
                </select>
                <select
                  className={css.select}
                  value={member.sandboxMode}
                  aria-label={t('agentTeamLlmMemberSandbox')}
                  disabled={!editable}
                  onChange={(event) => {
                    const next = event.target.value
                    props.setMemberSandboxMode(
                      index,
                      next === 'read-only' || next === 'workspace-write' || next === 'danger-full-access'
                        ? next
                        : '',
                    )
                  }}
                >
                  <option value="">{t('agentTeamLlmMemberSandboxInherit')}</option>
                  <option value="read-only">{t('agentTeamLlmMemberSandboxReadOnly')}</option>
                  <option value="workspace-write">{t('agentTeamLlmMemberSandboxWorkspaceWrite')}</option>
                  <option value="danger-full-access">{t('agentTeamLlmMemberSandboxFullAccess')}</option>
                </select>
                <select
                  className={css.select}
                  value={member.key}
                  aria-label={t('agentTeamLlmMemberRoute')}
                  aria-invalid={invalid}
                  disabled={!editable}
                  onChange={(event) => { props.setMemberRoute(index, event.target.value) }}
                >
                  <option value="">{t('agentTeamLlmMemberRouteNone')}</option>
                  {props.allowed.map(candidate => (
                    <option key={candidate.key} value={candidate.key}>
                      {`${candidate.providerName} · ${candidate.provider}/${candidate.model}`}
                    </option>
                  ))}
                  {member.key !== ''
                    && agentTeamLlmRouteKey(member.route) !== ''
                    && !allowedKeys.has(member.key)
                    ? (
                      <option value={member.key}>
                        {`${member.route.provider}/${member.route.model}`}
                      </option>
                    )
                    : null}
                </select>
                <button
                  type="button"
                  className={css.removeRole}
                  disabled={!editable}
                  onClick={() => { props.removeMember(index) }}
                >
                  {t('agentTeamLlmMemberRemove')}
                </button>
              </div>
              <textarea
                className={css.memberPrompt}
                value={member.prompt}
                aria-label={t('agentTeamLlmMemberPrompt')}
                placeholder={t('agentTeamLlmMemberPromptPlaceholder')}
                rows={2}
                disabled={!editable}
                onChange={(event) => { props.setMemberPrompt(index, event.target.value) }}
              />
              <div className={css.memberRouteFields}>
                <Input
                  className={classNameOf(css.routeProvider)}
                  value={member.route.provider}
                  aria-label={t('agentTeamLlmRouteProvider')}
                  placeholder={t('agentTeamLlmRouteProviderPlaceholder')}
                  disabled={!editable}
                  onChange={(event) => {
                    props.setMemberRouteFields(index, event.target.value, member.route.model)
                  }}
                />
                <Input
                  className={classNameOf(css.routeModel)}
                  value={member.route.model}
                  aria-label={t('agentTeamLlmRouteModel')}
                  placeholder={t('agentTeamLlmRouteModelPlaceholder')}
                  disabled={!editable}
                  onChange={(event) => {
                    props.setMemberRouteFields(index, member.route.provider, event.target.value)
                  }}
                />
                <Input
                  className={classNameOf(css.routeEffort)}
                  value={member.route.reasoningEffort ?? ''}
                  aria-label={t('agentTeamLlmRouteEffort')}
                  placeholder={t('agentTeamLlmRouteEffortPlaceholder')}
                  disabled={!editable}
                  onChange={(event) => { props.setMemberEffort(index, event.target.value) }}
                />
              </div>
              {invalid
                ? (
                  <p className={css.invalid} role="alert">
                    {member.problems.map(problem => t(problem)).join(' ')}
                  </p>
                )
                : null}
            </div>
          )
        })}
      </div>
      <button type="button" className={css.addRole} disabled={!editable} onClick={props.addMember}>
        {t('agentTeamLlmMemberAdd')}
      </button>
    </div>
  )
}
