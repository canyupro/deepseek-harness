/** User control for the exact child LLM routes Agent Teams teammates may run on. */

import { Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useState } from 'react'
import {
  agentTeamLlmRouteKey,
  type AgentTeamLlmCandidate,
  type AgentTeamLlmCardFace,
  type AgentTeamLlmCardState,
} from './agent-team-llm-card-controller.ts'
import { classNameOf } from './class-name.ts'
import css from './AgentTeamLlmFields.module.css'

/** Plain routing state and callbacks supplied by the owning card. */
export type AgentTeamLlmFieldsProps = PropsLocale<'settings.agentTeamLlm'>
  & Pick<AgentTeamLlmCardFace,
    | 'toggleEnabled' | 'toggleRoute' | 'addAllowedRoute' | 'removeAllowedRoute' | 'setRouteEffort'
    | 'setDefaultRoute' | 'retryCatalog'
    | 'addRole' | 'removeRole' | 'setRoleName' | 'setRoleRoute' | 'setRoleEffort'>
  & { state: AgentTeamLlmCardState }

/**
 * The authorized routes as their own editor: a hand-typed provider and model
 * adds one the directory does not advertise, each authorized row carries its
 * reasoning effort and a remove control. The catalogue checkboxes above stay
 * the way to bulk-authorize what this installation already advertises.
 * @param props - locale copy, the authorized routes, and the disabled state.
 * @returns the authorized-route editor.
 */
function AuthorizedRoutes(props: {
  t: AgentTeamLlmFieldsProps['t']
  allowed: readonly AgentTeamLlmCandidate[]
  disabled: boolean
  addAllowedRoute: AgentTeamLlmFieldsProps['addAllowedRoute']
  removeAllowedRoute: AgentTeamLlmFieldsProps['removeAllowedRoute']
  setRouteEffort: AgentTeamLlmFieldsProps['setRouteEffort']
}) {
  const { t, allowed, disabled } = props
  // Only this editor knows what has been typed, so the half-filled pair stays
  // here until both halves name a route.
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const add = () => {
    props.addAllowedRoute(provider, model)
    setProvider('')
    setModel('')
  }
  return (
    <div className={css.routes}>
      <span className={css.fieldLabel}>{t('agentTeamLlmRoutesTitle')}</span>
      <p className={css.hint}>{t('agentTeamLlmRoutesTitleHint')}</p>
      {allowed.length === 0 ? <p className={css.notice}>{t('agentTeamLlmRoutesEmpty')}</p> : null}
      <div className={css.routes}>
        {allowed.map(route => (
          <div key={route.key} className={css.routeRow}>
            <span className={css.routeIdentity}>{`${route.provider}/${route.model}`}</span>
            <Input
              className={classNameOf(css.routeEffort)}
              value={route.reasoningEffort ?? ''}
              aria-label={t('agentTeamLlmRouteEffort')}
              placeholder={t('agentTeamLlmRouteEffortPlaceholder')}
              disabled={disabled}
              onChange={(event) => { props.setRouteEffort(route.key, event.target.value) }}
            />
            <button
              type="button"
              className={css.removeRole}
              disabled={disabled}
              onClick={() => { props.removeAllowedRoute(route.key) }}
            >
              {t('agentTeamLlmRouteRemove')}
            </button>
          </div>
        ))}
      </div>
      <div className={css.routeAdd}>
        <Input
          className={classNameOf(css.routeProvider)}
          value={provider}
          aria-label={t('agentTeamLlmRouteProvider')}
          placeholder={t('agentTeamLlmRouteProviderPlaceholder')}
          disabled={disabled}
          onChange={(event) => { setProvider(event.target.value) }}
        />
        <Input
          className={classNameOf(css.routeModel)}
          value={model}
          aria-label={t('agentTeamLlmRouteModel')}
          placeholder={t('agentTeamLlmRouteModelPlaceholder')}
          disabled={disabled}
          onChange={(event) => { setModel(event.target.value) }}
        />
        <button type="button" className={css.addRole} disabled={disabled || provider === '' || model === ''} onClick={add}>
          {t('agentTeamLlmRouteAdd')}
        </button>
      </div>
    </div>
  )
}

/**
 * Render the routing switch, its authorized routes, and the default and preset controls.
 * @param props - locale copy, the card snapshot, and its staged actions.
 * @returns the routing controls inside the shared card.
 */
