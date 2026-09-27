/**
 * 聚合 bundle `dsh-plugin-pack` 中「删除会话」功能的 Host 半边。
 *
 * 注册 `/delete-session` 命令，永久删除一个会话的工件目录。运行时没有暴露
 * 会话删除 API（会话持久化是 append-only 的，只支持归档），所以这里手动
 * 删除目录。Client 半边会在执行前向用户二次确认。
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 本功能需要从 Host 容器获取的 Service 名。 */
export const inject = ['commands'];

/**
 * 从每一个工作区注册里删掉一个会话 id。
 *
 * 侧边栏渲染会话列表靠的是工作区注册表的 `sessionIds`，而不是目录扫描，
 * 所以只删工件目录会留下幽灵行：id 还列在那里，背后却什么都没有。这是
 * 「永久删除」缺失的另一半。
 *
 * 设计上尽力而为：注册表缺失或读不了不是拒绝删除的理由，所以每条失败
 * 路径都只是停止编辑。
 */
function unregisterFromWorkspaces(home, sessionId) {
  const path = join(home, 'storages', 'workspace.json');
  if (!existsSync(path)) return;
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return;
  }
  const tables = data?.tables?.workspaces;
  if (typeof tables !== 'object' || tables === null) return;
  let changed = false;
  for (const record of Object.values(tables)) {
    if (!Array.isArray(record?.sessionIds)) continue;
    const next = record.sessionIds.filter((id) => id !== sessionId);
    if (next.length === record.sessionIds.length) continue;
    record.sessionIds = next;
    changed = true;
  }
  const archived = data?.global?.archivedSessionIds;
  if (Array.isArray(archived)) {
    const nextArchived = archived.filter((id) => id !== sessionId);
    if (nextArchived.length !== archived.length) {
      data.global.archivedSessionIds = nextArchived;
      changed = true;
    }
  }
  if (!changed) return;
  try {
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

/**
 * 删除一个会话的投影缓存行（如果存在）。
 *
 * `storages/session_projcache/sessions/<id>.json` 是 Host 从会话日志重建的
 * 派生状态，但日志消失时它从不被清扫：残留的行让被删会话的元数据（标题、
 * 时间戳）继续活在磁盘上，并可能在缓存列表路径里重新冒出来。所以只删
 * 日志只是清理的一半。
 *
 * 设计上尽力而为：缓存行缺失或读不了不是拒绝删除的理由，所以每条失败
 * 路径都只是停止编辑。
 */
function forgetProjectionCache(home, sessionId) {
  const path = join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`);
  try {
    rmSync(path, { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * 在不预设 project key 的前提下定位一个会话的工件目录。
 *
 * JSONL 的目录布局是 `<root>/<projectKey>/<encodedId>/…`，其中 project key
 * 是会话 `cwd` 的有损编码。只有 id 能确定性地反推回来，所以必须扫描
 * project 这一层。
 */
function findSessionDir(root, sessionId) {
  if (!existsSync(root)) return undefined;
  const projects = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name));
  for (const project of projects) {
    const direct = join(project, sessionId);
    if (existsSync(direct)) return direct;
  }
  return undefined;
}

/**
 * 删除一个会话的工件和它的工作区注册。不可逆。
 *
 * 工件先删：没有工件的注册表行是宿主会自行调和的无害 pending-write 形态，
 * 而注册表行已删、工件还在盘上才是让存储与侧边栏脱节的幽灵。如果目录
 * 删除失败（比如 Windows 上日志文件被锁），注册表保持原样，调用方看到错误。
 */
function deleteSession(root, home, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.startsWith('session-')) {
    return { ok: false, error: 'refusing to delete a non-session id' };
  }
  const dir = findSessionDir(root, sessionId);
  if (dir !== undefined) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  // 即使目录早已不在也要注销注册：侧边栏的幽灵行来自注册表，
  // 而不是文件系统。
  unregisterFromWorkspaces(home, sessionId);
  forgetProjectionCache(home, sessionId);
  return { ok: true, removed: dir !== undefined };
}

export function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME ?? '';
  const root = typeof config.sessionsRoot === 'string' && config.sessionsRoot !== ''
    ? config.sessionsRoot
    : join(home, 'sessions');

  ctx.effect(() => ctx.commands.register({
    name: 'delete-session',
    description: 'Permanently delete one session and its stored log',
    recordInput: false,
    handler: ({ rawInput }) => {
      const sessionId = typeof rawInput === 'string' ? rawInput.trim() : '';
      const result = deleteSession(root, home, sessionId);
      if (!result.ok) return { kind: 'error', text: `Delete failed: ${result.error}` };
      // 必须总是广播：已注销但仍列在列表里的会话正是侧边栏要丢掉的幽灵行。
      ctx.emit('api-session/removed', sessionId);
      return {
        kind: 'success',
        text: result.removed
          ? `Deleted session ${sessionId}.`
          : `Session ${sessionId} had no stored log.`,
      };
    },
  }), 'delete-session: command');
}
