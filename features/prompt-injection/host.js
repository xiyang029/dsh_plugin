/**
 * 聚合 bundle `dsh-plugin-pack` 中「提示词注入」功能的 Host 半边。
 *
 * 注入一段系统提示词，其文本由用户在侧边栏编辑。文本持久化在存储里以
 * 便重启后保留，并提供一个小的 JSON 接口让 Client 半边读写。
 *
 * 存储刻意用 DSH_HOME 下的普通文件而不是 storage domain：这段文本必须在
 * 注册提示词的时刻同步可用，而单个 JSON 值不需要 schema 机制。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 本功能需要从 Host 容器获取的 Service 名。 */
export const inject = ['systemPrompt', 'webServer'];

/** 默认指令，用户保存自己的文本之前一直使用它。 */
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

  // 用恢复出来的（或默认的）文本注册 section。每次保存都重新创建注册，
  // 让新文本无需重载即生效。
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
      // 排在部署人格之前，让这段指令先被读到。
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
