# 推送到 GitHub

这个目录本身就是一个完整可推的仓库（README / LICENSE / .gitignore / dist 都在里面）。
**仓库里不含任何凭据**；key 只存在你本机，而且是加密的。

---

## 方案 0：凭据库 + 一条命令（推荐，不用装 git）

### 一次性设置

```powershell
cd "D:\下载\hullqin-helper-main\hullqin控牌助手"

.\tools\vault.cmd init           # 建库：C:\Users\<你>\.dsh-vault\vault.json
.\tools\vault.cmd add github     # 隐藏输入，粘贴 PAT 回车
```

`add` 的时候屏幕不会回显，粘完回车即可。它会顺手识别这是 GitHub / OpenAI / AWS / Slack 哪一类，
并记下掩码提示（例如 `ghp_********abcd（40 字符）`），以后 `list` 只显示这个提示，永远不显示明文。

建 PAT：https://github.com/settings/tokens/new ，勾 **`repo`**（要建私有库）或 `public_repo`。

### 以后每次推送

```powershell
.\tools\push.cmd --repo hullqin-deck-forge
```

就这样。脚本自己去库里取 key、解密、调 GitHub API、建仓、上传、打印仓库地址。

```powershell
.\tools\push.cmd --repo xxx --private     # 私有仓库
.\tools\push.cmd --repo xxx --check       # 只验证 key 有没有效
.\tools\push.cmd --repo xxx --dry-run     # 只列文件 + 秘钥扫描，不联网
.\tools\push.cmd --repo xxx --key other   # 用库里另一个名字的 key
```

### 这个库是什么

| | |
| --- | --- |
| 位置 | `%USERPROFILE%\.dsh-vault\vault.json`（**在仓库目录之外**，永远进不了 git） |
| 加密 | Windows DPAPI `CurrentUser` + 固定熵 `dsh-vault-v1` |
| 谁能解开 | 只有**这台机器 + 这个 Windows 账户**。文件被拷到别的电脑、别的用户、或重装系统后，都解不开 |
| 文件权限 | `icacls` 收紧到仅当前账户可读写，继承已切断 |
| 内容 | 只有密文（base64 的 DPAPI blob）+ 名字/类型/掩码提示/时间，没有明文 |

> 为什么是 `vault.cmd` 而不是直接 `vault.ps1`：Windows 默认执行策略（`Restricted` / `AllSigned`）会拦下未签名的
> `.ps1`，报「未对文件进行数字签名，无法在当前系统上运行」。`vault.cmd` 只是用
> `powershell -NoProfile -ExecutionPolicy Bypass -File ...` 启动同一个脚本——**放行只作用于这一个进程，
> 不修改你的系统策略、不写注册表、不需要管理员权限**。想直接用 ps1 也可以：
> `powershell -NoProfile -ExecutionPolicy Bypass -File tools\vault.ps1 init`

管理命令：

```powershell
.\tools\vault.cmd init              # 建库
.\tools\vault.cmd add github        # 加 / 覆盖（同名直接覆盖）
.\tools\vault.cmd add openai         # 其他 key 也放这里，名字自己起
.\tools\vault.cmd list               # 看有哪些（只有掩码，无明文）
.\tools\vault.cmd test github        # 真连一次 GitHub，验账号 + 权限域
.\tools\vault.cmd rm github          # 删
.\tools\vault.cmd show github -Raw   # 打印明文，给别人管道用（慎用）
.\tools\vault.cmd path               # 库文件在哪
```

Node 侧怎么调用（写别的脚本时用这个，不要自己抄加解密）：

```js
import { getSecret, hasName, listNames } from './tools/vault.mjs';

const token = await getSecret('github');   // 明文只在内存里
if (hasName('openai')) { /* ... */ }
console.table(listNames());                // 只有掩码信息
```

命令行快速检查：

```powershell
node tools\vault.mjs list
node tools\vault.mjs check github
```

---

## 方案 1：不想入库，一次性给 token

```powershell
.\tools\push.cmd --repo hullqin-deck-forge --prompt
```

屏幕出现 `> ` 后粘贴回车（显示 `*`，不回显）。token 只存在于那个进程的内存里：
不落盘、不进 shell 历史、不进命令行参数、不经过任何聊天窗口。

