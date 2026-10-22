# dsh-edit-regen

DeepSeek Harness 的**编辑重发**插件：用户消息气泡上多一个「编辑」，改完从那条消息重新生成；
保留的图片与文件随行重传，新会话继承原会话的模型选择。

一个包，两半：

| 半端 | 文件 | 作用 |
|---|---|---|
| 宿主 | `lib/index.js` | 注册 `editRegen` 会话动作：授权读回文件字节、定位分叉边界、清理空壳会话 |
| 浏览器 | `lib/client.js` | 遮蔽官方 `user` 消息渲染器，加「编辑」入口与内联编辑器；自己把 `remote.editRegen` 挂到共享 `remote` 服务上 |

**不依赖任何 Agent 管理能力**：Remote 命名空间由本插件自己的浏览器半端 `$mount`，
所以单独装它就能用。

## 安装

**项目根目录本身就是可安装的包**（`lib/` 就在根上），所以两种装法都可以：

```bash
# 直接装目录（开发时最省事，link 过去的改动重启即生效）
dsh plugin --profile <名字> add E:/Plugin/发布版/dsh-edit-regen

# 或者打成 tarball 装（发布/给别人的形态）
pnpm pack
dsh plugin --profile <名字> add ./istarry-dsh-edit-regen-0.1.0.tgz
```

装完**重启 dsh 宿主进程**并刷新页面——客户端 bundle 在启动时组合。

要求 DeepSeek Harness `0.1.7-rc.2` / `0.2.x`（宿主半端只依赖 `@deepseek-ai/dsh-typert-protocol`、
`dsh-session`、`dsh-attachment`，全部作为可选 peer，实例一律来自 dsh 安装本身，不在插件里复制）。

## 用起来是什么样

1. 鼠标移到自己的某条消息上，气泡下面多一个铅笔图标；
2. 点开变成内联编辑器：原文已在里面，光标在末尾，`⌘/Ctrl+Enter` 确认、`Esc` 取消；
3. 上方的图片缩略图与文件卡片可以逐个移除，`＋` 或拖拽可以补充新文件；
4. 确认后：会话在**这条消息所在的轮次之前**分叉 → 留下的附件在子会话里重新落盘 →
   模型选择继承过来 → 发送改写后的内容 → 视图切到子会话。

原对话不会被动过，那条消息之后的内容也不会保留（这就是「重发」的语义）。

## 实现要点（改代码前必读）

### 分叉切点（改这里之前先读完）

`rewriteBoundary` 只有一个合法切点：**前一个轮次自己的 `turn/end`**。

- 不能在「下一个 `turn/start` 减一」处切；
- 也不能在「`seq` 减一」处切；
- 这条消息之前**没有已完成的轮次**时（它本来就是第一条消息）**必须返回 `null`**，
  让客户端走「干净新建」。

原因：那条消息之前的空隙里不只有会话开场事件，还有用 queue 模式发消息时写下的
`agent/inbox/spliced`——它承载着源会话自己的待发消息。在空隙处分叉会把它们原样搬进
子会话的收件箱，子会话的下一轮再把它们当成注入的用户消息发一遍。

**症状：编辑第一条消息重新生成，会连着发两次。**

这个坑踩过两次：套件里 `agent-preset-authoring` 的那份 `rewriteBoundary` 早就改成
`lastTurnEnd ?? null` 了，而同一份代码在从未被挂载过的独立宿主包里还是老的
`openTurnStart - 1 / seq - 1` 兜底——独立插件直接复用了后者，于是修复丢了。
两处实现分叉是根因，**改语义时两处必须一起改**（本插件只有一处，别再分叉）。

### 附件为什么要重传

文件收据（`receiptId`）是**按会话签发**的，不能搬到子会话。所以：

- 留下的图片：走会话授权的 `readAttachment` 拿到字节，作为新的 image 内容块发出去；
- 留下的文件：宿主 `readFileAttachment` 读回原始字节（用会话事件日志做授权）→
  官方上传通道 `remote.fileUploads` 在**子会话**上换一张新收据；
- 新挑的附件：直接从浏览器上传。

### 发送被拒就丢壳

分叉出来的子会话只是进了目录、没有被持有。发送失败时会尽力 `discardSession` 清掉，
所以一次失败的编辑不留痕迹。**在会话存储不支持删除的运行时上**（比如 `0.1.7-rc.2` 的
`SessionPersistence` 就没有删除 API），这一步会返回 `edit-regen/remove-unavailable`，
前端降级为「留下一个空会话」——功能不受影响，只是多一条空对话。

### 宿主半端的服务一律用 `ctx.get` 软取

`this.ctx.sessions` 这种属性访问是按 fiber 注入检查过的：本插件只 inject 了
`attachments`，读别的服务会当场抛

```
cannot get property "sessions" without inject
```

而且它会被网关包成 `gateway/internal` 抛到前端，看起来像「远端挂了」。所以除了
`attachments` 之外一律 `this.ctx.get('sessions')` / `get('sessionQuery')` /
`get('sessionPersistence')` 软取。

### 别在宿主半端声明浏览器服务

客户端包（`dsh.client`）的宿主行**不许** inject `slots` / `locale` / `workspaces` /
`uiWorkspace` / `remote`——那些服务在浏览器平面上，宿主行永远等不到，插件页就会显示
「等待依赖」。本插件的宿主行只 inject `attachments`。

