/**
 * 编辑重发的宿主半端：把「改一条用户消息、从那条消息重新生成」需要的三个会话动作
 * 做成自己的 `editRegen` Remote 命名空间，不依赖任何 Agent 管理能力。
 *
 * 三个动作：
 * 1. `readFileAttachment` —— 会话授权后读回一个文件的原始字节（重发时要给子会话重新
 *    落盘，收据是按会话签发的，不能直接搬运旧收据）；
 * 2. `rewriteBoundary` —— 定位分叉点。切点只取「前一个轮次自己的 turn/end」，而不是
 *    「下一个 turn/start 减一」或「seq 减一」：那些间隙里有 queue 模式写下的
 *    `agent/inbox/spliced`（承载源会话自己的待发消息），在那儿分叉会让子会话的下一轮
 *    把它们当注入消息重发一遍——「第一条消息编辑重发连发两次」就是这么来的。所以这条
 *    消息之前没有已完成的轮次时返回 null，让客户端干净新建；
 * 3. `discardSession` —— 重发被拒绝时清掉刚分叉出来的空壳（日志、投影缓存、
 *    工作区分账）。运行中的会话拒绝删除；运行时不支持删除时给出稳定错误码，由前端
 *    降级为「留下一个空会话」。
 *
 * 客户端半端在 `client/`，通过 `remote.editRegen` 调用这里。
 *
 * @module @istarry/dsh-edit-regen
 */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError, Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
// 只为引入会话控制器的错误码与生命周期事件声明合并（类型面，产物里被擦除）。
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import type {
  DiscardSessionRequest, ReadFileAttachmentRequest, ReadFileAttachmentValue,
  RewriteBoundaryRequest, RewriteBoundaryValue,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 编辑重发的会话动作。 */
    editRegen: EditRegen
  }
}

/** 单次读回的最大字节数（base64 会再放大 4/3）。 */
const MAX_READ_BYTES = 128 * 1024 * 1024

/** 编辑重发的宿主动作。 */
export default class EditRegen extends TypertRemoteService {
  /** 读文件必须拿到附件服务；否则本插件激活前就把 `this.ctx.attachments` 读穿。 */
  static inject = ['attachments']

  /** @param ctx - 携带会话、附件与可选清理存储的宿主上下文。 */
  constructor(ctx: Context) {
    super(ctx, 'editRegen')
  }

  /**
   * 读回一个文件附件的原始字节，用会话自己的事件日志做授权。
   * @param request - 会话与附件标识。
   * @returns 存储时的显示名与 base64 字节。
   */
  @Remote('readFileAttachment')
  async readFileAttachment(request: ReadFileAttachmentRequest): Promise<ReadFileAttachmentValue> {
    const events = await this.sessionEvents(request.sessionId)
    const ref = referencedFile(events, request.attachmentId)
    if (ref === undefined) {
      throw new RemoteError(
        'session/attachment-invalid',
        'File is not referenced by this session.',
        { reason: 'ATTACHMENT_NOT_REFERENCED' },
      )
    }
    if (ref.bytes > MAX_READ_BYTES) {
      throw new RemoteError(
        'session/attachment-invalid',
        `File exceeds the read-back size limit (${String(MAX_READ_BYTES)} bytes).`,
        { reason: 'ATTACHMENT_TOO_LARGE' },
      )
    }
    try {
      const chunks: Uint8Array[] = []
      let total = 0
      for await (const chunk of this.ctx.attachments.readFileStream(ref)) {
        chunks.push(chunk)
        total += chunk.byteLength
      }
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return { name: ref.name, data: Buffer.from(bytes).toString('base64') }
    } catch (error) {
      if (error instanceof AttachmentError) {
        throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
      }
      throw new RemoteError('gateway/internal', 'Unable to read file attachment.', {})
    }
  }

  /**
   * 为一条持久 `user/message` 定位改写用的分叉边界。
   *
   * 切点只有一个含义：**前一个轮次自己的 `turn/end`**。绝不能在「下一个 turn/start
   * 减一」或「seq 减一」这类事件间隙里切：那条消息之前的空隙里既有会话开场事件，也有
   * 用 queue 模式发消息时写下的 `agent/inbox/spliced`——它们承载着源会话自己的待发
   * 消息。在空隙处分叉会把它们原样搬进子会话的收件箱，子会话的下一轮再把它们当成
   * 注入的用户消息重发一遍：**表现就是「第一条消息编辑重发会连发两次」**。
   *
   * 所以这条消息之前**没有已完成的轮次**时（也就是它本来就是第一条消息），一律返回
   * null，让调用方走「干净新建」的路径；预设、模型这类东西由客户端另行继承。
   * @param request - 会话与锚定消息的 seq。
   * @returns 前缀的含端边界；没有已完成的轮次时 null。
   */
  @Remote('rewriteBoundary')
  async rewriteBoundary(request: RewriteBoundaryRequest): Promise<RewriteBoundaryValue> {
    const events = await this.sessionEvents(request.sessionId)
    let lastTurnEnd: number | undefined
    for (const event of events) {
      if (event.seq >= request.seq) break
      if (event.type === 'turn/end') lastTurnEnd = event.seq
    }
    return { atSeq: lastTurnEnd ?? null }
  }

