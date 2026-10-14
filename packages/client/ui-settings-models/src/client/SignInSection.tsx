/**
 * Sign-in area of the Models settings section: each Host authorization flow
 * that offers OAuth (ChatGPT, Grok/X, Claude, and the other subscription
 * providers the pi-ai adapter ships logins for), startable in place. An
 * attempt renders its Host-reported progress — the page to open, the code to
 * type, and one pending question at a time — and its terminal outcome. The
 * state is the Host's own: reloading the page rejoins the running attempt
 * instead of starting over.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AuthorizationAttemptView, AuthorizationFlowView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import type { SignInStore } from './sign-in-store.ts'
import styles from './ModelsSection.module.css'
import signInStyles from './SignInSection.module.css'

const OPEN_CODE_GO_KEY = 'llm-pi-ai/opencode-go'

/** Injected dependencies of {@link SignInSection} (slot `inject`). */
export interface SignInInjected {
  controller: SignInStore
  hooks: {
    /** Area snapshot bound by the UI renderer as useSnapshot. */
    signIn: SignInStore['store']
  }
  /** Area copy. */
  t: (key: keyof typeof en) => string
}

export type SignInSectionProps = Partial<InjectFace<SignInInjected>>

/**
 * The subscription logins this area offers: Host flows that declare an
 * `oauth` method. API-key-only catalog logins stay on the add form, which is
 * already the place a pasted key is stored.
 * @param flows - the Host `describe` list, registration order preserved.
 * @returns the OAuth subset, still in Host order.
 */
export function oauthSignInFlows(
  flows: readonly AuthorizationFlowView[],
): readonly AuthorizationFlowView[] {
  return flows.filter(flow => flow.methods.some(method => method.id === 'oauth'))
}

/**
 * Render the sign-in area, or nothing while the Host offers no OAuth flows —
 * a composition without the authorization service legitimately has no surface
 * to sign in from, and an absent area is that absence rendered.
 */
export function SignInSection(props: SignInSectionProps): ReactNode {
  const { controller, useSignIn, t } = props
  if (controller === undefined || useSignIn === undefined || t === undefined) return null
  return <SignInLoaded controller={controller} useSignIn={useSignIn} t={t} />
}

function SignInLoaded({
  controller,
  useSignIn,
  t,
}: {
  controller: SignInStore
  useSignIn: InjectFace<SignInInjected>['useSignIn']
  t: (key: keyof typeof en) => string
}): ReactNode {
  const state = useSignIn(snapshot => snapshot)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [working, setWorking] = useState(false)

  useEffect(() => controller.startPolling(), [controller])

  const flows = oauthSignInFlows(state.flows)
  if (state.status === 'error' || flows.length === 0) return null

  const run = (action: () => Promise<string | undefined>): void => {
    if (working) return
    setWorking(true)
    setFailure(undefined)
    void action().then((failureMessage) => { setFailure(failureMessage) }).finally(() => { setWorking(false) })
  }
  const attemptByKey = new Map(state.attempts.map(view => [view.key, view]))

  return (
    <div className={signInStyles['signIn']}>
      <h3 className={signInStyles['signInTitle']}>{t('signInTitle')}</h3>
      <p className={signInStyles['signInIntro']}>{t('signInIntro')}</p>
      {failure !== undefined && <p className={styles['error']} role="alert">{failure}</p>}
      <ul className={signInStyles['flowList']}>
        {flows.map(flow => (
          <FlowRow
            key={flow.key}
            flow={flow}
            attempt={attemptByKey.get(flow.key)}
            working={working}
            t={t}
            onBegin={(method) => { run(() => controller.begin(flow.key, method)) }}
            onCancel={() => { run(() => controller.cancel(flow.key)) }}
            onRespond={(promptId, value) => { run(() => controller.respond(flow.key, promptId, { value })) }}
            onDecline={(promptId) => { run(() => controller.respond(flow.key, promptId, { declined: true })) }}
          />
        ))}
      </ul>
    </div>
  )
}

