/**
 * Host half of the `delete-session` feature, shipped inside the aggregate
 * bundle `dsh-plugin-pack`.
 *
 * Registers a `/delete-session` command that permanently removes one session's
 * artifact directory. The runtime exposes no session-delete API (session
 * persistence is append-only and only supports archive), so this removes the
 * directory by hand. The Client half confirms with the user before it executes.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Service names this feature needs from the Host container. */
export const inject = ['commands'];

/**
 * Drop one session id from every workspace registration.
 *
 * The sidebar renders sessions from the workspace registry's `sessionIds`, not
 * from a directory scan, so deleting the artifact directory alone leaves a
 * ghost row: the id is still listed even though nothing backs it. This is the
 * missing half of a permanent delete.
 *
 * Best effort by design: a missing or unreadable registry is not a reason to
 * refuse the delete, so every failure path just stops editing.
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
 * Drop one session's projection-cache row, if any.
 *
 * `storages/session_projcache/sessions/<id>.json` is derived state the Host
 * rebuilds from the session log, but it is never swept when the log
 * disappears: a stale row keeps the deleted session's metadata alive on disk
 * (title, timestamps) and can resurface it in cached-list paths. Deleting the
 * log is therefore only half of the cleanup.
 *
 * Best effort by design: a missing or unreadable cache row is not a reason to
 * refuse the delete, so every failure path just stops editing.
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
 * Locate one session's artifact directory without assuming its project key.
 *
 * The JSONL layout is `<root>/<projectKey>/<encodedId>/…` where the project
 * key is a lossy encoding of the session's `cwd`. Only the id encodes back
 * deterministically, so the project level must be scanned.
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
 * Remove one session's artifacts and its workspace registration. Irreversible.
 *
 * The artifacts go FIRST: a registry row without artifacts is a harmless
 * pending-write shape the Host reconciles, while a deleted registry row with
 * artifacts still on disk is the ghost that leaves storage orphaned from the
 * sidebar. If the directory delete fails (a locked log on Windows, say) the
 * registration stays untouched and the caller sees the error.
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
  // Unregister even when the directory is already gone: the ghost row in the
  // sidebar comes from the registry, not from the filesystem.
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
      // Always announce: an unregistered-but-listed session is exactly the
      // ghost row the sidebar must drop.
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