  /**
   * 持久删除一个会话：日志产物、投影缓存行、工作区分账。运行中的 Agent 拒绝；已打开
   * 但空闲的 Agent 走注册表的内部 detach 摘除；运行时存储不支持删除时返回稳定错误码，
   * 前端据此降级。
   * @param request - 要从存储里移除的会话。
   */
  @Remote('discardSession')
  async discardSession(request: DiscardSessionRequest): Promise<void> {
    const sessionId = request.sessionId
    const agents = this.ctx.get('agents') as
      | { get(id: string): { status: string } | undefined }
      | undefined
    const agent = agents?.get(sessionId)
    if (agent?.status === 'running') {
      throw new RemoteError('edit-regen/session-busy',
        `session "${sessionId}" is running; stop its conversation before deleting`,
        { sessionId, reason: 'running' })
    }
    if (agents?.get(sessionId) !== undefined && !detachIdleAgent(this.ctx, sessionId)) {
      throw new RemoteError('edit-regen/session-busy',
        `session "${sessionId}" is still open; close its conversation before deleting`,
        { sessionId, reason: 'open' })
    }
    const persistence = this.ctx.get('sessionPersistence') as
      | { remove?(id: string): Promise<boolean> }
      | undefined
    if (persistence?.remove === undefined) {
      throw new RemoteError('edit-regen/remove-unavailable',
        `this deployment's session storage does not support deletion`,
        { sessionId, reason: 'storage without deletion support' })
    }
    const removed = await persistence.remove(sessionId)
    if (!removed) {
      throw new RemoteError('edit-regen/session-not-found',
        `session "${sessionId}" not found`, { sessionId })
    }
    await (this.ctx.get('sessionProjectionCache') as
      | { forget?(id: string): Promise<void> }
      | undefined)?.forget?.(sessionId)
    await (this.ctx.get('workspaceRegistry') as
      | { forgetSession?(id: string): Promise<void> }
      | undefined)?.forgetSession?.(sessionId)
    this.ctx.emit('api-session/removed', SessionId(sessionId))
  }

  /**
   * 取指定会话的事件：已挂载 Agent 用它的快照，否则走一次冷查询（不修复、不恢复、
   * 不发布）。
   *
   * 一律走 `ctx.get(...)` 软取，不用 `this.ctx.sessions`：属性访问是按 fiber 注入检查
   * 过的，本插件只 inject 了 `attachments`，读别的服务会直接抛
   * "cannot get property … without inject"（网关把这条当 gateway/internal 抛给前端）。
   */
  private async sessionEvents(sessionId: string): Promise<readonly SessionEvent[]> {
    const id = SessionId(sessionId)
    const attached = (this.ctx.get('sessions') as
      | { get(id: SessionId): { snapshotEvents(): readonly SessionEvent[] } | undefined }
      | undefined)?.get(id)
    if (attached !== undefined) {
      // oxlint-disable-next-line typescript/no-deprecated -- 既有的会话历史读取；迁移延后。
      return attached.snapshotEvents()
    }
    const query = this.ctx.get('sessionQuery') as
      | { observeSession(id: SessionId, opts?: { projectionMode?: 'none'; signal?: AbortSignal }): Promise<SessionObservation> }
      | undefined
    if (query === undefined) {
      throw new RemoteError('gateway/internal',
        `session "${sessionId}" cannot be inspected: no session query service`, { sessionId })
    }
    using observation = await query.observeSession(id, { projectionMode: 'none' })
    return [...observation.events]
  }
}

/**
 * 通过注册表的内部 detach 摘除一个空闲 Agent。
 * @param ctx - 携带 agents 服务的宿主上下文。
 * @param sessionId - 要摘除的 Agent / 会话 id。
 * @returns 是否真的摘除了注册表条目。
 */
function detachIdleAgent(ctx: Context, sessionId: string): boolean {
  const registry = ctx.get('agents') as unknown as {
    store?: Map<string, unknown>
    detachEntered?: (entry: unknown) => void
  } | undefined
  const entry = registry?.store?.get(sessionId)
  if (entry === undefined || typeof registry?.detachEntered !== 'function') return false
  try {
    registry.detachEntered(entry)
    return true
  } catch {
    return false
  }
}

/**
 * 在会话事件里找第一条 attachment id 命中的 `file` 内容块（与官方图片扫描同构）。
 * @param events - 授权用的事件序列。
 * @param attachmentId - 请求的附件 id。
 * @returns 存储引用；未被引用时 undefined。
 */
function referencedFile(
  events: readonly SessionEvent[],
  attachmentId: string,
): FileAttachmentRef | undefined {
  for (const event of events) {
    const found = fileInEvent(event, ref => String(ref.attachmentId) === attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

function fileInEvent(
  event: SessionEvent,
  match: (ref: FileAttachmentRef) => boolean,
): FileAttachmentRef | undefined {
  const data = event.data as {
    readonly content?: unknown
    readonly message?: { readonly content?: unknown }
    readonly inserted?: unknown
  }
  const type: string = event.type
  switch (type) {
    case 'user/message':
    case 'tool/ptc-dispatch':
      return fileBlockIn(data.content, match)
    case 'system/message':
    case 'developer/message':
    case 'tool/result':
    case 'team/message/queued':
      return fileBlockIn(data.message?.content, match)
    case 'agent/inbox/spliced': {
      const messages = data.inserted
      if (!Array.isArray(messages)) return undefined
      for (const message of messages as readonly unknown[]) {
        if (typeof message !== 'object' || message === null || Array.isArray(message)) continue
        const found = fileBlockIn((message as { readonly content?: unknown }).content, match)
        if (found !== undefined) return found
      }
      return undefined
    }
    default:
      return undefined
  }
}

function fileBlockIn(
  content: unknown,
  match: (ref: FileAttachmentRef) => boolean,
): FileAttachmentRef | undefined {
  if (!Array.isArray(content)) return undefined
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { readonly type?: unknown; readonly attachment?: unknown }
    if (block.type === 'file' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as FileAttachmentRef
      if (match(ref)) return ref
    }
  }
  return undefined
}