function FlowRow({
  flow,
  attempt,
  working,
  t,
  onBegin,
  onCancel,
  onRespond,
  onDecline,
}: {
  flow: AuthorizationFlowView
  attempt: AuthorizationAttemptView | undefined
  working: boolean
  t: (key: keyof typeof en) => string
  onBegin: (method: 'oauth' | 'api-key') => void
  onCancel: () => void
  onRespond: (promptId: string, value: string) => void
  onDecline: (promptId: string) => void
}): ReactNode {
  const running = attempt?.status === 'running'
  const pending = attempt?.pendingPrompt
  const [draft, setDraft] = useState({ promptId: pending?.id, value: '' })
  const answer = draft.promptId === pending?.id ? draft.value : ''
  useEffect(() => { setDraft({ promptId: pending?.id, value: '' }) }, [pending?.id])
  const isGo = flow.key === OPEN_CODE_GO_KEY
  const goApiKey = isGo && flow.methods.some(method => method.id === 'api-key')
  return (
    <li className={signInStyles['flowRow']} aria-label={flow.label}>
      <div className={signInStyles['flowHead']}>
        <span className={signInStyles['flowName']}>{flow.label}</span>
        <span className={signInStyles['flowActions']}>
          {running
            ? (
              <button
                type="button"
                className={styles['secondaryButton']}
                disabled={working}
                onClick={onCancel}
              >
                {t('signInCancelAttempt')}
              </button>
            )
            : (
              <>
                <button
                  type="button"
                  className={styles[isGo ? 'primaryButton' : 'secondaryButton']}
                  disabled={working || flow.inFlight}
                  onClick={() => { onBegin('oauth') }}
                >
                  {t(isGo ? 'signInBrowserAction' : 'signInAction')}
                </button>
                {goApiKey && (
                  <button
                    type="button"
                    className={styles['secondaryButton']}
                    disabled={working || flow.inFlight}
                    onClick={() => { onBegin('api-key') }}
                  >
                    {t('useApiKeyAuth')}
                  </button>
                )}
              </>
            )}
        </span>
      </div>
      {isGo && (
        <p className={signInStyles['noticeLine']}>
          {t('openCodeGoUsageHint')}{' '}
          <a href="https://opencode.ai/console/" target="_blank" rel="noreferrer">{t('openCodeGoConsole')}</a>
        </p>
      )}
      {attempt !== undefined && (
        <div className={signInStyles['attempt']}>
          {running
            ? attempt.notices.map((notice, index) => (
              <p key={index} className={signInStyles['noticeLine']}>
                {notice.message}
                {notice.url !== undefined && (
                  <>
                    {' '}
                    <a href={notice.url} target="_blank" rel="noreferrer">{t('signInOpenPage')}</a>
                  </>
                )}
                {notice.code !== undefined && (
                  <>
                    {' '}
                    <code className={signInStyles['noticeCode']}>{notice.code}</code>
                  </>
                )}
              </p>
            ))
            : null}
          {running && pending !== undefined && (
            <div className={signInStyles['prompt']}>
              <p className={signInStyles['promptMessage']}>{pending.message}</p>
              {pending.kind === 'select' && pending.options !== undefined ? (
                <div className={signInStyles['promptOptions']}>
                  {pending.options.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      className={styles['secondaryButton']}
                      disabled={working}
                      onClick={() => { onRespond(pending.id, option.id) }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className={signInStyles['promptAnswer']}>
                  <input
                    type={pending.kind === 'secret' ? 'password' : 'text'}
                    aria-label={pending.message}
                    className={signInStyles['promptInput']}
                    value={answer}
                    placeholder={pending.placeholder ?? ''}
                    onChange={(event) => { setDraft({ promptId: pending.id, value: event.target.value }) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && answer.length > 0 && !working) onRespond(pending.id, answer)
                    }}
                  />
                  <button
                    type="button"
                    className={styles['primaryButton']}
                    disabled={working || answer.length === 0}
                    onClick={() => { onRespond(pending.id, answer) }}
                  >
                    {t('signInSubmit')}
                  </button>
                  <button
                    type="button"
                    className={styles['secondaryButton']}
                    disabled={working}
                    onClick={() => { onDecline(pending.id) }}
                  >
                    {t('signInDecline')}
                  </button>
                </div>
              )}
            </div>
          )}
          {attempt.status === 'authorized' && (
            <p className={signInStyles['outcome']} role="status">{t('signInAuthorized')}</p>
          )}
          {attempt.status === 'cancelled' && (
            <p className={signInStyles['outcome']}>{t('signInCancelled')}</p>
          )}
          {attempt.status === 'failed' && (
            <p className={styles['error']} role="alert">
              {`${t('signInFailed')}: ${attempt.message ?? ''}`}
            </p>
          )}
        </div>
      )}
    </li>
  )
}
