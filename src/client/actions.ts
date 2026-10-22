/**
 * 内联编辑器背后的改写编排：一次调用就完成「在锚定消息的轮次边界分叉会话 → 把留下
 * 的附件重新落到**子会话**（文件走 editRegen 的授权读取 + 官方上传通道换取新收据）→
 * 继承模型选择 → 发送改写后的内容 → 最后才切换视图」。发送被拒绝时丢弃刚分叉的空壳，
 * 因此一次失败的编辑不留痕迹，源对话也没有被动过。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ImageAttachmentRef, FileAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// 类型面：把 ui-workspace 服务声明合并（deps.uiWorkspace）拉进来。
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** 编辑重发流程自有的子会话引用。 */
    editRegen: unknown
  }
}

import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** 编辑重发的会话动作，即宿主 `editRegen` 命名空间暴露的那三个。 */
type EditVerbs = {
  readFileAttachment(request: { sessionId: string; attachmentId: string }): Promise<RemoteResult<{ name: string; data: string }>>
  rewriteBoundary(request: { sessionId: string; seq: number }): Promise<RemoteResult<{ atSeq: number | null }>>
  discardSession(request: { sessionId: string }): Promise<RemoteResult<void>>
}

/** 本流程重新落盘文件所用的官方上传面。 */
type FileUploadsRemote = {
  upload(sessionId: SessionId, request: { data: string; name?: string }, signal?: AbortSignal): Promise<RemoteResult<{ receiptId: PromptContentPart extends { type: 'file'; receiptId: infer R } ? R : never; file: { attachmentId: string; name: string; bytes: number } }>>
}

/** 一条等待上传的浏览器侧草稿文件。 */
export interface DraftFile {
  readonly file: File
}

/** 注入给被遮蔽的用户消息渲染器的能力。 */
export interface EditActionsInjected {
  /** 从一条持久用户消息开始重写会话。 */
  rewriteFrom: (
    sessionId: string,
    seq: number,
    text: string,
    keptImages: readonly ImageAttachmentRef[],
    keptFiles: readonly FileAttachmentRef[],
    draftImages: readonly DraftFile[],
    draftFiles: readonly DraftFile[],
  ) => Promise<void>
}

/** 单个草稿文件的大小上限（字节）。 */
const MAX_DRAFT_BYTES = 128 * 1024 * 1024

const IMAGE_MEDIA_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** 在 apply 时一次性取好的服务。重装可能在 setup 与用户第一次确认之间撤销 fiber 的
 * 注入，此时在调用时读 `ctx.sessions` 的闭包会以 "without inject" 崩掉；提前捕获
 * 就与这个生命周期无关了。Remote 命名空间同样通过捕获的上下文软取。 */
export interface EditServices {
  readonly ctx: ClientContext
  readonly sessions: ClientContext['sessions']
  readonly workspaces: ClientContext['workspaces']
  readonly uiWorkspace: ClientContext['uiWorkspace']
  /** 活的 remote 服务：之后挂载的命名空间会出现在这个对象上。 */
  readonly remote: ClientContext['remote']
}

/**
 * 在 apply 时取好的服务之上构造改写动作。
 * @param deps - apply 时的服务引用。Remote 命名空间**不**从 `deps.remote` 上读属性：
 * 那是 fiber 注入检查过的，脱离事件续体调用会抛 "without inject"，所以一律在调用时
 * 用 `deps.ctx.get` 软取。
 * @param whenRemoteReady - 本包自己的 `editRegen` 命名空间挂载结算。
 * @returns 交给被遮蔽渲染器的那一份注入面。
 */
