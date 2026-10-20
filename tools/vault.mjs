/**
 * vault.mjs —— 本机凭据库的 Node 侧调用入口
 *
 * 库文件：%USERPROFILE%\.dsh-vault\vault.json
 * 加密：  Windows DPAPI(CurrentUser) + 固定熵 "dsh-vault-v1"
 *         → 只有本机 + 本 Windows 账户能解开；文件被拷走也没用。
 *
 * 约定：
 *   · 读取明文一律走 `vault.ps1 get -Name <n> -Base64`，纯 ASCII 回传，
 *     不受控制台代码页影响；本模块再用 base64 解出原文。
 *   · 明文只存在于调用方的内存里；本模块不打印、不缓存、不落盘。
 *
 * 用法：
 *   import { getSecret, listNames, hasName } from './vault.mjs';
 *   const token = await getSecret('github');     // 拿不到会 throw
 *   if (hasName('openai')) { ... }
 *   console.table(listNames());                  // 只有名字/类型/掩码提示
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const VAULT_PS1 = path.join(HERE, 'vault.ps1');
export const VAULT_DIR = path.join(os.homedir(), '.dsh-vault');
export const VAULT_FILE = path.join(VAULT_DIR, 'vault.json');

/** 库文件是否存在 */
export function vaultExists() {
  return fs.existsSync(VAULT_FILE);
}

/** 不解密，只列出条目元信息（名字 / 类型 / 掩码提示 / 建立时间） */
export function listNames() {
  if (!vaultExists()) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  const keys = (data && data.keys) || {};
  return Object.keys(keys).map((name) => ({
    name,
    kind: keys[name].kind || 'generic',
    hint: keys[name].hint || '',
    created: keys[name].created || '',
  }));
}

/** 库里有没有这个名字 */
export function hasName(name) {
  return listNames().some((e) => e.name === name);
}

/** 找一个能用的 PowerShell（优先 pwsh 7，回退 Windows PowerShell 5.1） */
function psExe() {
  const cands = ['pwsh.exe', 'powershell.exe'];
  for (const c of cands) {
    // 只做存在性判断，避免额外 spawn
    const p = whichSync(c);
    if (p) return p;
  }
  return 'powershell.exe';
}

function whichSync(exe) {
  const PATH = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const ext = path.extname(exe) ? [''] : ['.exe', '.cmd', '.bat'];
  for (const dir of PATH) {
    for (const e of ext) {
      const p = path.join(dir, exe + e);
      try {
        if (fs.existsSync(p)) return p;
      } catch {}
    }
  }
  return null;
}

function runPs(args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(psExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', VAULT_PS1, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    ps.stdout.on('data', (b) => out.push(b));
    ps.stderr.on('data', (b) => err.push(b));
    ps.on('error', (e) => reject(new Error('起不了 PowerShell：' + e.message)));
    ps.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) {
        // 只回传脚本自己抛的中文消息，丢掉 PowerShell 的调用栈噪声
        const msg = stderr
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !/^\s*\+|CategoryInfo|FullyQualifiedErrorId|所在位置|At line/.test(s))
          .join(' ');
        return reject(new Error(msg || `vault.ps1 退出码 ${code}`));
      }
      resolve(stdout);
    });
  });
}

/**
 * 取出明文。拿不到就 throw（调用方自己决定是回滚还是提示）。
 * 注意：返回值是明文，不要 console.log 它。
 */
export async function getSecret(name) {
  if (!name) throw new Error('没有指定要取哪个 key');
  if (!vaultExists()) {
    throw new Error(`凭据库还不存在（${VAULT_FILE}）。先运行：tools\\vault.ps1 init`);
  }
  if (!hasName(name)) {
    const all = listNames().map((e) => e.name);
    throw new Error(
      `凭据库里没有 '${name}'。` +
        (all.length ? `现有：${all.join(', ')}` : '库是空的。') +
        `\n    添加：tools\\vault.ps1 add ${name}`
    );
  }
  const b64 = (await runPs(['get', '-Name', name, '-Base64'])).trim();
  if (!b64) throw new Error(`'${name}' 解出来是空的`);
  const plain = Buffer.from(b64, 'base64').toString('utf8');
  if (!plain) throw new Error(`'${name}' 解密失败`);
  return plain;
}

/** 给 CLI 用的：验证某个 key 是否可解密（不返回明文） */
export async function checkSecret(name) {
  const s = await getSecret(name);
  const ok = typeof s === 'string' && s.length > 0;
  return { ok, length: ok ? s.length : 0, kind: (listNames().find((e) => e.name === name) || {}).kind };
}

/* 直接运行时的迷你 CLI：node tools/vault.mjs list */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const cmd = process.argv[2] || 'list';
  if (cmd === 'list') {
    const rows = listNames();
    if (!rows.length) {
      console.log('\n  凭据库是空的（或还没建）：' + VAULT_FILE);
      console.log('  建立：tools\\vault.ps1 init');
      console.log('  加 key：tools\\vault.ps1 add github\n');
    } else {
      console.log('\n  凭据库 ' + VAULT_FILE + '\n');
      for (const r of rows) {
        console.log(`    ${r.name.padEnd(12)} ${r.kind.padEnd(14)} ${r.hint}`);
      }
      console.log('');
    }
  } else if (cmd === 'check') {
    const name = process.argv[3] || 'github';
    checkSecret(name)
      .then((r) => console.log(`  ✓ ${name} 可解密，长度 ${r.length}，类型 ${r.kind}`))
      .catch((e) => {
        console.error('  ✗ ' + e.message);
        process.exitCode = 1;
      });
  } else {
    console.log('  用法：node tools/vault.mjs list | check <name>');
  }
}
