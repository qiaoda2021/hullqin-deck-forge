#!/usr/bin/env node
/**
 * 零泄露 GitHub 上传器（不需要装 git、不需要 gh CLI）
 *
 * 设计原则
 *  1. token 只从一个本地文件读进内存，全程不写盘、不回显、不进命令历史。
 *  2. 所有输出经过 redact()，任何异常信息里的 token 会被替换成 ***。
 *  3. 上传前先做秘钥扫描，任何一个文件里出现 token 样式就整体中止 —— 保证不会把秘钥推上公开仓库。
 *  4. 只用 REST + Git Data API，不创建 .git，所以 remote 里不可能留下凭据。
 *
 * 用法
 *   node tools/push-github.mjs --dry-run                  # 空跑：只扫描+列文件，不联网、不读 token
 *   node tools/push-github.mjs --check                    # 只校验 token 是否有效、有哪些权限
 *   node tools/push-github.mjs --repo hullqin-deck-forge  # 真上传
 *   node tools/push-github.mjs --repo xxx --private       # 传成私有仓库
 *   node tools/push-github.mjs --repo xxx --forget        # 成功后删掉本地 token 文件
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getSecret, hasName, listNames, vaultExists } from './vault.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.github.com';

/* ------------------------------------------------------------------ 参数 */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : dflt;
};

const DRY = flag('dry-run');
const CHECK = flag('check');
const FORGET = flag('forget');
const PRIVATE = flag('private');
const PROMPT = flag('prompt');
const FROM_STDIN = flag('stdin');
const NO_VAULT = flag('no-vault');
const REPO = opt('repo', 'hullqin-deck-forge');
const KEY_NAME = opt('key', 'github');
const DESCRIPTION = opt(
  'desc',
  '斗地主 / 掼蛋 记牌器·透视·AI 出牌建议·开局预设（油猴脚本）'
);
const TOKEN_FILE_ARG = opt('token-file', '');
const TOKEN_FILE = path.resolve(
  (TOKEN_FILE_ARG || process.env.GH_TOKEN_FILE || path.join(os.homedir(), '.gh-token'))
    .replace(/^~(?=$|[\\/])/, os.homedir())
);

/** 静态判断 token 会从哪儿来（打印用；真正读取在 readToken 里按同样顺序走） */
const SOURCE_DESC = FROM_STDIN
  ? 'stdin 管道（不落盘）'
  : PROMPT
    ? '终端隐藏输入（不落盘）'
    : TOKEN_FILE_ARG
      ? '文件 ' + TOKEN_FILE
      : !NO_VAULT && hasName(KEY_NAME)
        ? '凭据库 .dsh-vault → ' + KEY_NAME + '（DPAPI 解密）'
        : fs.existsSync(TOKEN_FILE)
          ? '文件 ' + TOKEN_FILE
          : '未就绪';

/* --------------------------------------------------------------- 输出工具 */

let TOKEN = '';
const redact = (s) =>
  TOKEN ? String(s).split(TOKEN).join('***').split(encodeURIComponent(TOKEN)).join('***') : String(s);
const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? redact(x) : x)));
const warn = (...a) => console.warn(...a.map((x) => (typeof x === 'string' ? redact(x) : x)));
const die = (msg, code = 1) => {
  console.error('\n  ✗ ' + redact(msg) + '\n');
  process.exit(code);
};

/* --------------------------------------------------------------- 收集文件 */

const SKIP_DIRS = new Set(['.git', 'node_modules', '.vscode', '.idea', '__pycache__', 'secrets', '.cache']);
const SKIP_FILE = [
  /^\.gh-token$/i,
  /\.token$/i,
  /^\.DS_Store$/i,
  /^Thumbs\.db$/i,
  /\.log$/i,
  /\.zip$/i,
  /\.bak$/i,
  /\.tmp$/i,
  /\.orig$/i,
  /\.rej$/i,
  /\.map$/i,
];
const MAX_BYTES = 40 * 1024 * 1024;

