# 插件配置表单

[English](settings.md) | 中文

[设置服务](../../packages/settings/settings/README.zh.md) 从活动 profile 条目投影 volatile Config 字段。[配置编辑器](../../packages/boot/config-editor/README.zh.md) 通过 Cordis patch 持久化编辑。业务消费者对自己的 Config 引用调用 `.get()`。

## 标识与值

表单命名空间是当前 profile 中可唯一定位条目的本地 id。多个插件实例在条目 id 不同时拥有独立表单。普通字段被排除。描述符包含实际值、继承值、显式 profile 覆盖值和乐观修订号。

## 编辑

`update` 合并提交的字段。`replace` 先将即时字段重置为继承配置，再应用提交的字段。`mutate` 操作独立路径，保留客户端响应中未包含的秘密值。每次写入都会验证完整 Config，并在持久化前拒绝过期修订号。

`settings/document-updated` 在 Loader 配置变化后使表单描述符失效。这是 UI 通知；消费者仅在需要刷新注册信息时使用 `loader/volatile-update`。

<a id="globalrulesdocument"></a>
## 全局指令文件

[全局指令编辑器](../../packages/context/agent-instructions/README.zh.md#editing-global-rules)读取 Host 上固定的 `AGENTS.md`，独立于插件配置表单。响应报告文件状态和加载限制；保存成功不代表某次模型请求已经加载规则。

```ts type-equiv
/** File state and instruction-loading limits; saving alone does not establish request admission. */
interface GlobalRulesDocument {
  /** Actual configured path on the connected Host. */
  readonly path: string
  /** Exact UTF-8 text, including whitespace and line endings. */
  readonly content: string
  /** Opaque file snapshot fingerprint required by the next save. */
  readonly revision: string
  readonly exists: boolean
  /** Whether this plugin currently has a filesystem provider and an enabled byte budget. */
  readonly loadingEnabled: boolean
  readonly maxBytes: number
  readonly maxSourceBytes: number
}
```


<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxglobalrules--globalrules"></a>

### `ctx.globalRules` — `GlobalRules`

Atomic, revision-checked editor; it never stores a second copy of rule text.

```ts cordis-catalog
/**
 * Read the configured file without creating it; missing files have empty content.
 * @returns exact text, file revision, and current loading limits.
 * @throws Error when the file cannot be read or is not valid UTF-8.
 */
async read(): Promise<GlobalRulesDocument>

/**
 * Replace exact text after checking the caller's revision before and after staging under the writer lock.
 * Retains permission bits independently of umask; symlink targets are readable but cannot be replaced.
 * @param content - complete next UTF-8 text, without normalization.
 * @param expectedRevision - fingerprint returned by the caller's last read.
 * @returns the committed file state; this is not a model-admission receipt.
 * @throws GlobalRulesConflict when the file changed, or Error on permission and storage failures.
 */
async save(content: string, expectedRevision: string): Promise<GlobalRulesDocument>
```

Source: [`packages/context/agent-instructions/src/global-rules.ts`](../../packages/context/agent-instructions/src/global-rules.ts)

<a id="ctxsettings--settingsforms"></a>

### `ctx.settings` — `SettingsForms`

Project Config schemas into forms and own optional instance-level UI policy.

```ts cordis-catalog
/** Register the calling plugin instance's page policy without changing its Config.
 * @param presentation Automatic-page policy for this instance; `auto` defaults to true.
 * @param owner Plugin instance the policy belongs to; defaults to the calling fiber.
 * @returns Disposer; register it with the calling plugin's effects.
 * @throws If this instance already has a registered policy.
 */
configure(presentation: { auto?: boolean }, owner: Fiber = this.ctx.fiber): () => void

/** Locate the profile patch for native editing.
 * @returns The existing profile patch path.
 */
prepareDocument(): Promise<string>

/** Read active plugin schemas and their live values.
 * @param options Redaction required for remote callers.
 * @returns Forms keyed by unique profile entry ids.
 */
describe(options?: SettingsDescribeOptions): SettingsDescriptor[]

/** Merge editable fields into an entry's config.
 * @param ns Profile entry id.
 * @param patch Fields to merge.
 * @param expectedRevision Revision returned by describe.
 */
async update(ns: string, patch: object, expectedRevision?: number): Promise<void>

/** Reset all live fields, then set the supplied fields; ordinary config is preserved.
 * @param ns Profile entry id.
 * @param section Complete form values.
 * @param expectedRevision Revision returned by describe.
 */
async replace(ns: string, section: object, expectedRevision?: number): Promise<void>

/** Apply field edits without restating redacted secrets; unsetting an array index removes its element.
 * @param ns Profile entry id.
 * @param ops Ordered form edits.
 * @param expectedRevision Revision returned by describe.
 */
async mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
```

Source: [`packages/settings/settings/src/index.ts`](../../packages/settings/settings/src/index.ts)

<a id="ctxsettingscontroller--settingscontroller"></a>

### `ctx.settingsController` — `SettingsController`

Host service backing the generated `ctx.remote.settings` namespace. Every remote read uses `redactSecrets: true`, so a `role('secret')` field cannot ride a response. Writes expose the settings service's merge, replacement, and path-addressed operations, and classify every provider refusal as `settings/conflict` or `settings/rejected` with the service's message.

```ts cordis-catalog
/**
 * Describe every registered namespace for a configuration page: redacted
 * layered values plus the serialized schema the page renders its form from.
 * @returns provider writability, local-document presence, and one view per namespace.
 * @throws RemoteError when no settings provider is mounted.
 */
@Remote describe(): SettingsDescribeValue

/**
 * Read the sole global instruction file on this Host.
 * @returns current text and revision, or null when instruction loading is not mounted.
 * @throws RemoteError when the file cannot be read.
 */
@Remote async readGlobalRules(): Promise<GlobalRulesDocument | null>

/**
 * Save exact global rule text against the editor's last observed file revision.
 * @param content - complete next text.
 * @param expectedRevision - revision returned by readGlobalRules.
 * @returns committed file state, without claiming model admission.
 * @throws RemoteError when loading is absent, a concurrent edit conflicts, or storage refuses the write.
 */
@Remote async saveGlobalRules(content: string, expectedRevision: string): Promise<GlobalRulesDocument>

/**
 * Merge a patch into one namespace's stored user section.
 * @param ns - namespace key to write.
 * @param patch - fields to merge into the user section.
 * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
 * @returns the namespace's redacted view after the write.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote update( ns: string, patch: Record<string, JsonValue>, expectedRevision: number | undefined, ): Promise<SettingsNamespaceView>

/**
 * Replace one namespace's stored user section wholesale.
 * @param ns - namespace key to write.
 * @param section - complete replacement user section.
 * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
 * @returns the namespace's redacted view after the write.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote replace( ns: string, section: Record<string, JsonValue>, expectedRevision: number | undefined, ): Promise<SettingsNamespaceView>

/**
 * Apply path-addressed edits to one namespace's user section, resolved against
 * the section as stored rather than against whatever the caller last read,
 * then answer with that namespace's new redacted view.
 * @param ns - namespace key to write.
 * @param ops - the edits to apply, in order.
 * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
 * @returns the namespace's redacted view after the write.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async mutate( ns: string, ops: SettingsPathOpView[], expectedRevision: number | undefined, ): Promise<SettingsNamespaceView>

/**
 * Materialize the provider-owned settings document and open it in a native text editor.
 * @param signal - caller lifetime; abort terminates preparation or the native command.
 * @returns confirmation after the native opener accepts the document.
 * @throws RemoteError when no document exists, preparation fails, or opening fails.
 */
@Remote async openSettingsDocument(signal: AbortSignal): Promise<SettingsDocumentOpenValue>
```

Source: [`packages/api/settings-controller/src/index.ts`](../../packages/api/settings-controller/src/index.ts)

<a id="global-rules-events"></a>

### `global-rules/*` events

<a id="global-rulessaved--emit"></a>

#### `global-rules/saved` — emit

A Host editor committed changed global rule text. Carries no rule body.

```ts cordis-catalog
/**
 * A Host editor committed changed global rule text. Carries no rule body.
 * @mode emit
 * @param path - absolute configured rule file path.
 */
'global-rules/saved'(path: string): void
```

Source: [`packages/context/agent-instructions/src/global-rules.ts`](../../packages/context/agent-instructions/src/global-rules.ts)

<a id="settings-events"></a>

### `settings/*` events

<a id="settingsdocument-updated--emit"></a>

#### `settings/document-updated` — emit

One profile entry's form values, availability, or page policy changed. Form clients re-read its schema, resolved values, and revision.

```ts cordis-catalog
/**
 * One profile entry's form values, availability, or page policy changed.
 * Form clients re-read its schema, resolved values, and revision.
 * @param ns Profile entry id.
 * @param revision The entry's new revision.
 * @mode emit
 */
'settings/document-updated'(ns: SettingsNamespace, revision: number): void
```

Source: [`packages/settings/settings/src/types.ts`](../../packages/settings/settings/src/types.ts)
<!-- END GENERATED cordis-surface -->
