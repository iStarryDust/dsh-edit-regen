/** `editregen` 命名空间的词典：内联编辑器与它的动作。 */

/** 简体中文词典（键集的事实来源）。 */
export const zh = {
  'edit.action': '编辑这条消息',
  'edit.unavailable.running': '智能体运行中，暂不能编辑',
  'edit.unavailable.subagent': '子智能体会话不能编辑',
  'edit.hint': '将从此条消息重新生成，它之后的内容不会保留',
  'edit.cancel': '取消',
  'edit.save': '重新生成',
  'edit.failed': '修改失败：{reason}',
  'edit.image.add': '添加图片',
  'edit.image.remove': '移除这张图片',
  'edit.file.add': '添加文件',
  'edit.file.remove': '移除这个文件',
  'copy': '复制',
  'copied': '已复制',
} satisfies Record<string, string>

/** editregen 命名空间的键联合。 */
export type EditRegenKey = keyof typeof zh

/** 英文词典，按 zh 的键集校验完整性。 */
export const en = {
  'edit.action': 'Edit this message',
  'edit.unavailable.running': 'Unavailable while the agent is running',
  'edit.unavailable.subagent': 'Subagent sessions cannot be edited',
  'edit.hint': 'Regenerates from this message; later content will not be kept',
  'edit.cancel': 'Cancel',
  'edit.save': 'Regenerate',
  'edit.failed': 'Edit failed: {reason}',
  'edit.image.add': 'Add images',
  'edit.image.remove': 'Remove this image',
  'edit.file.add': 'Add files',
  'edit.file.remove': 'Remove this file',
  'copy': 'Copy',
  'copied': 'Copied',
} satisfies Record<EditRegenKey, string>