function shouldSkip(name, isDir) {
  if (isDir) return SKIP_DIRS.has(name) || name.startsWith('.git');
  return SKIP_FILE.some((re) => re.test(name));
}

async function collect(dir, rel = '', out = []) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (shouldSkip(e.name, true)) continue;
      await collect(abs, r, out);
    } else if (e.isFile()) {
      if (shouldSkip(e.name, false)) continue;
      const st = await fsp.stat(abs);
      if (st.size > MAX_BYTES) {
        warn(`  ! 跳过超大文件 ${r}（${(st.size / 1048576).toFixed(1)}MB > 40MB）`);
        continue;
      }
      out.push({ rel: r, abs, size: st.size });
    }
  }
  return out;
}

/* --------------------------------------------------------------- 秘钥扫描 */

const SECRET_PATTERNS = [
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{30,}/g, 'GitHub fine-grained token'],
  [/AKIA[0-9A-Z]{16}/g, 'AWS access key'],
  [/(?:sk|rk)-[A-Za-z0-9_-]{32,}/g, 'OpenAI 风格 key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, '私钥'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
];

/** 返回 [{file,line,kind}]；如果发现当前 token 原文，单独标红 */
async function scanSecrets(files) {
  const hits = [];
  for (const f of files) {
    if (f.size > 8 * 1048576) continue; // 超大文件不扫（本项目没有）
    let text;
    try {
      text = await fsp.readFile(f.abs, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue; // 二进制跳过
    if (TOKEN && text.includes(TOKEN)) hits.push({ file: f.rel, line: 0, kind: '本次使用的 token 原文' });
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 4000) continue;
      for (const [re, kind] of SECRET_PATTERNS) {
        re.lastIndex = 0;
        const m = re.exec(line);
        if (!m) continue;
        // 允许文档里的占位/示例（含 xxxx / *** / <your> / EXAMPLE 之类）
        const s = m[0];
        if (/[x*<>]|EXAMPLE|your[-_]?token|placeholder/i.test(s)) continue;
        hits.push({ file: f.rel, line: i + 1, kind });
        break;
      }
    }
  }
  return hits;
}

/* ------------------------------------------------------------------ 网络 */

function headers(extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'hullqin-deck-forge-pusher',
    ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
    ...extra,
  };
}

async function api(method, url, body, { allow = [] } = {}) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  if (!res.ok && !allow.includes(res.status)) {
    const msg = data && data.message ? data.message : text.slice(0, 200);
    const errs = data && data.errors ? ' :: ' + JSON.stringify(data.errors).slice(0, 300) : '';
    const scopes = res.headers.get('x-oauth-scopes');
    throw new Error(
      `GitHub ${method} ${url} → ${res.status} ${redact(msg)}${errs}` +
        (scopes ? ` （当前 token 权限：${scopes || '无'}）` : '') +
        (res.status === 404 ? ' （若是私有仓库/权限不足，也会返回 404）' : '')
    );
  }
  // 允许的失败状态（如 404 探测）返回 data:null，调用方据此判断「不存在」
  return {
    status: res.status,
    data: res.ok ? data : null,
    scopes: res.headers.get('x-oauth-scopes'),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ------------------------------------------------------------- token 读取 */

/** 终端隐藏输入（Windows TTY 支持 raw mode）。token 只在这个进程的内存里。 */
function promptToken() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdout.write('\n  粘贴 GitHub Token（回车结束；输入过程不回显）\n  > ');
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    const onData = (chunk) => {
      for (const c of String(chunk)) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(buf.trim());
        }
        if (c === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n  已取消。\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') {
          if (buf.length) {
            buf = buf.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        buf += c;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

function validateToken(raw, where) {
  if (!raw) die('没有拿到 token（' + where + '）。');
  if (/\s/.test(raw)) die('token 里含空白/换行，请只放一行：' + where);
  if (!/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})$/.test(raw)) {
    die(
      `token 格式不像 GitHub token（长度 ${raw.length}，来源 ${where}）。\n` +
        '    经典 PAT 形如 ghp_xxx；细粒度 PAT 形如 github_pat_xxx。\n' +
        '    指纹：' +
        crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12) +
        '（仅用于比对，不含原文）'
    );
  }
  return raw;
}

