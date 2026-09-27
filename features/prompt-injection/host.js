/**
 * Host half of the `prompt-injection` feature, shipped inside the aggregate
 * bundle `dsh-plugin-pack`.
 *
 * Injects one system-prompt section whose text the user edits from the
 * sidebar. The text is persisted in a storage domain so it survives restarts,
 * and a small JSON API lets the Client half read and write it.
 *
 * Storage is deliberately a plain file under DSH_HOME rather than a domain:
 * the section must be available synchronously at prompt-registration time, and
 * a single JSON value needs no schema machinery.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Service names this feature needs from the Host container. */
export const inject = ['systemPrompt', 'webServer'];

/** The default instruction, used until the user saves something else. */
const DEFAULT_TEXT = '始终使用中文进行思考和回复，无论用户使用什么语言。直接给结果，简要说明思路即可。禁止多方案对比、禁止过度展开分析、禁止反复自我修正。想到合理方案就停，不要继续深挖。';

const API_PATH = '/api/prompt-injection';

function storePath(root) {
  return join(root, 'prompt-injection.json');
}

function readStored(root) {
  const path = storePath(root);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed?.text === 'string') return parsed.text;
    return null;
  } catch {
    return null;
  }
}

function writeStored(root, text) {
  const path = storePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ text }, null, 2)}\n`, 'utf8');
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

export function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME ?? '';
  const root = typeof config.dataRoot === 'string' && config.dataRoot !== ''
    ? config.dataRoot
    : join(home, 'prompt-injection');

  let current = readStored(root) ?? DEFAULT_TEXT;

  // Register the section with the restored (or default) text. Registration is
  // re-created on every save so the new text takes effect without a reload.
  let disposeSection = null;
  const install = () => {
    if (disposeSection !== null) {
      disposeSection();
      disposeSection = null;
    }
    const text = current.trim();
    if (text === '') return;
    disposeSection = ctx.systemPrompt.section({
      name: 'prompt-injection',
      // Before the deployment persona so the instruction is read first.
      order: -90,
      text,
    });
  };
  ctx.effect(() => install(), 'prompt-injection: section');
  ctx.effect(() => () => {
    if (disposeSection !== null) disposeSection();
  }, 'prompt-injection: section teardown');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler: async (request, response) => {
      try {
        if (request.method === 'GET') {
          json(response, 200, { text: current, default: DEFAULT_TEXT });
          return;
        }
        if (request.method === 'POST') {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const raw = Buffer.concat(chunks).toString('utf8');
          let text = current;
          try {
            const parsed = JSON.parse(raw);
            if (typeof parsed?.text === 'string') text = parsed.text;
          } catch {
            json(response, 400, { error: 'invalid JSON body' });
            return;
          }
          current = text;
          try {
            writeStored(root, text);
          } catch (error) {
            json(response, 500, { error: error instanceof Error ? error.message : String(error) });
            return;
          }
          install();
          json(response, 200, { text: current });
          return;
        }
        json(response, 405, { error: 'method not allowed' });
      } catch (error) {
        json(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    },
  }), 'prompt-injection: api route');
}