export function AgentTeamLlmFields(props: AgentTeamLlmFieldsProps) {
  const { t, state } = props
  const disabled = !state.writable || state.saving
  const groups = new Map<string, {
    providerName: string
    candidates: AgentTeamLlmCandidate[]
  }>()
  const unavailable: AgentTeamLlmCandidate[] = []
  for (const candidate of state.candidates) {
    if (!candidate.available) {
      unavailable.push(candidate)
      continue
    }
    const group = groups.get(candidate.provider)
    if (group === undefined) {
      groups.set(candidate.provider, { providerName: candidate.providerName, candidates: [candidate] })
    } else {
      group.candidates.push(candidate)
    }
  }
  const defaultKey = agentTeamLlmRouteKey(state.defaultRoute)
  const allowedKeys = new Set(state.allowed.map(candidate => candidate.key))
  const routeChoice = (candidate: AgentTeamLlmCandidate) => (
    <option key={candidate.key} value={candidate.key}>
      {`${candidate.providerName} · ${candidate.provider}/${candidate.model}`}
    </option>
  )
  const renderCandidate = (candidate: AgentTeamLlmCandidate) => (
    <label key={candidate.key} className={css.model}>
      <input
        type="checkbox"
        checked={candidate.selected}
        disabled={disabled}
        onChange={() => { props.toggleRoute(candidate.key) }}
      />
      <span>
        <span className={css.modelName}>{candidate.modelName}</span>
        <span className={css.route}>{`${candidate.providerName} · ${candidate.provider}/${candidate.model}`}</span>
      </span>
      {!candidate.available
        ? <span className={css.unavailable}>{t('agentTeamLlmUnavailable')}</span>
        : null}
    </label>
  )
  return (
    <>
      <div className={css.permission}>
        <div className={css.toggleRow}>
          <span className={css.toggleLabel}>{t('agentTeamLlmToggle')}</span>
          <Switch
            checked={state.enabled}
            label={t('agentTeamLlmToggle')}
            disabled={disabled}
            onChange={props.toggleEnabled}
          />
        </div>
        <p className={css.hint}>
          {t(state.enabled ? 'agentTeamLlmChoose' : 'agentTeamLlmOff')}
        </p>
      </div>
      {state.enabled
        ? (
          <div className={css.selection}>
            {state.catalogStatus === 'loading'
              ? <p className={css.notice} role="status">{t('agentTeamLlmLoading')}</p>
              : null}
            {state.catalogStatus === 'error'
              ? (
                <div className={css.catalogError} role="alert">
                  <span>{t('agentTeamLlmLoadFailed')}</span>
                  <button type="button" disabled={disabled} onClick={props.retryCatalog}>
                    {t('agentTeamLlmRetry')}
                  </button>
                </div>
              )
              : null}
            {state.catalogPartial
              ? <p className={css.notice}>{t('agentTeamLlmPartial')}</p>
              : null}
            {state.candidates.length > 0
              ? (
                <fieldset className={css.models}>
                  <legend>{t('agentTeamLlmAllowed')}</legend>
                  {[...groups].map(([provider, group]) => (
                    <div key={provider} className={css.modelGroup}>
                      <div className={css.providerName}>{group.providerName}</div>
                      {group.candidates.map(renderCandidate)}
                    </div>
                  ))}
                  {unavailable.length > 0
                    ? (
                      <div className={css.modelGroup}>
                        <div className={css.providerName}>{t('agentTeamLlmUnavailableGroup')}</div>
                        {unavailable.map(renderCandidate)}
                      </div>
                    )
                    : null}
                </fieldset>
              )
              : state.catalogStatus === 'ready'
                ? <p className={css.notice}>{t('agentTeamLlmEmpty')}</p>
                : null}
            <AuthorizedRoutes
              t={t}
              allowed={state.allowed}
              disabled={disabled}
              addAllowedRoute={props.addAllowedRoute}
              removeAllowedRoute={props.removeAllowedRoute}
              setRouteEffort={props.setRouteEffort}
            />
          </div>
        )
        : null}
      <div className={css.fields}>
        <div className={css.field}>
          <span className={css.fieldLabel}>{t('agentTeamLlmDefault')}</span>
          <select
            className={css.select}
            value={defaultKey}
            aria-label={t('agentTeamLlmDefault')}
            disabled={disabled}
            onChange={(event) => { props.setDefaultRoute(event.target.value) }}
          >
            <option value="">{t('agentTeamLlmDefaultNone')}</option>
            {state.allowed.map(routeChoice)}
            {defaultKey !== '' && !allowedKeys.has(defaultKey)
              ? <option value={defaultKey}>{`${state.defaultRoute.provider}/${state.defaultRoute.model}`}</option>
              : null}
          </select>
        </div>
        <div className={css.field}>
          <span className={css.fieldLabel}>{t('agentTeamLlmRoles')}</span>
          {state.roles.length === 0 ? <p className={css.notice}>{t('agentTeamLlmRolesEmpty')}</p> : null}
          <div className={css.roles}>
            {state.roles.map((role, index) => (
              <div key={index} className={css.roleRow}>
                <Input
                  className={classNameOf(css.roleName)}
                  value={role.name}
                  aria-label={t('agentTeamLlmRoleName')}
                  placeholder={t('agentTeamLlmRoleNamePlaceholder')}
                  disabled={disabled}
                  onChange={(event) => { props.setRoleName(index, event.target.value) }}
                />
                <select
                  className={css.select}
                  value={role.key}
                  aria-label={t('agentTeamLlmRoleRoute')}
                  disabled={disabled}
                  onChange={(event) => { props.setRoleRoute(index, event.target.value) }}
                >
                  <option value="">{t('agentTeamLlmRoleRouteNone')}</option>
                  {state.allowed.map(routeChoice)}
                  {role.key !== '' && !allowedKeys.has(role.key)
                    ? <option value={role.key}>{`${role.route.provider}/${role.route.model}`}</option>
                    : null}
                </select>
                <Input
                  className={classNameOf(css.routeEffort)}
                  value={role.route.reasoningEffort ?? ''}
                  aria-label={t('agentTeamLlmRoleEffort')}
                  placeholder={t('agentTeamLlmRouteEffortPlaceholder')}
                  disabled={disabled}
                  onChange={(event) => { props.setRoleEffort(index, event.target.value) }}
                />
                <button
                  type="button"
                  className={css.removeRole}
                  disabled={disabled}
                  onClick={() => { props.removeRole(index) }}
                >
                  {t('agentTeamLlmRoleRemove')}
                </button>
              </div>
            ))}
          </div>
          <button type="button" className={css.addRole} disabled={disabled} onClick={props.addRole}>
            {t('agentTeamLlmRoleAdd')}
          </button>
        </div>
        {state.problems.map(problem => (
          <p key={problem} className={css.invalid}>{t(problem)}</p>
        ))}
      </div>
      {state.conflicted
        ? <p className={css.conflict} role="status">{t('agentTeamLlmConflict')}</p>
        : null}
    </>
  )
}
