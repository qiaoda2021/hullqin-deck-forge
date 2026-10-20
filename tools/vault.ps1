# 本机凭据库（DPAPI 加密）
# ------------------------------------------------------------------
# 这是唯一存放 key 的地方：%USERPROFILE%\.dsh-vault\vault.json
# 加密方式：Windows DPAPI(CurrentUser) + 固定熵 "dsh-vault-v1"
#   · 只有「本机 + 本 Windows 账户」能解开；
#   · 文件被复制到别的机器、别的账户，或重装系统后，都解不开；
#   · 仓库里、聊天记录里、命令行参数里永远不出现明文。
#
# 用法（Windows 默认执行策略禁止直接跑 .ps1，所以用同目录的 vault.cmd 启动它）：
#   .\tools\vault.cmd init                 建立库（顺手收紧目录 ACL）
#   .\tools\vault.cmd add github           隐藏输入，存一把叫 github 的 key
#   .\tools\vault.cmd add openai           再来一把，名字自己起
#   .\tools\vault.cmd list                 看有哪些（只显示掩码提示，不显示明文）
#   .\tools\vault.cmd test github          真连一次 GitHub 验证有没有效
#   .\tools\vault.cmd show github -Raw     打印明文（给别的程序管道用，慎用）
#   .\tools\vault.cmd rm github            删掉
#   .\tools\vault.cmd path                 显示库文件位置
#
# 直接用 powershell 跑也行（不改进系统策略，只对这一条命令放行）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\vault.ps1 init
#
# 说明：脚本必须存成 UTF-8 with BOM，否则 Windows PowerShell 5.1 会把中文读成乱码。
# ------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('init', 'add', 'get', 'list', 'show', 'rm', 'test', 'path', 'help')]
    [string]$Action = 'list',

    [Parameter(Position = 1)]
    [string]$Name,

    [string]$Value,

    [switch]$Raw,

    [switch]$Base64,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

# 必须先装载程序集，否则下面的 DataProtectionScope 类型解析不到
Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue

$VaultDir  = Join-Path $env:USERPROFILE '.dsh-vault'
$VaultFile = Join-Path $VaultDir 'vault.json'
$Entropy   = [Text.Encoding]::UTF8.GetBytes('dsh-vault-v1')
$Scope     = [System.Security.Cryptography.DataProtectionScope]::CurrentUser

function Write-Head($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan; Write-Host ("  " + ("-" * 58)) -ForegroundColor DarkGray }

function ConvertTo-B64([byte[]]$bytes) { [Convert]::ToBase64String($bytes) }

function Protect-Text([string]$text) {
    if ([string]::IsNullOrEmpty($text)) { throw "内容为空，没有可加密的东西" }
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $cipher = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $Entropy, $Scope)
    [Array]::Clear($bytes, 0, $bytes.Length)
    return (ConvertTo-B64 $cipher)
}

function Unprotect-Text([string]$b64) {
    $cipher = [Convert]::FromBase64String($b64)
    $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($cipher, $Entropy, $Scope)
    try { return [Text.Encoding]::UTF8.GetString($plain) }
    finally { [Array]::Clear($plain, 0, $plain.Length) }
}

function Get-Hint([string]$text) {
    if ([string]::IsNullOrEmpty($text)) { return '' }
    if ($text.Length -le 12) { return ('*' * $text.Length) + "（$($text.Length) 字符）" }
    return $text.Substring(0, 4) + ('*' * 8) + $text.Substring($text.Length - 4) + "（$($text.Length) 字符）"
}

function Detect-Kind([string]$text) {
    if ($text -match '^(gh[pousr]_|github_pat_)') { return 'github' }
    if ($text -match '^sk-') { return 'openai-style' }
    if ($text -match '^xox[baprs]-') { return 'slack' }
    if ($text -match '^AKIA[0-9A-Z]{16}') { return 'aws' }
    return 'generic'
}