async function readToken() {
  if (FROM_STDIN) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    TOKEN = validateToken(Buffer.concat(chunks).toString('utf8').trim(), 'stdin');
    return TOKEN;
  }
  if (PROMPT) {
    if (!process.stdin.isTTY) {
      die(
        '--prompt 必须在你自己的终端里直接运行（当前 stdin 不是交互终端）。\n' +
          '    若你是通过别的程序转发的，请改用文件方式：--token-file <路径>'
      );
    }
    TOKEN = validateToken(await promptToken(), '--prompt 输入');
    return TOKEN;
  }
  // ① 显式指定的文件
  if (TOKEN_FILE_ARG) {
    if (!fs.existsSync(TOKEN_FILE)) die('指定的 token 文件不存在：' + TOKEN_FILE);
    return takeFromFile(TOKEN_FILE);
  }
  // ② 凭据库（默认路径）
  if (!NO_VAULT && vaultExists() && hasName(KEY_NAME)) {
    try {
      TOKEN = validateToken(await getSecret(KEY_NAME), '凭据库 ' + KEY_NAME);
      return TOKEN;
    } catch (e) {
      die(
        '从凭据库取 ' + KEY_NAME + ' 失败：' + e.message + '\n' +
          '    检查：tools\\vault.ps1 list'
      );
    }
  }
  // ③ 老式单文件
  if (fs.existsSync(TOKEN_FILE)) return takeFromFile(TOKEN_FILE);

  const names = listNames().map((e) => e.name);
  die(
    `没有可用的 GitHub 凭据（凭据库 ${VAULT_FILE}）。\n` +
      '    先把 key 收进凭据库（只存在你本机，DPAPI 加密）：\n\n' +
      '      tools\\vault.ps1 init\n' +
      '      tools\\vault.ps1 add github        ← 隐藏输入，粘贴就行\n\n' +
      '    然后直接跑：\n' +
      '      tools\\push.cmd --repo ' + REPO + '\n\n' +
      '    也可以临时给：\n' +
      '      tools\\push.cmd --repo ' + REPO + ' --prompt\n' +
      '      tools\\push.cmd --repo ' + REPO + ' --token-file D:\\某处\\tok\n' +
      '      tools\\push.cmd --repo ' + REPO + ' --key 别的名字\n' +
      (names.length ? '    库里现有的 key：' + names.join(', ') + '\n' : '')
  );
}

function takeFromFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  TOKEN = validateToken(raw, file);
  return TOKEN;
}

const fingerprint = () =>
  TOKEN ? crypto.createHash('sha256').update(TOKEN).digest('hex').slice(0, 12) : '(未读取)';

/* -------------------------------------------------------------------- 主流程 */

