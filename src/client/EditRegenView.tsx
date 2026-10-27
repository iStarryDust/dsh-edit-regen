/**
 * 被遮蔽的持久用户消息渲染器：官方的气泡与图标动作，外加一个「编辑」入口——点开换成
 * 内联编辑器，从这条消息开始重写会话。智能体空闲、且不是子智能体会话时才允许编辑；
 * 消息里的图片与文件可以逐个移除，也可以再附新的。
 */
import {
  Fragment, memo, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode,
} from 'react'
import {
  IconCheckOutlineRegular, IconCloseOutlineRegular, IconCopyOutlineRegular, IconEditOutlineRegular,
  FileTypeIcon, JsonBlock, Tooltip, writeClipboard,
  fileExtension, fileSizeText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ChatNodeOwnerProps, ChatNodeViewProps,
} from '@deepseek-ai/dsh-client-ui-chat/client'

/**
 * 0.2.1 的 primitives 删掉了 `projectUserText`（旧版负责把 @引用与斜杠命令渲染成高亮片段）。
 * 这里降级为纯文本渲染：消息内容完整显示，只是引用标签不再单独高亮。
 */
function projectUserText(text: string): ReactNode {
  return text
}

import type { MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { InjectFace, PropsLocale, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { EditActionsInjected, DraftFile } from './actions.ts'
import type { EditRegenKey } from './locales.ts'
import css from './EditRegen.module.css'

/** The merged node data: the durable message plus the conversation's reference labels. */
type ReferencedUserMessage = ChatNodeViewProps<'user'>['node']['data']
type UserImage = Extract<ReferencedUserMessage['content'][number], { type: 'image' }>
type UserFile = Extract<ReferencedUserMessage['content'][number], { type: 'file' }>

type PresentedAttachment =
  | {
    readonly type: 'image'
    readonly image: MessageImageSource
  }
  | {
    readonly type: 'file'
    readonly file: UserFile['attachment']
  }

function contentParts(content: readonly unknown[]): {
  text: string
  attachments: PresentedAttachment[]
  rest: unknown[]
} {
  const texts: string[] = []
  const attachments: PresentedAttachment[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      attachments.push({ type: 'image', image: { attachment: (b as UserImage).attachment } })
    }
    else if (b.type === 'file' && b.attachment !== undefined) {
      attachments.push({ type: 'file', file: (b as UserFile).attachment })
    }
    else rest.push(block)
  }
  return { text: texts.join(''), attachments, rest }
}

/** The date-template share of the chat dictionary the clock consumes. */
type ChatTranslate = Translate<'clock.md' | 'clock.ymd' | 'json.truncated' | 'message.extraBlock' | 'message.referenceSummary' | 'message.referenceSeparator'>

/**
 * Display name of a durable image reference. The owner used to hand renderers a
 * `renderMessageImages` closure; a shell that stopped passing it leaves only the
 * reference, which still carries the upload's name — enough for a label.
 * @param image - The attachment reference as contentParts built it.
 * @returns The file name, or `image` when the reference carries none.
 */
function imageNameOf(image: unknown): string {
  const ref = (image as { attachment?: { name?: unknown } } | null)?.attachment
  const name = ref?.name
  return typeof name === 'string' && name !== '' ? name : 'image'
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function msUntilNextLocalMidnight(ms: number): number {
  const next = new Date(ms)
  next.setHours(24, 0, 0, 0)
  return Math.max(next.getTime() - ms, 1)
}

/**
 * Compact local timestamp for the actions row: same calendar day → `HH:mm`;
 * earlier this year → the localized month-day template + clock; other years →
 * the full date template + clock. Port of the official message chrome.
 */
function formatMessageClock(time: number, t: ChatTranslate, now: number = Date.now()): string {
  const d = new Date(time)
  const n = new Date(now)
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) {
    return clock
  }
  const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
  const md = d.getFullYear() === n.getFullYear() ? t('clock.md', params) : t('clock.ymd', params)
  return `${md} ${clock}`
}

/**
 * Component-local calendar-day tick: memoized rows keep stable props across
 * midnight, so the clock needs a seat that re-fires at the next local
 * midnight. Port of the official hook.
 */
function useCalendarDay(): number {
  const [day, setDay] = useState(() => startOfLocalDay(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const arm = (): void => {
      const now = Date.now()
      setDay(startOfLocalDay(now))
      timer = setTimeout(arm, msUntilNextLocalMidnight(now))
    }
    timer = setTimeout(arm, msUntilNextLocalMidnight(Date.now()))
    return () => { clearTimeout(timer) }
  }, [])
  return day
}

/** Copy / clock / edit actions under the user bubble. */
function MessageActions({
  text, time, onEdit, editUnavailable, editTitle, chatT, t,
}: {
  text: string
  time: number | undefined
  onEdit: (() => void) | undefined
  editUnavailable: boolean | undefined
  editTitle: string | undefined
  chatT: ChatTranslate
  t: (key: EditRegenKey, params?: Record<string, unknown>) => string
}): ReactNode {
  const day = useCalendarDay()
  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyEpoch = useRef(0)
  useEffect(() => () => {
    copyEpoch.current += 1
    copyPending.current = false
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const onCopy = (): void => {
    if (copied || copyPending.current) return
    const epoch = copyEpoch.current
    copyPending.current = true
    void writeClipboard(text).then((ok) => {
      if (epoch !== copyEpoch.current) return
      copyPending.current = false
      if (!ok) return
      setCopied(true)
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null
        setCopied(false)
      }, 1000)
    })
  }
  return (
    <div className={css.actions} data-clock="start">
      {time !== undefined && (
        <span className={css.timeStart}>{formatMessageClock(time, chatT, day)}</span>
      )}
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={onCopy}>
          {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
        </button>
      </Tooltip>
      {onEdit !== undefined && (
        <Tooltip label={editUnavailable === true ? (editTitle ?? '') : t('edit.action')} side="bottom">
          <button
            type="button"
            className={css.action}
            aria-label={t('edit.action')}
            aria-disabled={editUnavailable || undefined}
            data-unavailable={editUnavailable || undefined}
            onClick={editUnavailable === true ? undefined : onEdit}
          >
            <IconEditOutlineRegular />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

/** Right-aligned durable user bubble with the official presentation. */
function UserBubble({
  node, renderMessageImages, openFile, openSkill, onEdit, editUnavailable, editTitle, chatT, t,
}: {
  node: ReferencedUserMessage
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  openFile: ChatNodeOwnerProps['openFile']
  openSkill: ChatNodeOwnerProps['openSkill']
  onEdit: () => void
  editUnavailable: boolean
  editTitle: string
  chatT: ChatTranslate
  t: (key: EditRegenKey, params?: Record<string, unknown>) => string
}): ReactNode {
  const { text, attachments, rest } = contentParts(node.content)
  const truncated = (total: number): string => chatT('json.truncated', { total })
  const compactImages = attachments.filter(a => a.type === 'image').length > 1
  const showBubble = text !== '' || rest.length > 0
  return (
    <div className={css.userRow} data-time-hover-root>
      <div className={css.userStack}>
        {attachments.length > 0 && (
          <div className={css.attachmentRow} data-message-attachments>
            {attachments.map((attachment, index) => attachment.type === 'image'
              ? (
                <Fragment key={`image:${index}`}>
                  {typeof renderMessageImages === 'function'
                    ? renderMessageImages({
                      images: [attachment.image],
                      align: 'end',
                      compact: compactImages,
                    })
                    // The shell no longer passes the rendering closure (it moved
                    // image presentation to its own slot). Render the reference
                    // as a plain chip instead of throwing: an attachment row is
                    // not worth losing the edit entry over.
                    : (
                      <span className={css.fileCard} title={imageNameOf(attachment.image)}>
                        <span className={css.fileContent}>
                          <span className={css.fileName}>{imageNameOf(attachment.image)}</span>
                        </span>
                      </span>
                    )}
                </Fragment>
              )
              : (
                <span key={`file:${index}`} className={css.fileCard} title={attachment.file.name}>
                  <FileTypeIcon path={attachment.file.name} className={css.fileIcon} />
                  <span className={css.fileContent}>
                    <span className={css.fileName}>{attachment.file.name}</span>
                    <span className={css.fileMeta}>
                      {[fileExtension(attachment.file.name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.bytes)]
                        .filter(Boolean).join(' ')}
                    </span>
                  </span>
                </span>
              ))}
          </div>
        )}
        {showBubble && <div className={css.bubble}>
          {projectUserText(text)}
          {rest.map((block, i) => <JsonBlock key={i} label={chatT('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
        </div>}
        {node.referenceLabels !== undefined && node.referenceLabels.length > 0 && (
          <div className={css.referenceSummary}>
            {chatT('message.referenceSummary', { labels: node.referenceLabels.join(chatT('message.referenceSeparator')) })}
          </div>
        )}
      </div>
      <MessageActions
        text={text}
        time={node.time}
        onEdit={onEdit}
        editUnavailable={editUnavailable}
        editTitle={editTitle}
        chatT={chatT}
        t={t}
      />
    </div>
  )
}

/** One draft attachment row in the editor's managed strip. */
interface EditorDraft {
  readonly key: string
  readonly kind: 'image' | 'file'
  readonly file: File
  readonly previewUrl: string | undefined
}

/** The kept image's authorized thumb: resolved once through the owner loader. */
function KeptImageThumb({
  image, loadImage,
}: {
  image: ImageAttachmentRef
  loadImage: ChatNodeOwnerProps['loadImage']
}): ReactNode {
  const [url, setUrl] = useState<string | undefined>(undefined)
  const requested = useRef(false)
  useEffect(() => {
    if (requested.current) return
    requested.current = true
    // A shell whose owner props no longer carry the loader would otherwise
    // throw here and take the whole editor (and the edit entry) down with it.
    if (typeof loadImage !== 'function') return
    void loadImage(image).then(setUrl, () => { setUrl(undefined) })
  }, [image, loadImage])
  return url === undefined
    ? <div className={css.editImageThumb} aria-hidden />
    : <img className={css.editImageThumb} src={url} alt="" />
}

/**
 * The inline editor: the bubble swaps for an auto-sized textarea above a
 * managed attachment strip — every original image and file stays removable,
 * picked or dropped files append as drafts, and confirm hands the surviving
 * set to the rewrite orchestration. Failure keeps the editor open with the
 * reason; success unmounts with the session switch.
 */
function UserMessageEditor({
  sessionId, node, loadImage, rewriteFrom, onCancel, chatT, t,
}: {
  sessionId: string
  node: ReferencedUserMessage
  loadImage: ChatNodeOwnerProps['loadImage']
  rewriteFrom: EditActionsInjected['rewriteFrom']
  onCancel: () => void
  chatT: ChatTranslate
  t: (key: EditRegenKey, params?: Record<string, unknown>) => string
}): ReactNode {
  const parts = useMemo(() => contentParts(node.content), [node.content])
  const [draft, setDraft] = useState(parts.text)
  const [images, setImages] = useState<readonly ImageAttachmentRef[]>(
    () => parts.attachments.flatMap((a) => a.type === 'image' && 'attachment' in a.image ? [a.image.attachment] : []),
  )
  const [files, setFiles] = useState<readonly FileAttachmentRef[]>(
    () => parts.attachments.filter((a): a is Extract<PresentedAttachment, { type: 'file' }> => a.type === 'file')
      .map(a => a.file),
  )
  const [drafts, setDrafts] = useState<readonly EditorDraft[]>([])
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  // Draft object URLs die with the editor, whether the user cancels, the
  // submit succeeds, or the tree unmounts underneath.
  const draftsRef = useRef<readonly EditorDraft[]>([])
  draftsRef.current = drafts
  useEffect(() => () => {
    for (const draft of draftsRef.current) {
      if (draft.previewUrl !== undefined) URL.revokeObjectURL(draft.previewUrl)
    }
  }, [])
  // Focus with the caret at the end on open: the common edit touches the tail.
  useEffect(() => {
    const el = editorRef.current
    if (el === null) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [])

  const addFiles = (incoming: readonly File[]): void => {
    if (incoming.length === 0) return
    const stamp = String(Date.now())
    setDrafts(current => [...current, ...incoming.map((file, index) => ({
      key: `${stamp}-${String(index)}-${file.name}`,
      kind: file.type.startsWith('image/') ? 'image' as const : 'file' as const,
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }))])
  }
  const onPickFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const picked = [...event.target.files ?? []]
    event.target.value = ''
    addFiles(picked)
  }
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    const dropped = [...event.dataTransfer.files]
    if (dropped.length === 0) return
    event.preventDefault()
    addFiles(dropped)
  }
  const onDragOver = (event: DragEvent<HTMLElement>): void => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  }
  const removeDraft = (key: string): void => {
    setDrafts(current => current.filter((item) => {
      if (item.key !== key) return true
      if (item.previewUrl !== undefined) URL.revokeObjectURL(item.previewUrl)
      return false
    }))
  }

  const rows = Math.min(12, Math.max(2, draft.split('\n').length))
  const empty = draft.trim() === '' && images.length === 0 && files.length === 0 && drafts.length === 0
  const confirm = (): void => {
    if (pending || empty) return
    setPending(true)
    setFailure(null)
    const draftImageFiles: DraftFile[] = drafts
      .filter(item => item.kind === 'image')
      .map(item => ({ file: item.file }))
    const draftOtherFiles: DraftFile[] = drafts
      .filter(item => item.kind === 'file')
      .map(item => ({ file: item.file }))
    rewriteFrom(sessionId, node.seq, draft, images, files, draftImageFiles, draftOtherFiles)
      .then(() => {
        // Success flips the view to the forked child; this subtree unmounts.
      })
      .catch((error: unknown) => {
        setPending(false)
        setFailure(error instanceof Error ? error.message : String(error))
      })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape' && !pending) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      confirm()
    }
  }
  const draftImageList = drafts.filter(d => d.kind === 'image')
  const draftFileList = drafts.filter(d => d.kind === 'file')
  return (
    <div className={css.editStack} onDrop={onDrop} onDragOver={onDragOver}>
      {(images.length > 0 || draftImageList.length > 0) && (
        <div className={css.editImageStrip}>
          {images.map(image => (
            <div key={String(image.attachmentId)} className={css.editImageChip}>
              <KeptImageThumb image={image} loadImage={loadImage} />
              <button
                type="button"
                className={css.editImageRemove}
                aria-label={t('edit.image.remove')}
                disabled={pending}
                onClick={() => { setImages(current => current.filter(item => item !== image)) }}
              >
                <IconCloseOutlineRegular />
              </button>
            </div>
          ))}
          {draftImageList.map(draft => (
            <div key={draft.key} className={css.editImageChip}>
              {draft.previewUrl === undefined
                ? <div className={css.editImageThumb} aria-hidden />
                : <img className={css.editImageThumb} src={draft.previewUrl} alt="" />}
              <button
                type="button"
                className={css.editImageRemove}
                aria-label={t('edit.image.remove')}
                disabled={pending}
                onClick={() => { removeDraft(draft.key) }}
              >
                <IconCloseOutlineRegular />
              </button>
            </div>
          ))}
        </div>
      )}
      {(files.length > 0 || draftFileList.length > 0) && (
        <div className={css.editFileStack}>
          {files.map(file => (
            <span key={String(file.attachmentId)} className={css.editFileChip}>
              <FileTypeIcon path={file.name} className={css.editFileIcon} />
              <span className={css.editFileName} title={file.name}>{file.name}</span>
              <span className={css.editFileMeta}>{fileSizeText(file.bytes)}</span>
              <button
                type="button"
                className={css.editRemoveInline}
                aria-label={t('edit.file.remove')}
                disabled={pending}
                onClick={() => { setFiles(current => current.filter(item => item !== file)) }}
              >
                <IconCloseOutlineRegular />
              </button>
            </span>
          ))}
          {draftFileList.map(draft => (
            <span key={draft.key} className={css.editFileChip}>
              <FileTypeIcon path={draft.file.name} className={css.editFileIcon} />
              <span className={css.editFileName} title={draft.file.name}>{draft.file.name}</span>
              <span className={css.editFileMeta}>{fileSizeText(draft.file.size)}</span>
              <button
                type="button"
                className={css.editRemoveInline}
                aria-label={t('edit.file.remove')}
                disabled={pending}
                onClick={() => { removeDraft(draft.key) }}
              >
                <IconCloseOutlineRegular />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={editorRef}
        className={css.editArea}
        rows={rows}
        value={draft}
        aria-label={t('edit.action')}
        disabled={pending}
        onChange={(event) => { setDraft(event.target.value) }}
        onKeyDown={onKeyDown}
      />
      {parts.rest.map((block, i) => (
        <JsonBlock
          key={i}
          label={chatT('message.extraBlock')}
          payload={block}
          truncatedLabel={total => chatT('json.truncated', { total })}
        />
      ))}
      <div className={css.editHint}>{t('edit.hint')}</div>
      {failure !== null && <div className={css.editFailure} role="alert">{t('edit.failed', { reason: failure })}</div>}
      <div className={css.editActions}>
        <label className={css.editAdd} aria-label={t('edit.file.add')} title={t('edit.file.add')}>
          <span className={css.editAddIcon} aria-hidden>＋</span>
          <input
            type="file"
            multiple
            className={css.editInput}
            disabled={pending}
            onChange={onPickFiles}
          />
        </label>
        <button type="button" className={css.editCancel} disabled={pending} onClick={onCancel}>
          {t('edit.cancel')}
        </button>
        <button
          type="button"
          className={css.editConfirm}
          disabled={pending || empty}
          onClick={confirm}
        >
          {t('edit.save')}
        </button>
      </div>
    </div>
  )
}

/** Injected face of the shadowed renderer, threaded by apply(). */
export interface UserViewInjected extends EditActionsInjected {
  /** The official chat dictionary's translate seat (bubble chrome copy). */
  readonly chatT: ChatTranslate
}

/** Full props of the shadowed durable user-message renderer. The locale seat is
  this plugin's dictionary; the official chat copy rides the injected chatT. */
export type UserMessageNodeViewProps =
  PropsRuntime<'conversation.chat.node', 'user'>
  & PropsLocale<'editregen'>
  & InjectFace<UserViewInjected>

/**
 * The keyed user-message renderer: official bubble presentation, the icon
 * actions row with one added 编辑 entry, and the inline editor swap.
 * @param props - composed slot props.
 * @returns the message row.
 */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, renderMessageImages, openFile, openSkill, loadImage, useSession, sessionId, rewriteFrom, chatT, t,
}: UserMessageNodeViewProps): ReactNode {
  const session = useSession(snapshot => snapshot)
  const editingUnavailable = session.running || session.subagent !== null
  const [editing, setEditing] = useState(false)
  return editing
    ? (
      <div className={css.userRow} data-time-hover-root>
        <UserMessageEditor
          sessionId={sessionId}
          node={node.data}
          loadImage={loadImage}
          rewriteFrom={rewriteFrom}
          onCancel={() => { setEditing(false) }}
          chatT={chatT}
          t={t}
        />
      </div>
    )
    : (
      <UserBubble
        node={node.data}
        renderMessageImages={renderMessageImages}
        openFile={openFile}
        openSkill={openSkill}
        onEdit={() => { setEditing(true) }}
        editUnavailable={editingUnavailable}
        editTitle={session.running ? t('edit.unavailable.running') : t('edit.unavailable.subagent')}
        chatT={chatT}
        t={t}
      />
    )
})