function Read-Secret {
    # 注意：这里读的是「脚本级」$Value，不是函数自己的 $PSBoundParameters
    if (-not [string]::IsNullOrEmpty($Value)) { return $Value.Trim() }
    if ([Console]::IsInputRedirected) {
        throw "当前是非交互环境，请改用 -Value 传值（或在你自己的终端里运行）"
    }
    $sec = Read-Host "  粘贴 $Name 的值（输入不显示，回车结束）" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Read-Vault {
    if (-not (Test-Path $VaultFile)) {
        return [pscustomobject]@{ version = 1; note = 'DPAPI(CurrentUser) 加密，仅本机本账户可解'; keys = [pscustomobject]@{} }
    }
    $raw = Get-Content -LiteralPath $VaultFile -Raw -Encoding UTF8
    $obj = $raw | ConvertFrom-Json
    if (-not $obj.keys) { $obj | Add-Member -NotePropertyName keys -NotePropertyValue ([pscustomobject]@{}) -Force }
    return $obj
}

function Write-Vault($vault) {
    if (-not (Test-Path $VaultDir)) { New-Item -ItemType Directory -Path $VaultDir -Force | Out-Null }
    $json = $vault | ConvertTo-Json -Depth 12
    $utf8 = New-Object Text.UTF8Encoding $false
    [IO.File]::WriteAllText($VaultFile, $json, $utf8)
    try {
        # 只有当前账户可读写（DPAPI 已经做了加密，这里再加一层文件系统权限）
        & icacls $VaultFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
    }
    catch { }
}

function Test-GitHub([string]$token) {
    $h = @{
        Authorization          = "Bearer $token"
        Accept                 = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
        'User-Agent'           = 'dsh-vault'
    }
    $r = Invoke-WebRequest -Uri 'https://api.github.com/user' -Headers $h -UseBasicParsing -TimeoutSec 20
    $me = $r.Content | ConvertFrom-Json
    $scopes = $r.Headers['x-oauth-scopes']
    return [pscustomobject]@{ login = $me.login; name = $me.name; scopes = $scopes }
}

# ------------------------------------------------------------------ 动作

switch ($Action) {

    'help' {
        Get-Content -LiteralPath $PSCommandPath -TotalCount 26 | ForEach-Object { Write-Host $_ }
    }

    'path' {
        Write-Output $VaultFile
        if (Test-Path $VaultFile) {
            $fi = Get-Item $VaultFile
            Write-Host ("  存在，{0:N0} 字节，最后修改 {1}" -f $fi.Length, $fi.LastWriteTime) -ForegroundColor DarkGray
        }
        else {
            Write-Host "  还不存在，先跑 .\tools\vault.cmd init" -ForegroundColor Yellow
        }
    }

    'init' {
        Write-Head '初始化凭据库'
        if ((Test-Path $VaultFile) -and -not $Force) {
            Write-Host "  库已经存在：$VaultFile" -ForegroundColor Yellow
            Write-Host "  要重建请加 -Force（会丢掉里面所有 key）" -ForegroundColor DarkGray
            return
        }
        if (-not (Test-Path $VaultDir)) { New-Item -ItemType Directory -Path $VaultDir -Force | Out-Null }
        try { & icacls $VaultDir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null } catch { }
        Write-Vault ([pscustomobject]@{ version = 1; note = 'DPAPI(CurrentUser) 加密，仅本机本账户可解'; keys = [pscustomobject]@{} })
        Write-Host "  ✓ 已建立 $VaultFile" -ForegroundColor Green
        Write-Host "    加密：DPAPI CurrentUser + 熵 dsh-vault-v1" -ForegroundColor DarkGray
        Write-Host "    换个用户或换台机器都解不开" -ForegroundColor DarkGray
    }

    'add' {
        if (-not $Name) { throw "缺少 name。例：.\tools\vault.cmd add github" }
        Write-Head "写入 $Name"
        $secret = Read-Secret
        if ([string]::IsNullOrWhiteSpace($secret)) { throw "没有输入内容" }
        $vault = Read-Vault
        $enc = Protect-Text $secret
        $entry = [pscustomobject]@{
            label   = $Name
            kind    = (Detect-Kind $secret)
            hint    = (Get-Hint $secret)
            created = (Get-Date).ToString('o')
            user    = $env:USERNAME
            machine = $env:COMPUTERNAME
            blob    = $enc
        }
        if ($vault.keys.PSObject.Properties.Name -contains $Name) {
            $vault.keys.$Name = $entry
            Write-Host "  ↻ 已覆盖同名的旧值" -ForegroundColor Yellow
        }
        else {
            $vault.keys | Add-Member -NotePropertyName $Name -NotePropertyValue $entry -Force
        }
        Write-Vault $vault
        $secret = $null; $enc = $null
        [GC]::Collect()
        Write-Host "  ✓ 已加密存入" -ForegroundColor Green
        Write-Host "    类型 $($entry.kind)   提示 $($entry.hint)" -ForegroundColor DarkGray
        Write-Host "    文件 $VaultFile" -ForegroundColor DarkGray
    }

    'list' {
        Write-Head '凭据库'
        if (-not (Test-Path $VaultFile)) {
            Write-Host "  还没有库。先：.\tools\vault.cmd init，再：.\tools\vault.cmd add github" -ForegroundColor Yellow
            return
        }
        $vault = Read-Vault
        # 只认真正带 blob 的条目：空库时 Properties 为空，直接取 .Name 会得到 @($null)（Count=1）
        $entries = @($vault.keys.PSObject.Properties | Where-Object { $_.Value -and $_.Value.PSObject.Properties['blob'] })
        if ($entries.Count -eq 0) {
            Write-Host "  空库。加一把：.\tools\vault.cmd add github" -ForegroundColor Yellow
            return
        }
        foreach ($p in $entries) {
            $e = $p.Value
            Write-Host ("  {0,-10} {1,-14} {2}" -f $p.Name, $e.kind, $e.hint)
            $when = '不詳'
            if ($e.created) {
                try { $when = ([datetime]$e.created).ToString('yyyy-MM-dd HH:mm') } catch { $when = [string]$e.created }
            }
            Write-Host ("  {0,-10} 建于 {1}" -f '', $when) -ForegroundColor DarkGray
        }
        Write-Host ""
        Write-Host "  文件 $VaultFile" -ForegroundColor DarkGray
    }

    'get' {
        if (-not $Name) { throw "缺少 name" }
        $vault = Read-Vault
        if (-not ($vault.keys.PSObject.Properties.Name -contains $Name)) { throw "库里没有 '$Name'" }
        $plain = Unprotect-Text $vault.keys.$Name.blob
        # -Base64 是给程序调用的：纯 ASCII 输出，不受控制台代码页 / BOM 影响
        if ($Base64) { [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain))) }
        elseif ($Raw) { [Console]::Out.Write($plain) }
        else { Write-Output $plain }
    }

    'show' {
        if (-not $Name) { throw "缺少 name" }
        $vault = Read-Vault
        if (-not ($vault.keys.PSObject.Properties.Name -contains $Name)) { throw "库里没有 '$Name'" }
        Write-Head "明文：$Name"
        Write-Host "  下面是明文，注意别截屏、别贴进聊天窗口" -ForegroundColor Yellow
        $plain = Unprotect-Text $vault.keys.$Name.blob
        if ($Raw) { [Console]::Out.Write($plain) }
        else {
            Write-Output $plain
            Write-Host ("  长度 {0}，提示 {1}" -f $plain.Length, (Get-Hint $plain)) -ForegroundColor DarkGray
        }
    }

    'rm' {
        if (-not $Name) { throw "缺少 name" }
        $vault = Read-Vault
        if (-not ($vault.keys.PSObject.Properties.Name -contains $Name)) { throw "库里没有 '$Name'" }
        $vault.keys.PSObject.Properties.Remove($Name)
        Write-Vault $vault
        Write-Host "  ✓ 已删除 $Name" -ForegroundColor Green
    }

    'test' {
        if (-not $Name) { throw "缺少 name" }
        $vault = Read-Vault
        if (-not ($vault.keys.PSObject.Properties.Name -contains $Name)) { throw "库里没有 '$Name'" }
        $entry = $vault.keys.$Name
        $plain = Unprotect-Text $entry.blob
        Write-Head "验证 $Name（$($entry.kind)）"
        if ($entry.kind -eq 'github') {
            try {
                $r = Test-GitHub $plain
                Write-Host "  ✓ 有效。账号 @$($r.login)$(if ($r.name) { "（$($r.name)）" } else { '' })" -ForegroundColor Green
                Write-Host "    权限域：$(if ($r.scopes) { $r.scopes } else { '未暴露（细粒度 token 常见）' })" -ForegroundColor DarkGray
            }
            catch {
                Write-Host "  ✗ 验证失败：$($_.Exception.Message)" -ForegroundColor Red
                Write-Host "    常见原因：过期 / 撤销 / 复制缺字符" -ForegroundColor DarkGray
            }
        }
        else {
            Write-Host "  · $($entry.kind) 没有内置验证器，只确认能解密" -ForegroundColor DarkGray
            Write-Host "    ✓ 解密成功，长度 $($plain.Length)" -ForegroundColor Green
        }
        $plain = $null
        [GC]::Collect()
    }
}