export function createEditActions(
  deps: EditServices,
  whenRemoteReady: Promise<void>,
): EditActionsInjected {
  const editRegen = (): EditVerbs | undefined =>
    deps.ctx.get('remote.editRegen') as EditVerbs | undefined
  const fileUploads = (): FileUploadsRemote | undefined =>
    deps.ctx.get('remote.fileUploads') as FileUploadsRemote | undefined

  const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = ''
    const chunk = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
    }
    return btoa(binary)
  }

  const fileBytes = async (file: File): Promise<Uint8Array> =>
    new Uint8Array(await file.arrayBuffer())

  const uploadDraftFile = async (childId: SessionId, file: File): Promise<PromptContentPart> => {
    if (file.size > MAX_DRAFT_BYTES) throw new Error(`"${file.name}" exceeds the upload size limit`)
    const upload = fileUploads()
    if (upload === undefined) throw new Error('file attachments cannot be resent: the upload channel is unavailable')
    const staged = await upload.upload(childId, {
      data: bytesToBase64(await fileBytes(file)),
      ...(file.name === '' ? {} : { name: file.name }),
    })
    if (!staged.ok) throw new Error(staged.error.message)
    return { type: 'file', receiptId: staged.value.receiptId }
  }

  /** 一个会话所在的工作区，供空白会话复用路径使用。 */
  const workspaceOf = (sessionId: SessionId): WorkspaceId | undefined => {
    const items = deps.workspaces.list.getSnapshot().items
    return items.find(item => (item.sessionIds as readonly string[]).includes(sessionId as string))?.workspaceId
  }

  /** 把源会话的持久模型选择带到子会话。 */
  const modelCarryOver = async (sessionId: SessionId, childId: SessionId): Promise<void> => {
    try {
      const face = deps.sessions.binding(sessionId)?.session
      const projection = face?.projections.faceOf('modelSelection').getSnapshot() as
        | { next?: { provider: string; model: string; reasoningEffort?: string } | null; lastUsed?: { provider: string; model: string; reasoningEffort?: string } | null }
        | undefined
      const selection = projection?.next ?? projection?.lastUsed
      if (selection === undefined || selection === null) return
      const sessionRemote = deps.ctx.get('remote.session') as
        | { selectModel(request: { sessionId: SessionId; provider: string; model: string; reasoningEffort?: string }): Promise<RemoteResult<void>> }
        | undefined
      if (sessionRemote === undefined) return
      const selected = await sessionRemote.selectModel({
        sessionId: childId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      })
      if (!selected.ok) throw new Error(selected.error.message)
    } catch (reason) {
      console.warn('edit-regen: model carry-over failed:', reason)
    }
  }

  /** 子会话里发送被拒后的尽力清理。 */
  const discardShell = async (childId: SessionId): Promise<void> => {
    try {
      await whenRemoteReady
      const remote = editRegen()
      if (remote === undefined) {
        console.warn('edit-regen: the empty child session is kept (no editRegen remote)')
        return
      }
      const discarded = await remote.discardSession({ sessionId: childId as string })
      if (!discarded.ok) console.warn('edit-regen: shell cleanup refused:', discarded.error.message)
    } catch (reason) {
      console.warn('edit-regen: shell cleanup failed:', reason)
    }
  }

  const rewriteFrom = async (
    sessionId: string,
    seq: number,
    text: string,
    keptImages: readonly ImageAttachmentRef[],
    keptFiles: readonly FileAttachmentRef[],
    draftImages: readonly DraftFile[],
    draftFiles: readonly DraftFile[],
  ): Promise<void> => {
    await whenRemoteReady
    const face = deps.sessions.binding(sessionId as SessionId)?.session
    if (face === undefined) throw new Error(`session "${sessionId}" is not locally addressable`)
    const snapshot = face.getSnapshot()
    if (snapshot.running) throw new Error('the agent is running')

    // 留下的图片按官方提示路径重新落盘：留存的走会话授权读取，新挑的重新编码浏览器
    // 文件，子会话随后由普通 prompt 通道存自己的持久副本。
    const keptImageParts = await Promise.all(keptImages.map(async (ref): Promise<PromptContentPart> => {
      const result = await face.readAttachment(ref.attachmentId)
      if (!result.ok) throw new Error(result.error.message)
      return {
        type: 'image',
        mediaType: result.value.attachment.mediaType,
        data: bytesToBase64(result.value.data),
      }
    }))
    const draftImageParts = await Promise.all(draftImages.map(async (draft): Promise<PromptContentPart> => {
      if (draft.file.size > MAX_DRAFT_BYTES) throw new Error(`"${draft.file.name}" exceeds the upload size limit`)
      const mediaType = IMAGE_MEDIA_TYPES.includes(draft.file.type)
        ? draft.file.type as ImageMediaType
        : 'image/png' as ImageMediaType
      return {
        type: 'image',
        mediaType,
        data: bytesToBase64(await fileBytes(draft.file)),
        ...(draft.file.name === '' ? {} : { name: draft.file.name }),
      }
    }))

    // 先建子会话：文件收据是按会话签发的，必须在子会话上换。切点来自宿主的边界查询
    // （它的日志才是权威）；消息之前没有内容时，复用或新建工作区的空白会话。
    const remote = editRegen()
    if (remote === undefined) throw new Error('the editRegen remote is unavailable')
    const boundary = await remote.rewriteBoundary({ sessionId, seq })
    if (!boundary.ok) throw new Error(boundary.error.message)
    let childId: SessionId
    let forked: boolean
    if (boundary.value.atSeq === null) {
      const create: { workspaceId?: WorkspaceId } = {}
      const workspaceId = workspaceOf(sessionId as SessionId)
      if (workspaceId !== undefined) create.workspaceId = workspaceId
      childId = await deps.sessions.create(create)
      forked = false
    } else {
      childId = await deps.sessions.fork({ sessionId: sessionId as SessionId, atSeq: boundary.value.atSeq, increaseTitle: true })
      forked = true
    }

    // 留下的文件从存储经 editRegen 的读取重新落盘（在子会话上拿新收据）；草稿直接从
    // 浏览器上传。
    const fileParts: PromptContentPart[] = []
    if (keptFiles.length > 0) {
      const upload = fileUploads()
      if (upload === undefined) throw new Error('file attachments cannot be resent: the upload channel is unavailable')
      for (const ref of keptFiles) {
        const read = await remote.readFileAttachment({ sessionId, attachmentId: String(ref.attachmentId) })
        if (!read.ok) throw new Error(read.error.message)
        const staged = await upload.upload(childId, { data: read.value.data, name: read.value.name })
        if (!staged.ok) throw new Error(staged.error.message)
        fileParts.push({ type: 'file', receiptId: staged.value.receiptId })
      }
    }
    for (const draft of draftFiles) {
      fileParts.push(await uploadDraftFile(childId, draft.file))
    }

    await modelCarryOver(sessionId as SessionId, childId)

    // 分叉出来的子会话只是进了目录、没有被持有：自己持一个引用才能寻址，视图切走
    // 之后立刻释放（主视图会重新持有）。
    const reference = deps.sessions.retain(childId, { source: 'editRegen' })
    try {
      const child = reference.binding.session
      const parts: PromptContentPart[] = [{ type: 'text', text }, ...keptImageParts, ...draftImageParts, ...fileParts]
      let prompt: RemoteResult<{ accepted: true }>
      try {
        prompt = await child.prompt(parts, 'queue')
      } catch (reason) {
        // 传输层失败等价于被拒绝：分叉出来的壳一起丢掉，编辑器停在源消息上。
        if (forked) await discardShell(childId)
        throw reason
      }
      if (!prompt.ok) {
        // 只有分叉路径才拥有它刚建的子会话（首轮连接也可能复用了已有的空白会话），
        // 所以只丢这一个壳：被拒绝的编辑不留痕迹，源对话从未移动。
        if (forked) await discardShell(childId)
        throw new Error(prompt.error.message)
      }
      deps.uiWorkspace.openSession(childId)
    } finally {
      reference.release()
    }
  }

  return { rewriteFrom }
}
