import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { SessionId } from "@deepseek-ai/dsh-session";
import { AttachmentError } from "@deepseek-ai/dsh-attachment";
//#region ../.build/tsc/index.js
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
var __addDisposableResource = function(env, value, async) {
	if (value !== null && value !== void 0) {
		if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
		var dispose, inner;
		if (async) {
			if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
			dispose = value[Symbol.asyncDispose];
		}
		if (dispose === void 0) {
			if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
			dispose = value[Symbol.dispose];
			if (async) inner = dispose;
		}
		if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
		if (inner) dispose = function() {
			try {
				inner.call(this);
			} catch (e) {
				return Promise.reject(e);
			}
		};
		env.stack.push({
			value,
			dispose,
			async
		});
	} else if (async) env.stack.push({ async: true });
	return value;
};
var __disposeResources = (function(SuppressedError) {
	return function(env) {
		function fail(e) {
			env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
			env.hasError = true;
		}
		var r, s = 0;
		function next() {
			while (r = env.stack.pop()) try {
				if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
				if (r.dispose) {
					var result = r.dispose.call(r.value);
					if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) {
						fail(e);
						return next();
					});
				} else s |= 1;
			} catch (e) {
				fail(e);
			}
			if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
			if (env.hasError) throw env.error;
		}
		return next();
	};
})(typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
	var e = new Error(message);
	return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
/** 单次读回的最大字节数（base64 会再放大 4/3）。 */
const MAX_READ_BYTES = 128 * 1024 * 1024;
let EditRegen = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _readFileAttachment_decorators;
	let _rewriteBoundary_decorators;
	let _discardSession_decorators;
	return class EditRegen extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_readFileAttachment_decorators = [Remote("readFileAttachment")];
			_rewriteBoundary_decorators = [Remote("rewriteBoundary")];
			_discardSession_decorators = [Remote("discardSession")];
			__esDecorate(this, null, _readFileAttachment_decorators, {
				kind: "method",
				name: "readFileAttachment",
				static: false,
				private: false,
				access: {
					has: (obj) => "readFileAttachment" in obj,
					get: (obj) => obj.readFileAttachment
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _rewriteBoundary_decorators, {
				kind: "method",
				name: "rewriteBoundary",
				static: false,
				private: false,
				access: {
					has: (obj) => "rewriteBoundary" in obj,
					get: (obj) => obj.rewriteBoundary
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _discardSession_decorators, {
				kind: "method",
				name: "discardSession",
				static: false,
				private: false,
				access: {
					has: (obj) => "discardSession" in obj,
					get: (obj) => obj.discardSession
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		/** 读文件必须拿到附件服务；否则本插件激活前就把 `this.ctx.attachments` 读穿。 */
		static inject = ["attachments"];
		/** @param ctx - 携带会话、附件与可选清理存储的宿主上下文。 */
		constructor(ctx) {
			super(ctx, "editRegen");
			__runInitializers(this, _instanceExtraInitializers);
		}
		/**
		* 读回一个文件附件的原始字节，用会话自己的事件日志做授权。
		* @param request - 会话与附件标识。
		* @returns 存储时的显示名与 base64 字节。
		*/
		async readFileAttachment(request) {
			const ref = referencedFile(await this.sessionEvents(request.sessionId), request.attachmentId);
			if (ref === void 0) throw new RemoteError("session/attachment-invalid", "File is not referenced by this session.", { reason: "ATTACHMENT_NOT_REFERENCED" });
			if (ref.bytes > MAX_READ_BYTES) throw new RemoteError("session/attachment-invalid", `File exceeds the read-back size limit (${String(MAX_READ_BYTES)} bytes).`, { reason: "ATTACHMENT_TOO_LARGE" });
			try {
				const chunks = [];
				let total = 0;
				for await (const chunk of this.ctx.attachments.readFileStream(ref)) {
					chunks.push(chunk);
					total += chunk.byteLength;
				}
				const bytes = new Uint8Array(total);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
				return {
					name: ref.name,
					data: Buffer.from(bytes).toString("base64")
				};
			} catch (error) {
				if (error instanceof AttachmentError) throw new RemoteError("session/attachment-invalid", error.message, { reason: error.code });
				throw new RemoteError("gateway/internal", "Unable to read file attachment.", {});
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
		async rewriteBoundary(request) {
			const events = await this.sessionEvents(request.sessionId);
			let lastTurnEnd;
			for (const event of events) {
				if (event.seq >= request.seq) break;
				if (event.type === "turn/end") lastTurnEnd = event.seq;
			}
			return { atSeq: lastTurnEnd ?? null };
		}
		/**
		* 持久删除一个会话：日志产物、投影缓存行、工作区分账。运行中的 Agent 拒绝；已打开
		* 但空闲的 Agent 走注册表的内部 detach 摘除；运行时存储不支持删除时返回稳定错误码，
		* 前端据此降级。
		* @param request - 要从存储里移除的会话。
		*/
		async discardSession(request) {
			const sessionId = request.sessionId;
			const agents = this.ctx.get("agents");
			if ((agents?.get(sessionId))?.status === "running") throw new RemoteError("edit-regen/session-busy", `session "${sessionId}" is running; stop its conversation before deleting`, {
				sessionId,
				reason: "running"
			});
			if (agents?.get(sessionId) !== void 0 && !detachIdleAgent(this.ctx, sessionId)) throw new RemoteError("edit-regen/session-busy", `session "${sessionId}" is still open; close its conversation before deleting`, {
				sessionId,
				reason: "open"
			});
			const persistence = this.ctx.get("sessionPersistence");
			if (persistence?.remove === void 0) throw new RemoteError("edit-regen/remove-unavailable", `this deployment's session storage does not support deletion`, {
				sessionId,
				reason: "storage without deletion support"
			});
			if (!await persistence.remove(sessionId)) throw new RemoteError("edit-regen/session-not-found", `session "${sessionId}" not found`, { sessionId });
			await this.ctx.get("sessionProjectionCache")?.forget?.(sessionId);
			await this.ctx.get("workspaceRegistry")?.forgetSession?.(sessionId);
			this.ctx.emit("api-session/removed", SessionId(sessionId));
		}
		/**
		* 取指定会话的事件：已挂载 Agent 用它的快照，否则走一次冷查询（不修复、不恢复、
		* 不发布）。
		*
		* 一律走 `ctx.get(...)` 软取，不用 `this.ctx.sessions`：属性访问是按 fiber 注入检查
		* 过的，本插件只 inject 了 `attachments`，读别的服务会直接抛
		* "cannot get property … without inject"（网关把这条当 gateway/internal 抛给前端）。
		*/
		async sessionEvents(sessionId) {
			const env_1 = {
				stack: [],
				error: void 0,
				hasError: false
			};
			try {
				const id = SessionId(sessionId);
				const attached = this.ctx.get("sessions")?.get(id);
				if (attached !== void 0) return attached.snapshotEvents();
				const query = this.ctx.get("sessionQuery");
				if (query === void 0) throw new RemoteError("gateway/internal", `session "${sessionId}" cannot be inspected: no session query service`, { sessionId });
				return [...__addDisposableResource(env_1, await query.observeSession(id, { projectionMode: "none" }), false).events];
			} catch (e_1) {
				env_1.error = e_1;
				env_1.hasError = true;
			} finally {
				__disposeResources(env_1);
			}
		}
	};
})();
/**
* 通过注册表的内部 detach 摘除一个空闲 Agent。
* @param ctx - 携带 agents 服务的宿主上下文。
* @param sessionId - 要摘除的 Agent / 会话 id。
* @returns 是否真的摘除了注册表条目。
*/
function detachIdleAgent(ctx, sessionId) {
	const registry = ctx.get("agents");
	const entry = registry?.store?.get(sessionId);
	if (entry === void 0 || typeof registry?.detachEntered !== "function") return false;
	try {
		registry.detachEntered(entry);
		return true;
	} catch {
		return false;
	}
}
/**
* 在会话事件里找第一条 attachment id 命中的 `file` 内容块（与官方图片扫描同构）。
* @param events - 授权用的事件序列。
* @param attachmentId - 请求的附件 id。
* @returns 存储引用；未被引用时 undefined。
*/
function referencedFile(events, attachmentId) {
	for (const event of events) {
		const found = fileInEvent(event, (ref) => String(ref.attachmentId) === attachmentId);
		if (found !== void 0) return found;
	}
}
function fileInEvent(event, match) {
	const data = event.data;
	switch (event.type) {
		case "user/message":
		case "tool/ptc-dispatch": return fileBlockIn(data.content, match);
		case "system/message":
		case "developer/message":
		case "tool/result":
		case "team/message/queued": return fileBlockIn(data.message?.content, match);
		case "agent/inbox/spliced": {
			const messages = data.inserted;
			if (!Array.isArray(messages)) return void 0;
			for (const message of messages) {
				if (typeof message !== "object" || message === null || Array.isArray(message)) continue;
				const found = fileBlockIn(message.content, match);
				if (found !== void 0) return found;
			}
			return;
		}
		default: return;
	}
}
function fileBlockIn(content, match) {
	if (!Array.isArray(content)) return void 0;
	for (const value of content) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const block = value;
		if (block.type === "file" && typeof block.attachment === "object" && block.attachment !== null) {
			const ref = block.attachment;
			if (match(ref)) return ref;
		}
	}
}
//#endregion
export { EditRegen as default };