其他等价方式：

```powershell
# 从文件读（文件放哪都行，别放仓库里）
.\tools\push.cmd --repo xxx --token-file "D:\某处\tok"

# 从管道读
Get-Content "D:\某处\tok" | .\tools\push.cmd --repo xxx --stdin
```

优先级：`--stdin` → `--prompt` → `--token-file` → 凭据库 → `~/.gh-token`。

---

## 方案 2：装了 Git 之后走原生流程

```powershell
winget install --id Git.Git -e --source winget     # 装完重开终端
cd "D:\下载\hullqin-helper-main\hullqin控牌助手"

git init -b main
git add -A
git commit -m "feat: 斗地主 / 掼蛋 一体化牌局助手（透视·记牌器·AI·开局预设·换牌）"
```

建远程仓库，二选一：

**A1. 有 GitHub CLI**

```powershell
winget install --id GitHub.cli -e --source winget
gh auth login
gh repo create hullqin-deck-forge --public --source . --remote origin --push
```

**A2. 手动建**

1. 打开 https://github.com/new ，仓库名填 `hullqin-deck-forge`，不要勾 README / .gitignore / LICENSE
2. 回到终端：

```powershell
git remote add origin https://github.com/<你的用户名>/hullqin-deck-forge.git
git push -u origin main
```

推送时要密码：填 **Personal Access Token**，不是登录密码。

---

## 方案 3：不想装 Git，也不想跑脚本

1. 进到 `hullqin控牌助手` 目录，全选 → 右键压缩成 `hullqin-deck-forge.zip`
   （**别**把整个 `hullqin-helper-main` 打进去，上级目录里还有别的东西）
2. 打开 https://github.com/new 建空仓库
3. 新仓库页面点 **uploading an existing file**，把 zip 里的内容拖进去，commit
4. 或者装 [GitHub Desktop](https://desktop.github.com/)，`Add local repository` 指到这个目录，
   然后 `Publish repository`

---

## 安全模型（方案 0 / 1 共同适用）

| 泄露渠道 | 处理方式 |
| --- | --- |
| 聊天记录 | key 从不进入对话；你只在**自己的终端**输入 |
| 命令行参数（`ps` / 任务管理器可见） | 从不拼进 argv，只放在 HTTP Header 里 |
| shell 历史 | `--prompt` 零落盘；`Read-Host` 的输入不进 PSReadLine 历史 |
| `.git/config` / remote URL | **根本不建 `.git`**，纯 REST + Git Data API |
| 磁盘残留 | 方案 1 零落盘；方案 0 存的是 DPAPI 密文，换账户/换机都解不开 |
| 日志 / 异常回显 | 所有输出（含 GitHub 报错）都过 `redact()`，token 原文替换成 `***`；实测 401 场景无泄漏 |
| 误提交进公开仓库 | 上传前对全部文件做秘钥扫描（6 类特征），命中一条即整体中止；`.gitignore` 另挡 `.gh-token` / `*.token` / `*.pem` / `.env` |
| 仓库公开后被翻 | 仓库里没有任何凭据和账号信息，文档里的示例一律 `ghp_xxxxxxxx` 占位 |

---

## token 需要什么权限

- **经典 PAT**：`repo`（含私有仓库）或 `public_repo`（只建公开仓库）。
- **细粒度 PAT**：`Administration: Read and write`（建仓库）+ `Contents: Read and write`（写文件），
  Repository access 设成 All repositories 或至少含目标仓库。

约 60 次 API 调用，远低于限额。用完建议去 https://github.com/settings/tokens 撤销。

---

## 推完之后

- 仓库里的 `.user.js` 直链可以直接给 Tampermonkey 装：
  `https://raw.githubusercontent.com/<用户名>/hullqin-deck-forge/main/dist/hullqin-deck-forge.user.js`
  （油猴里新建脚本 → 粘这段 URL → 它自己拉取；或浏览器直接打开，油猴会拦安装）
- 想让别人一键装，就把这个 raw 链接放 README 顶部。
- 改完代码：`node build.js && node test/all.js`，再 `.\tools\push.cmd --repo ...` 覆盖
  （脚本用 Git Data API 生成单个提交、整棵树替换，不会留旧文件垃圾）。
