/** Global instruction editor copy; source text and Host diagnostics stay verbatim. */
export const zh = {
  nav: '全局规则',
  description: '跨项目使用的全局指令；项目规则仍按既有优先级加载。这不是自动长期记忆。其他会话模式若禁用指令加载，则不会应用。',
  timing: '保存后，新会话和已有会话会在下一次模型请求前核对规则。已发出的请求不会改变，正在执行的工具不会被中断。',
  path: '默认会话模式在 Host 上的规则文件',
  editor: '规则正文',
  loading: '正在读取规则…',
  empty: '尚无规则文件。首次保存时才会创建。',
  save: '保存',
  saving: '正在保存…',
  dirty: '有未保存的修改',
  saved: '已保存；尚未确认任何请求已加载。',
  unchanged: '与读取时的文件内容一致',
  reload: '重新读取文件',
  replaceDraft: '重新读取并放弃本页修改',
  readFailed: '读取规则失败：{message}',
  saveFailed: '保存规则失败：{message}',
  conflict: '文件已被其他编辑修改。本页修改仍保留，未覆盖文件。请先复制需要保留的修改，再重新读取文件。',
  unavailable: '当前 Host 未启用全局指令插件，无法解析规则文件路径或编辑规则。',
  disabled: '当前配置禁用了指令加载。文件可以保存，但模型请求不会加载规则。',
  sourceTooLarge: '正文超过单文件读取上限（{limit} 字节），该规则文件会被省略。',
  budgetTooSmall: '正文超过指令总预算（{limit} 字节），不能保证整份规则进入请求。',
  budget: '指令共享上下文预算。规则可能因预算被省略；是否加载请查看会话轨迹中的指令注入记录。',
} satisfies Record<string, string>

/** Dictionary keys owned by the global-rules page. */
export type GlobalRulesKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  nav: 'Global rules',
  description: 'Global instructions shared across projects. Project rules keep their existing priority. This is not automatic long-term memory. Session modes with instruction loading disabled will not apply these rules.',
  timing: 'After saving, new and existing sessions check the rules before their next model request. Requests already sent stay unchanged, and running tools are not interrupted.',
  path: 'Rules file on the Host for the default session mode',
  editor: 'Rule content',
  loading: 'Reading rules…',
  empty: 'No rules file exists. The first save creates it.',
  save: 'Save',
  saving: 'Saving…',
  dirty: 'Unsaved changes',
  saved: 'Saved; no request has yet been confirmed to load these rules.',
  unchanged: 'Matches the file content last read',
  reload: 'Reload file',
  replaceDraft: 'Reload and discard this page’s changes',
  readFailed: 'Could not read rules: {message}',
  saveFailed: 'Could not save rules: {message}',
  conflict: 'The file was edited elsewhere. Your draft is preserved and the file was not overwritten. Copy any changes you want to keep before reloading the file.',
  unavailable: 'This Host has no global instruction plugin enabled, so the rules path cannot be resolved or edited.',
  disabled: 'Instruction loading is disabled in this configuration. The file can be saved, but model requests will not load the rules.',
  sourceTooLarge: 'The content exceeds the file read limit ({limit} bytes), so this rules file will be omitted.',
  budgetTooSmall: 'The content exceeds the total instruction budget ({limit} bytes); the complete rules cannot be guaranteed in a request.',
  budget: 'Instructions share a context budget. Rules may be omitted when the budget is exhausted; check instruction injection records in the session trajectory to confirm loading.',
} satisfies Record<GlobalRulesKey, string>
