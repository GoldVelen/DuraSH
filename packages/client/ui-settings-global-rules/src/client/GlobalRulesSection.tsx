/** Editor for the Host-owned global instruction file, with a revision-fenced draft. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GlobalRulesDocument } from '@deepseek-ai/dsh-api-settings-controller/types'
import css from './GlobalRulesSection.module.css'

/** The file operations available to this page, scoped to the configured Host file. */
export interface GlobalRulesSectionInjected {
  /** Read the configured file; null means the instruction plugin is absent. */
  read: () => Promise<GlobalRulesDocument | null>
  /** Save exactly this draft against the revision loaded by the editor. */
  save: (content: string, revision: string) => Promise<
    | { kind: 'saved'; document: GlobalRulesDocument }
    | { kind: 'conflict' }
    | { kind: 'failed'; message: string }
  >
}

/** Settings entry props derived from the slot and the file operation callbacks. */
export type GlobalRulesSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.globalRules'> & InjectFace<GlobalRulesSectionInjected>

/**
 * Render the file draft and distinguish disk persistence from request loading.
 * @param props - localized settings props and Host file operations.
 * @returns the editable settings section.
 */
export function GlobalRulesSection({ read, save, t }: GlobalRulesSectionProps) {
  const [document, setDocument] = useState<GlobalRulesDocument | null | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<{ kind: 'readFailed' | 'saveFailed'; message: string } | undefined>()
  const [conflict, setConflict] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(undefined)
    setSaved(false)
    void read().then((value) => {
      if (disposed) return
      setDocument(value)
      setDraft(value?.content ?? '')
      setConflict(false)
    }, (failure: unknown) => {
      if (disposed) return
      setError({ kind: 'readFailed', message: failure instanceof Error ? failure.message : String(failure) })
    }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [read, reload])

  const draftBytes = new TextEncoder().encode(draft).byteLength
  const dirty = document != null && draft !== document.content
  async function saveDraft(): Promise<void> {
    if (document == null) return
    setSaving(true)
    setError(undefined)
    setSaved(false)
    const result = await save(draft, document.revision)
    setSaving(false)
    if (result.kind === 'saved') {
      setDocument(result.document)
      setSaved(true)
      setConflict(false)
    } else if (result.kind === 'conflict') {
      setConflict(true)
    } else {
      setError({ kind: 'saveFailed', message: result.message })
    }
  }

  return <section className={css.section}>
    <h2 className={css.title}>{t('nav')}</h2>
    <p className={css.hint}>{t('description')}</p>
    <p className={css.hint}>{t('timing')}</p>
    {loading && <p role="status">{t('loading')}</p>}
    {document === null && <p role="alert" className={css.error}>{t('unavailable')}</p>}
    {error !== undefined && <p role="alert" className={css.error}>{t(error.kind, { message: error.message })}</p>}
    {document != null && <>
      <div className={css.path}><span>{t('path')}</span><code>{document.path}</code></div>
      {!document.exists && <p className={css.hint}>{t('empty')}</p>}
      {!document.loadingEnabled && <p role="alert" className={css.error}>{t('disabled')}</p>}
      <label className={css.label} htmlFor="global-rules-content">{t('editor')}</label>
      <textarea id="global-rules-content" className={css.editor} value={draft}
        disabled={loading || saving} spellCheck={false}
        onChange={(event) => { setDraft(event.target.value); setSaved(false) }} />
      {conflict && <p role="alert" className={css.error}>{t('conflict')}</p>}
      <div className={css.actions}>
        <Button variant="primary" disabled={loading || saving || conflict || (!dirty && document.exists)}
          onClick={() => { void saveDraft() }}>{t(saving ? 'saving' : 'save')}</Button>
        <span role="status" className={css.hint}>{t(saved ? 'saved' : dirty ? 'dirty' : 'unchanged')}</span>
      </div>
      {draftBytes > document.maxSourceBytes && <p role="alert" className={css.error}>
        {t('sourceTooLarge', { limit: document.maxSourceBytes })}
      </p>}
      {document.loadingEnabled && draftBytes > document.maxBytes && <p role="alert" className={css.error}>
        {t('budgetTooSmall', { limit: document.maxBytes })}
      </p>}
      <p className={css.hint}>{t('budget')}</p>
    </>}
    <div><Button variant="outline" disabled={loading || saving}
      onClick={() => { setReload(value => value + 1) }}>{t(dirty ? 'replaceDraft' : 'reload')}</Button></div>
  </section>
}