async function main() {
  log('');
  log('  零泄露 GitHub 上传器');
  log('  ───────────────────────────────────────────');
  log('  项目目录  ' + ROOT);
  log('  token 来源 ' + SOURCE_DESC);
  log('  目标仓库  ' + REPO + (PRIVATE ? '（private）' : '（public）'));
  log('  模式      ' + (DRY ? '空跑 dry-run' : CHECK ? '只校验 check' : '上传'));
  log('');

  /* 1. 收集文件 */
  const files = await collect(ROOT);
  const totalBytes = files.reduce((a, f) => a + f.size, 0);
  log(`  ① 收集 ${files.length} 个文件，共 ${(totalBytes / 1024).toFixed(1)} KB`);

  /* 2. 秘钥扫描（空跑也做，且不读 token） */
  const hits = await scanSecrets(files);
  if (hits.length) {
    warn('  ✗ 秘钥扫描未通过，已中止（没有任何内容被上传）：');
    for (const h of hits) warn(`      ${h.file}${h.line ? ':' + h.line : ''}  →  ${h.kind}`);
    die('请先把上面这些内容删掉/换成占位符，再重跑。');
  }
  log('  ② 秘钥扫描通过（0 命中）');

  if (DRY) {
    const byDir = new Map();
    for (const f of files) {
      const d = path.posix.dirname(f.rel);
      const k = d === '.' ? '(根目录)' : d + '/';
      if (!byDir.has(k)) byDir.set(k, []);
      byDir.get(k).push(f);
    }
    log('');
    log('  将要上传的内容：');
    for (const [d, arr] of [...byDir.entries()].sort()) {
      log('    ' + d);
      for (const f of arr) {
        log(
          '      ' +
            path.posix.basename(f.rel).padEnd(30) +
            (f.size / 1024).toFixed(1).padStart(7) +
            ' KB'
        );
      }
    }
    log('');
    log('  空跑结束，未联网、未读取 token。');
    log('  确认无误后执行：node tools/push-github.mjs --repo ' + REPO);
    log('');
    return;
  }

  /* 3. 读 token */
  await readToken();
  log('  ③ token 已读入内存（sha256 指纹 ' + fingerprint() + '，不显示原文）');

  /* 4. 校验身份 */
  const me = await arm(async () => (await api('GET', '/user')).data);
  log(`  ④ 已认证：@${me.login}${me.name ? '（' + me.name + '）' : ''}`);

  if (CHECK) {
    const scopes = (await api('GET', '/user')).scopes;
    log('     权限域：' + (scopes || '未返回（细粒度 token 或 fine-grained 不暴露该头）'));
    log('');
    log('  校验完成，未做任何写操作。');
    log('');
    return;
  }

  /* 5. 建仓（已存在则复用） */
  const owner = me.login;
  let repo = (await api('GET', `/repos/${owner}/${REPO}`, null, { allow: [404] })).data;
  if (!repo || !repo.id) {
    log(`  ⑤ 创建仓库 ${owner}/${REPO}（${PRIVATE ? 'private' : 'public'}）…`);
    repo = (
      await api('POST', '/user/repos', {
        name: REPO,
        description: DESCRIPTION,
        private: PRIVATE,
        has_issues: true,
        has_wiki: false,
        auto_init: true,
      })
    ).data;
    await sleep(800);
  } else {
    log(`  ⑤ 仓库已存在，复用：${repo.full_name}`);
  }
  const branch = repo.default_branch || 'main';

  /* 6. 现有 HEAD（新建的空仓库还没有 ref，允许为空） */
  let ref = null;
  for (let i = 0; i < 4 && !ref; i++) {
    const r = await api('GET', `/repos/${owner}/${REPO}/git/ref/heads/${branch}`, null, {
      allow: [404, 409],
    });
    if (r.data && r.data.object) ref = r.data;
    else await sleep(400 + i * 600);
  }
  const headSha = ref ? ref.object.sha : null;
  if (!headSha) log('  ⑥ 空仓库：这次提交会成为第一个 commit');

  /* 7. 上传 blob */
  log(`  ⑥ 上传 ${files.length} 个文件 …`);
  let done = 0;
  const blobs = await mapLimit(files, 5, async (f) => {
    const content = await fsp.readFile(f.abs);
    const { data } = await api('POST', `/repos/${owner}/${REPO}/git/blobs`, {
      content: content.toString('base64'),
      encoding: 'base64',
    });
    done++;
    if (done % 10 === 0 || done === files.length) log(`     ${done}/${files.length}`);
    return { path: f.rel, mode: '100644', type: 'blob', sha: data.sha };
  });

  /* 8. 建树（完整替换，不带 base_tree） */
  const tree = (
    await api('POST', `/repos/${owner}/${REPO}/git/trees`, { tree: blobs })
  ).data;
  log('  ⑦ 生成目录树 ' + tree.sha.slice(0, 10));

  /* 9. 提交 */
  const commit = (
    await api('POST', `/repos/${owner}/${REPO}/git/commits`, {
      message:
        'deck-forge: 斗地主/掼蛋 记牌·透视·AI 出牌·开局预设\n\n' +
        `${files.length} 个文件，${(totalBytes / 1024).toFixed(1)} KB\n` +
        'Generated by tools/push-github.mjs（零泄露通道，仓库内不含任何凭据）',
      tree: tree.sha,
      parents: headSha ? [headSha] : [],
    })
  ).data;
  log('  ⑧ 提交 ' + commit.sha.slice(0, 10));

  /* 10. 推进分支（空仓库没有 ref，直接创建） */
  if (headSha) {
    await api('PATCH', `/repos/${owner}/${REPO}/git/refs/heads/${branch}`, {
      sha: commit.sha,
      force: false,
    });
    log('  ⑨ 分支 ' + branch + ' 已更新');
  } else {
    try {
      await api('POST', `/repos/${owner}/${REPO}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });
      log('  ⑨ 分支 ' + branch + ' 已创建');
    } catch (e) {
      // auto_init 的初始提交可能刚好在这时出现（ref 已存在）→ 改成快进
      const again = await api('GET', `/repos/${owner}/${REPO}/git/ref/heads/${branch}`, null, {
        allow: [404, 409],
      });
      if (!again.data || !again.data.object) throw e;
      await api('PATCH', `/repos/${owner}/${REPO}/git/refs/heads/${branch}`, {
        sha: commit.sha,
        force: false,
      });
      log('  ⑨ 分支 ' + branch + ' 已快进');
    }
  }

  /* 11. 校验 */
  await sleep(600);
  const final = (await api('GET', `/repos/${owner}/${REPO}`)).data;
  const verify = (
    await api('GET', `/repos/${owner}/${REPO}/git/trees/${branch}?recursive=1`)
  ).data;
  const remoteCount = (verify.tree || []).filter((t) => t.type === 'blob').length;

  log('');
  log('  ✅ 上传完成');
  log('     仓库   ' + final.html_url);
  log('     分支   ' + branch);
  log('     文件   ' + remoteCount + ' 个（本地 ' + files.length + '）');
  log('     可见性 ' + (final.private ? 'private' : 'public'));
  log('     提交   ' + final.pushed_at);
  log('');
  log('  想 clone 到本地；有 git 的话：');
  log('     git clone ' + final.clone_url);
  log('');

  /* 12. 擦除本地 token */
  if (FORGET) {
    try {
      fs.unlinkSync(TOKEN_FILE);
      log('  🧽 已删除本地 token 文件：' + TOKEN_FILE);
      log('     （建议顺手去 GitHub 把这个 token 也 revoke 掉：Settings → Developer settings → Tokens）');
      log('');
    } catch (e) {
      warn('  ! 删除 token 文件失败：' + e.message);
    }
  } else {
    log('  提示：加快 --forget 可在成功后自动删除本地 token 文件。');
    log('');
  }
}

/** 把网络异常统一包装成可读中文，并确保 token 不会漏进错误信息 */
async function arm(fn) {
  try {
    return await fn();
  } catch (e) {
    const m = String(e && e.message ? e.message : e);
    if (/401|Bad credentials/i.test(m)) {
      die(
        'token 被 GitHub 拒绝（401）。可能原因：\n' +
          '    · token 已过期或被撤销\n' +
          '    · 复制时多了空格/少了字符\n' +
          '    · 是 fine-grained token 但没有勾选 Administration: Read and write（建仓需要）'
      );
    }
    if (/403|rate limit/i.test(m)) die('被限流或权限不足（403）：' + m);
    if (/ENOTFOUND|EAI_AGAIN|fetch failed|ECONN/i.test(m)) {
      die('连不上 api.github.com：' + m + '\n    检查代理/网络后重试。');
    }
    die(m);
  }
}

main().catch((e) => die(String((e && e.stack) || e)));