## 仓库结构

四层分开，别混：

```
dsh-edit-regen/
├── package.json           发布清单（dsh.bundle.patch + dsh.client 都在这里）
├── cordis.patch.yml       挂载补丁：一行 insert
├── icon.svg / locale/     插件页的图标与文案
│
├── src/                   ① 手写源码
│   ├── index.ts           宿主半端：editRegen 服务
│   ├── types.ts           线上请求/返回值类型
│   └── client/            浏览器半端：index / actions / EditRegenView / locales / css
│
├── vendor/typert/         ② 预生成的线上契约（host.js / remote.js，别手改）
│
├── build.mjs              ③ 构建
├── build/                 client / host / platform / tsdown 预设
├── tooling/               构建工具链（独立安装，见下）
│
└── lib/                   ④ 产物（git 不跟踪，构建生成；这个包的运行时入口）
```

`lib/` 是**产物**：`.gitignore` 里已经排除，仓库里不留；但本地必须有它才能跑
（`main`、`exports`、`dsh.client` 都指向它）。随时可用 `npm run clean` 删掉、
`node build.mjs` 重建。

**不要另建 `dist/`**：`main`、`exports`、`dsh.client` 全部按「包根 = 本目录」写的。
以前产物放在 `dist/` 时，`dsh plugin add <项目根>` 会把一个没有 `lib/` 的 package 装进去——
插件页显示「已安装」，两半却都加载不到，气泡上自然没有编辑按钮。

## 构建

```bash
cd tooling && pnpm install     # 首次
cd .. && node build.mjs        # 全量：tsc → 三个 tsdown 目标 → 校验 → 写 lib/
node build.mjs --check         # 只构建 + 校验，不写 lib/
node build.mjs --staging       # 产物留在 .build/out，不动 lib/
npm run clean                  # 删掉 lib/ 与 .build/（回到纯源码状态）
```

构建做了四件事，顺序不能变：

1. **tsc 预编译宿主**：`src/index.ts` 用了标准装饰器（`@Remote(…)`）和 `using`，rolldown
   只认 legacy 装饰器，直接喂 TS 会把 `@Remote` 原样留在产物里——Node 解析不了。
2. **`lib/index.js`**：从 tsc 产物打包，清单里声明过的 peer 留成 `import`，其余内联。
3. **`lib/typert.host.js` / `lib/typert.remote-client.js`**：把预生成的清单打成**自足**
   文件（连 zod 一起内联）。typert loader 在宿主启动时直接 `import()` 它，那里没有
   node_modules 可依赖。
4. **`lib/client.js`**：CJS 工厂壳 + lightningcss 编译的 CSS Modules，只把模块表里的
   名字留成 `require()`。

校验闸（`build.mjs` 的 `validate()`）：产物语法（`node --check`）、宿主只 import
已声明的包、浏览器只 `require` 平台模块表里的名字。这三种故障都只在部署后暴露。

### typert 清单是预生成文件

`vendor/typert/host.js` / `remote.js` 由 `@deepseek-ai/dsh-typert-generator` 从宿主源码生成，
里面硬编码了包名与三个方法名。**改了 `editRegen` 的方法签名或增减方法，必须重新生成**，
否则启动时报：

```
typert-loader: TYPERT manifest names package ... must be owned by the package that exports it
```

或者网关按旧 schema 校验参数、把新参数判成 `gateway/argument-invalid`。

### 工具链单独装在 `tooling/`

`package.json` 是要发出去的清单，里面不能出现 `workspace:` / `file:` 之外的构建依赖；
所以 tsdown / typescript / lightningcss / zod / `@types/*` 单独装在 `tooling/`。
`build.mjs` 每次会把 `zod`、`@types/*` junction 到 `node_modules/`（rolldown 要从导入方
所在目录解析 `zod`，编辑器的 `@types` 也需要）——junction 指向**物理**目录，指向 pnpm
的符号链接在 Windows 上解析不到东西。

## 排错

| 现象 | 看哪里 |
|---|---|
| 插件页显示「已安装」，气泡上却没有铅笔 | 先确认 `node_modules/@istarry/dsh-edit-regen/lib/index.js` 真的存在——装成了没有 `lib/` 的目录就是这样：两半都加载不到，但插件页不报错 |
| 插件页显示「等待依赖」 | 宿主行 inject 了浏览器服务，或者 `attachments` 服务没起 |
| 页面空白 / 插件不出现 | `node build.mjs --check` 看产物；浏览器控制台里 `web boot: … did not activate` 才是真因 |
| 气泡上没有铅笔图标 | 会话在运行中或是子智能体会话（两者都禁用编辑）；或官方改了 `conversation.chat.node` 的注册契约 |
| 点了「重新生成」报 `editRegen remote is unavailable` | 浏览器半端没有挂上命名空间：确认 `lib/typert.remote-client.js` 存在，且 `dsh.client` 行是「运行中」 |
| 点了「重新生成」报 `cannot get property … without inject` | 宿主半端直接读了 `ctx.<服务>`，改成 `ctx.get('<服务>')` |
| 重发报 `attachment-invalid` | 那条消息里的文件不再被该会话引用，或超过 128MB 读回上限 |
| 报 `edit-regen/remove-unavailable` | 运行时存储不支持删除会话（0.1.7 就是），属预期降级 |

## 许可

MIT，见 [LICENSE](LICENSE)。
