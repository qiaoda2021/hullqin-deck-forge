# 更新 GitHub 代码

目标固定为 [qiaoda2021/hullqin-deck-forge](https://github.com/qiaoda2021/hullqin-deck-forge) 的默认 `main` 分支。
上传器只更新现有仓库，不建仓、不改可见性、About 或 topics，不创建 tag / Release。

## 凭据

凭据仅从当前 Windows 账户的 DPAPI vault 读取。
首次设置时在自己的本地终端执行，不要把 Key 贴进对话：

```powershell
.\tools\vault.cmd init
.\tools\vault.cmd add github
node tools/vault.mjs check github
```

vault 位于 `%USERPROFILE%\.dsh-vault\vault.json`，在项目之外。
不把 Key 放入 argv、URL、源码、公开目录或日志；上传器也不回退读取明文文件或环境变量。
当前发布器不支持旧的 `--prompt`、`--stdin`、`--token-file`、`--forget` 或 `--private` 参数。

现有仓库的细粒度 PAT 需要目标仓库 `Contents: Read and write`；无需创建仓库的管理权限。

## 上传顺序

在本项目目录中执行：

```powershell
node build.js
node test/all.js
node tools/push-github.mjs --repo hullqin-deck-forge --dry-run
node tools/push-github.mjs --repo hullqin-deck-forge --check
```

- `--dry-run` 仅检查固定文件白名单并扫描秘密，不联网、不读取 Key。
- `--check` 从 vault 取 Key，确认账号、仓库身份、写权限、默认分支和当前 HEAD；只做 GitHub GET。
- 审核输出的 `changed` 文件清单，并记下 `head`。

把只读检查返回的 40 位提交号替换到下列占位：

```powershell
node tools/push-github.mjs --repo hullqin-deck-forge --expect-head EXPECTED_HEAD_SHA
```

## 更新与验证边界

1. 只读取 [上传器](tools/push-github.mjs) 中的固定 `PUBLISH_FILES` 白名单，拒绝符号链接和超限文件。
2. 对冻结在内存中的完整文件内容扫描常见 token / 私钥特征；取密钥后再检查当前凭据原文。
3. 不忽略长行，不把含 `x` 的疑似 Key 当作示例放过。匹配时只打印文件路径，不打印内容。
4. 比较 Git blob 摘要，只提交改变的白名单文件。
5. 基于实时 HEAD 的 `base_tree` 建树，保留白名单外的远端文件。
6. 写 ref 前再次核对 HEAD，使用 `force:false`；检测并发更新后中止，不自动覆盖或重试。
7. 读取固定提交的完整树，证明保留文件、路径和文件模式没有意外变化。
8. 逐个读取全部白名单 blob，按 SHA256 比对原始字节，最后确认分支仍指向目标提交。

失败后先检查错误与远端 HEAD，不要直接重复写入。若发生「已更新分支但验证未完成」，先读取远端固定提交复验。
特征扫描是发布门禁，不等于识别所有格式的秘密；白名单内容仍需人工审查。

父目录交接、临时补丁、测试日志和浏览器临时 profile 均不进入白名单。
