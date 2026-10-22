/**
 * tsdown 入口：构建器（build.mjs）每个目标调用一次，用环境变量选择要产出哪一半。
 * 这里不做任何包特定的事，标识、入口、输出目录全部来自环境，避免出现第二份会漂移的
 * 构建配置。
 *
 * 环境：
 * - `EDITREGEN_TARGET` `host` | `typert` | `client`（默认 `host`）
 * - `EDITREGEN_ENTRY`  该目标的入口，绝对路径
 * - `EDITREGEN_OUT`    输出目录，绝对路径（默认包内 `lib`）
 * - `EDITREGEN_FILE`   `typert` 目标的输出文件名（默认 `typert.host.js`）
 * - `EDITREGEN_HASH_BASE` 可选，CSS 类名哈希的命名空间前缀
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientConfig } from './client.mjs'
import { bundleConfig, hostConfig } from './host.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'))
const id = manifest.name
const target = process.env.EDITREGEN_TARGET ?? 'host'
const outDir = process.env.EDITREGEN_OUT ?? 'lib'
const entry = process.env.EDITREGEN_ENTRY
if (entry === undefined) throw new Error('build: EDITREGEN_ENTRY is required')

export default () => {
  switch (target) {
    case 'host':
      // 宿主半端从 tsc 的产物打包，绝不直接吃 TypeScript 源码：rolldown 不认识这些
      // 插件用的标准装饰器（`@Remote(…)`），直接喂 TS 会把 `@Remote` 原样留在产物里。
      return [hostConfig({ id, pkgDir: projectRoot, entry, outDir })]
    case 'typert':
      // 预生成的 typert 清单要变成自足文件：typert loader 在宿主启动时直接 import 它，
      // 那里没有 node_modules 可依赖，所以连 zod 一起打包进去。
      return [bundleConfig({
        id,
        entry,
        outDir,
        fileName: process.env.EDITREGEN_FILE ?? 'typert.host.js',
      })]
    case 'remote':
      // 同一份清单的浏览器面：包里的客户端已经内联过它，这里再发一份自足文件，
      // 供 `exports["./remote"]` 被外部解析时也能直接 import。
      return [bundleConfig({
        id,
        entry,
        outDir,
        fileName: process.env.EDITREGEN_FILE ?? 'typert.remote-client.js',
      })]
    case 'client':
      return [clientConfig({
        id,
        pkgDir: projectRoot,
        entry,
        hashBase: process.env.EDITREGEN_HASH_BASE,
        outDir,
      })]
    default:
      throw new Error(`build: unknown target "${target}"`)
  }
}
