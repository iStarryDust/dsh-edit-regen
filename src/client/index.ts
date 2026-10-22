/**
 * 编辑重发的浏览器半端：一个「遮蔽」的 `user` 消息渲染器，在官方的气泡与图标动作
 * 之上加一个「编辑」，点开变成内联编辑器；确认后从那条消息所在的轮次分叉会话、
 * 把留下的图片与文件重新落到子会话、发送改写后的内容，然后切到子会话。
 *
 * 这个包自己挂载自己的 Remote 命名空间（`remote.editRegen`），不依赖任何 Agent
 * 管理套件：宿主半端在 `src/index.ts`，线上清单是预生成的 `src/typert/host.js`
 * 与 `src/typert/remote.js`。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 类型面：把本程序消费的那些客户端服务声明合并拉进来。
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
// 预生成的 Remote 贡献（含 zod schema），构建时整块内联进 client bundle。
import editRegenRemote from '../../vendor/typert/remote.js'
import { UserMessageNodeView } from './EditRegenView.tsx'
import type { UserViewInjected } from './EditRegenView.tsx'
import { createEditActions } from './actions.ts'
import { en, zh, type EditRegenKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 内联编辑器与它的动作。 */
    editregen: EditRegenKey
  }
}

/** 本插件独占的词典命名空间。 */
const NS = 'editregen'

/** 比 ui-chat 自己的注册（默认 0）更低：数值最低者渲染。 */
const USER_SHADOW_PRIORITY = -20

/** 需要的服务（cordis fiber inject）。 */
export const inject = [
  'slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'remote',
]

/**
 * 挂载编辑重发表面。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-edit-regen: dictionaries')

  // 本包自己的 Remote 命名空间：挂载在原上下文上，随插件 fiber 一起卸载。
  // 结算 Promise 交给动作层，任何读取都不会抢在 $mount 落定之前。
  const whenRemoteReady = ctx.remote.$mount(editRegenRemote)
    .then(() => undefined, () => undefined)

  // 服务在这里一次性取好（此时 fiber 的注入仍在位）：闭包若在调用时再读 ctx，
  // 重装后会因为注入已撤销而抛 "without inject"。
  const actions = createEditActions({
    ctx,
    sessions: ctx.sessions,
    workspaces: ctx.workspaces,
    uiWorkspace: ctx.uiWorkspace,
    remote: ctx.remote,
  }, whenRemoteReady)

  // 官方 chat 词典负责气泡里共用的那部分文案（时间模板、JSON 块、引用摘要）；
  // 本包词典只覆盖编辑器与它的动作。
  const chatT = ctx.locale.bind('chat')

  // 官方契约：复用 `user` 这个 key 就是替换该节点的渲染器。遮蔽版自带官方的气泡
  // 呈现再加一个编辑入口，官方以后改其它 key 依然生效。
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'user',
    priority: USER_SHADOW_PRIORITY,
    locale: NS,
    inject: (_sessionId: SessionId): UserViewInjected => ({ rewriteFrom: actions.rewriteFrom, chatT })
  }, UserMessageNodeView))
}
