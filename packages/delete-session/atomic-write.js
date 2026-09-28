/**
 * 本包私有的零依赖原子写：先写同目录临时文件，再 rename 覆盖目标。
 *
 * 直接 `writeFileSync` 目标文件的话，进程在写一半时崩溃（或断电）会留下被
 * 截断的 JSON —— workspace.json 损坏会丢掉所有工作区的会话注册。而
 * 「写临时文件 + rename」在文件系统层面是单个原子操作：目标文件要么是
 * 完整的旧内容，要么是完整的新内容，不存在中间形态。
 *
 * 刻意保持零依赖：本包作为 Host 插件运行在 profile 的插件目录里，模块
 * 解析够不到宿主 app 的 node_modules，所以官方的 `dsh-atomic-write` 包
 * 无法 import；这里用 node:fs 内置调用实现同一语义（rename 在 Windows
 * 上经 MOVEFILE_REPLACE_EXISTING 可覆盖已存在的目标）。
 */
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * 原子地把 `data` 写入 `path`（覆盖）。失败时清理临时文件并抛出，
 * 由调用方决定是忽略（尽力而为路径）还是报错（HTTP 路径）。
 */
export function writeFileAtomicSync(path, data) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, data, 'utf8');
    renameSync(tmp, path);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* 临时文件本来就不存在 */ }
    throw error;
  }
}
