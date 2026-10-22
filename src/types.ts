/** 编辑重发宿主动作的线上请求与返回值类型。 */

/** 读回一个「被本会话引用」的文件附件的请求。 */
export interface ReadFileAttachmentRequest {
  /** 文件必须被这个会话引用（授权范围）。 */
  readonly sessionId: string
  /** 该会话日志里出现过的、不透明的持久附件 id。 */
  readonly attachmentId: string
}

/** 一次授权读取的返回值：显示名 + base64 字节。 */
export interface ReadFileAttachmentValue {
  /** 存储时的显示名。 */
  readonly name: string
  /** 原始字节，base64。 */
  readonly data: string
}

/** 求「排除某条消息所在轮次」的分叉边界。 */
export interface RewriteBoundaryRequest {
  /** 用它的日志位置定切点。 */
  readonly sessionId: string
  /** 改写锚定的 `user/message` 事件 seq。 */
  readonly seq: number
}

/** 边界查询的返回值：前缀的含端边界。 */
export interface RewriteBoundaryValue {
  /**
   * 分叉用的 seq（前缀保留到「前一个轮次自己的 turn/end」为止，不含这条消息所在的
   * 轮次）；null 表示这条消息之前没有已完成的轮次——也就是它本来就是第一条消息，
   * 调用方必须**干净新建**会话，不能在前置事件里分叉（那里有 queue 模式的
   * `agent/inbox/spliced`，搬进子会话会导致下一轮重发一遍）。
   */
  readonly atSeq: number | null
}

/** 删除一个会话持久外壳（日志、缓存行、工作区分账）的请求。 */
export interface DiscardSessionRequest {
  /** 要从存储中移除的会话。 */
  readonly sessionId: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** 待删除的会话仍在宿主注册表里活着。 */
    'edit-regen/session-busy': { readonly sessionId: string; readonly reason: string }
    /** 待删除的会话在存储里不存在。 */
    'edit-regen/session-not-found': { readonly sessionId: string }
    /** 本次部署的会话存储没有实现删除。 */
    'edit-regen/remove-unavailable': { readonly sessionId: string; readonly reason: string }
  }
}
