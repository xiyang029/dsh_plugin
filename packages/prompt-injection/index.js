/**
 * `dsh-plugin-prompt-injection` 的 Host 半边。
 *
 * 注入一段系统提示词，其文本由用户在侧边栏编辑。文本持久化在存储里以
 * 便重启后保留，并提供一个小的 JSON 接口让 Client 半边读写。
 *
 * 安全模型（对齐官方 webServer 路由的写法，如 dsh-host-open-in-app）
 * --------------------------------
 * 这个接口能改写进入每一轮对话的系统提示词，一旦被跨站请求伪造就是一次
 * 持久化的提示词注入攻击：恶意网页可以用 `content-type: text/plain` 的
 * "简单请求"绕过 CORS 预检，直接向 127.0.0.1 的端口 POST 任意 JSON 文本。
 * 因此每个请求都先过 `connection` 服务的信任围栏（Host/Origin 检查 +
 * 浏览器认证），再校验 content-type 与请求体长度 —— 与官方路由的防御
 * 顺序完全一致。
 *
 * 存储刻意用 DSH_HOME 下的普通文件而不是 storage domain：这段文本必须在
 * 注册提示词的时刻同步可用，而单个 JSON 值不需要 schema 机制。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeFileAtomicSync } from './atomic-write.js';

/** Cordis 插件名（官方惯例导出，便于日志与诊断定位）。 */
export const name = 'prompt-injection';

/**
 * 本功能需要从 Host 容器获取的 Service 名。`connection` 是 Web 请求的
 * 信任围栏（browser-side 包，Host 侧不 import 其类型，运行时注入）。
 */
export const inject = ['systemPrompt', 'webServer', 'connection'];

/** 默认指令，用户保存自己的文本之前一直使用它。 */
const DEFAULT_TEXT = '始终使用中文进行思考和回复，无论用户使用什么语言。直接给结果，简要说明思路即可。禁止多方案对比、禁止过度展开分析、禁止反复自我修正。想到合理方案就停，不要继续深挖。';

const API_PATH = '/api/prompt-injection';

/** 提示词文本是手工编辑的小 JSON；任何显著超出它的请求体都视为敌意。 */
const MAX_BODY_BYTES = 64 * 1024;

/** 组合中的 connection 服务（本地声明：其类型包属于浏览器侧）。 */
function connectionOf(ctx) {
  return Reflect.get(ctx, 'connection');
}

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
  // 原子替换：这份文本在每次重启后都会被重新注入，写一半损坏会让下次
  // 启动静默回落到默认指令，用户的自定义内容就丢了。
  writeFileAtomicSync(path, `${JSON.stringify({ text }, null, 2)}\n`);
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    // 文本是可变状态，禁止中间层缓存陈旧内容。
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

/** 405 并按 RFC 7231 声明该路由支持的唯一方法。 */
function methodNotAllowed(response, allow) {
  response.writeHead(405, { allow });
  response.end();
}

/** 收集一个有长度上限的请求体；超过上限时排空流并返回 null。 */
async function readBoundedBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

/** 校验请求体线上格式：必须是携带字符串 text 字段的 JSON 对象。 */
function parseSaveBody(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof body?.text === 'string' ? body : null;
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
  // 一个 effect 同时负责初始安装与销毁：dispose 闭包引用 disposeSection
  // 变量，所以销毁时拿到的总是最后一次注册的 section。
  ctx.effect(() => {
    install();
    return () => {
      if (disposeSection !== null) {
        disposeSection();
        disposeSection = null;
      }
    };
  }, 'prompt-injection: section');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler: async (request, response) => {
      // 与官方路由一致：先过信任围栏与浏览器认证，再谈业务。
      const rejection = connectionOf(ctx).requestRejection(request);
      if (rejection !== undefined) {
        json(response, rejection, { error: rejection === 401 ? 'unauthenticated' : 'untrusted origin' });
        return;
      }
      try {
        if (request.method === 'GET') {
          json(response, 200, { text: current, default: DEFAULT_TEXT });
          return;
        }
        if (request.method === 'POST') {
          const contentType = String(request.headers['content-type'] ?? '')
            .split(';', 1)[0]?.trim().toLowerCase();
          if (contentType !== 'application/json') {
            json(response, 415, { error: 'content-type must be application/json' });
            return;
          }
          const raw = await readBoundedBody(request);
          if (raw === null) {
            json(response, 400, { error: 'request body too large' });
            return;
          }
          const body = parseSaveBody(raw);
          if (body === null) {
            json(response, 400, { error: 'invalid JSON body' });
            return;
          }
          // 磁盘是权威：写成功才更新内存态，失败时内存保持旧文本，
          // 不会出现"接口报 500 但内存已换新文本"的分裂状态。
          try {
            writeStored(root, body.text);
          } catch (error) {
            json(response, 500, { error: error instanceof Error ? error.message : String(error) });
            return;
          }
          current = body.text;
          install();
          json(response, 200, { text: current });
          return;
        }
        methodNotAllowed(response, 'GET, POST');
      } catch (error) {
        json(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    },
  }), 'prompt-injection: api route');
}
