# Ocean Live "Any questions?" proxy: one-time setup and deploy (Windows PowerShell 5.1).
#
# Run it yourself from a terminal:
#   cd ask-proxy
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
#
# It does what README.md describes by hand, in an order that works on a first run:
#   1. checks Node.js 20 or later and runs npm install
#   2. logs you in to Cloudflare (your browser opens; you sign in yourself)
#   3. creates the ASK_KV namespace and writes its id into wrangler.toml
#   4. creates the ocean-live-ask-log D1 database, writes its id, applies the migrations
#   5. uploads the fault code table to KV (optional)
#   6. deploys the Worker (it has to exist before secrets can be added)
#   7. sets the secrets IP_SALT (generated) and ANTHROPIC_API_KEY (you paste it)
#   8. asks the deployed Worker one test question
#   9. prints the address for the OCEAN_ASK_URL repository variable
#
# It is safe to run again: steps that are already done are skipped.
#
# Options:
#   -SkipApiKey      don't ask for ANTHROPIC_API_KEY (keep the one already set)
#   -DtcFile <path>  fault code table to upload (default: the Ocean Link Pro table below)
#   -SkipDtc         don't upload the fault code table
#   -SkipSmokeTest   don't send the test question (it costs about a cent)

[CmdletBinding()]
param(
    [switch]$SkipApiKey,
    [string]$DtcFile = 'C:\Users\Justice\Documents\Ocean Live Android\apk-research\Ocean-Link-Pro-1.2.6\fisker-dtc-descriptions.json',
    [switch]$SkipDtc,
    [switch]$SkipSmokeTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$KvPlaceholder = 'REPLACE_WITH_YOUR_KV_NAMESPACE_ID'
$D1Placeholder = 'REPLACE_WITH_YOUR_D1_DATABASE_ID'
$KvBinding     = 'ASK_KV'
$D1Name        = 'ocean-live-ask-log'
$WorkerName    = 'ocean-live-ask'
$GitHubRepo    = 'JusticeRox98577/Fisker-Ocean-Apps'

# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------

function Write-Step([int]$Number, [string]$Text) {
    Write-Host ''
    Write-Host ("[{0}/9] {1}" -f $Number, $Text) -ForegroundColor Cyan
}

function Write-Info([string]$Text) { Write-Host "      $Text" }
function Write-Ok([string]$Text)   { Write-Host "      $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "      WARNING: $Text" -ForegroundColor Yellow }

# Runs a native command, showing its output on the console. Stops the script on a non-zero
# exit code.
#   -InputText    text piped to its standard input (it then knows it isn't interactive)
#   -Interactive  runs it attached to this console, so it can ask you questions (Start-Process
#                 keeps standard input and output a real terminal; arguments must not contain
#                 spaces in this mode)
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string[]]$ArgList = @(),
        [string]$InputText = '',
        [string]$What = '',
        [switch]$Interactive
    )
    if (-not $What) { $What = "$Exe $($ArgList -join ' ')" }
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($Interactive) {
            $p = Start-Process -FilePath $Exe -ArgumentList $ArgList -NoNewWindow -Wait -PassThru
            $code = $p.ExitCode
        } elseif (-not [string]::IsNullOrEmpty($InputText)) {
            $InputText | & $Exe @ArgList | Out-Host
            $code = $LASTEXITCODE
        } else {
            & $Exe @ArgList | Out-Host
            $code = $LASTEXITCODE
        }
    } finally {
        $ErrorActionPreference = $old
    }
    if ($code -ne 0) { throw "'$What' failed (exit code $code)." }
}

# Runs a native command and returns its output as text, also echoing it to the console unless
# -Quiet. With -MergeStderr, error output is captured too (and echoed live). Without it, error
# output goes straight to the console and only standard output is returned (clean for JSON).
# Returns an object with Code and Text; never throws on a non-zero exit code, the caller decides.
function Invoke-Capture {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string[]]$ArgList = @(),
        [switch]$MergeStderr,
        [switch]$Quiet
    )
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($MergeStderr) {
            $lines = & $Exe @ArgList 2>&1 | ForEach-Object {
                $line = "$_"
                if (-not $Quiet) { Write-Host $line }
                $line
            }
        } else {
            $lines = & $Exe @ArgList | ForEach-Object {
                $line = "$_"
                if (-not $Quiet) { Write-Host $line }
                $line
            }
        }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
    $text = (@($lines) | Where-Object { $null -ne $_ }) -join "`n"
    return [pscustomobject]@{ Code = $code; Text = $text }
}

# Parses the JSON array in a wrangler command's standard output.
function ConvertFrom-WranglerJson([string]$Text) {
    $start = $Text.IndexOf('[')
    $end = $Text.LastIndexOf(']')
    if ($start -lt 0 -or $end -le $start) { throw "Expected a JSON list from wrangler, got:`n$Text" }
    $parsed = $Text.Substring($start, $end - $start + 1) | ConvertFrom-Json
    # PowerShell 5.1 returns a JSON array as one object: emit its items one by one.
    foreach ($item in $parsed) { $item }
}

# Shorthand for "npx wrangler ...". npx.cmd (not npx.ps1) so piping to it works.
function Wrangler([string[]]$ArgList, [string]$InputText = '', [switch]$Interactive) {
    Invoke-Native -Exe 'npx.cmd' -ArgList (@('wrangler') + $ArgList) -InputText $InputText -Interactive:$Interactive -What ("npx wrangler " + ($ArgList -join ' '))
}
function WranglerCapture([string[]]$ArgList, [switch]$MergeStderr, [switch]$Quiet) {
    Invoke-Capture -Exe 'npx.cmd' -ArgList (@('wrangler') + $ArgList) -MergeStderr:$MergeStderr -Quiet:$Quiet
}

# wrangler.toml is read and written as raw text: only the placeholder string changes, so every
# other line, comment and the CRLF/LF line endings stay exactly as they were.
$TomlPath = $null
function Get-Toml { [System.IO.File]::ReadAllText($TomlPath) }
function Set-TomlPlaceholder([string]$Placeholder, [string]$Value) {
    $text = Get-Toml
    if (-not $text.Contains($Placeholder)) { throw "Placeholder $Placeholder not found in wrangler.toml." }
    $text = $text.Replace($Placeholder, $Value)
    [System.IO.File]::WriteAllText($TomlPath, $text, (New-Object System.Text.UTF8Encoding($false)))
}

# Names of the Worker's secrets (needs the Worker to exist, so only after the deploy).
function Get-SecretNames {
    $r = WranglerCapture -ArgList @('secret', 'list', '--format', 'json') -Quiet
    if ($r.Code -ne 0) { throw "'npx wrangler secret list' failed (exit code $($r.Code))." }
    return @(ConvertFrom-WranglerJson $r.Text | ForEach-Object { $_.name })
}

# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------

# Work in this script's folder (ask-proxy) whatever folder it was started from.
Push-Location -LiteralPath $PSScriptRoot
try {
    $TomlPath = Join-Path $PSScriptRoot 'wrangler.toml'
    if (-not (Test-Path -LiteralPath $TomlPath)) { throw "wrangler.toml not found next to setup.ps1." }

    # Show wrangler's output (UTF-8) properly, and let Invoke-RestMethod use TLS 1.2.
    try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    # -----------------------------------------------------------------------------------------
    Write-Step 1 'Checking Node.js and installing packages'
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js is not installed. Install Node.js 20 or later from https://nodejs.org and run this again.'
    }
    if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
        throw 'npx was not found. Reinstall Node.js (it includes npm and npx) and run this again.'
    }
    $nodeVersion = (Invoke-Capture -Exe 'node' -ArgList @('--version') -Quiet).Text.Trim()
    if ($nodeVersion -notmatch '^v(\d+)\.') { throw "Could not read the Node.js version ('$nodeVersion')." }
    if ([int]$Matches[1] -lt 20) {
        throw "Node.js $nodeVersion is too old. Install Node.js 20 or later from https://nodejs.org and run this again."
    }
    Write-Ok "Node.js $nodeVersion"
    Invoke-Native -Exe 'npm.cmd' -ArgList @('install') -What 'npm install'
    Write-Ok 'Packages installed.'

    # -----------------------------------------------------------------------------------------
    Write-Step 2 'Checking your Cloudflare login'
    # "wrangler whoami --json" exits with a non-zero code when not logged in.
    $who = WranglerCapture -ArgList @('whoami', '--json') -Quiet
    if ($who.Code -ne 0) {
        Write-Info 'Not logged in. Your browser opens now: sign in to Cloudflare and allow Wrangler.'
        Wrangler @('login') -Interactive
        $who = WranglerCapture -ArgList @('whoami', '--json') -Quiet
        if ($who.Code -ne 0) { throw 'Still not logged in to Cloudflare. Run this script again.' }
    }
    Write-Ok 'Logged in to Cloudflare.'

    # -----------------------------------------------------------------------------------------
    Write-Step 3 "KV namespace $KvBinding (counters and fault code table)"
    if ((Get-Toml).Contains($KvPlaceholder)) {
        $kvId = $null
        $r = WranglerCapture -ArgList @('kv', 'namespace', 'create', $KvBinding) -MergeStderr
        if ($r.Code -eq 0) {
            # Wrangler prints a TOML snippet with: id = "<32 hex characters>"
            $m = [regex]::Match($r.Text, 'id\s*=\s*"([0-9a-f]{32})"')
            if (-not $m.Success) { $m = [regex]::Match($r.Text, '\b([0-9a-f]{32})\b') }
            if ($m.Success) { $kvId = $m.Groups[1].Value }
        }
        if (-not $kvId) {
            # Creation failed (usually "already exists") or the id wasn't in the output:
            # look the namespace up by title. Older wranglers prefixed the Worker name.
            Write-Info 'Looking for an existing namespace...'
            $list = WranglerCapture -ArgList @('kv', 'namespace', 'list') -Quiet
            if ($list.Code -ne 0) { throw "'npx wrangler kv namespace list' failed (exit code $($list.Code))." }
            $ns = ConvertFrom-WranglerJson $list.Text |
                Where-Object { $_.title -eq $KvBinding -or $_.title -eq "$WorkerName-$KvBinding" } |
                Select-Object -First 1
            if (-not $ns) { throw "Could not create the KV namespace $KvBinding and found no existing one (see the output above)." }
            $kvId = $ns.id
        }
        Set-TomlPlaceholder $KvPlaceholder $kvId
        Write-Ok "KV namespace id $kvId written to wrangler.toml."
    } else {
        Write-Ok 'Already set in wrangler.toml, skipping.'
    }

    # -----------------------------------------------------------------------------------------
    Write-Step 4 "D1 database $D1Name (research log)"
    if ((Get-Toml).Contains($D1Placeholder)) {
        $dbId = $null
        $uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
        $r = WranglerCapture -ArgList @('d1', 'create', $D1Name) -MergeStderr
        if ($r.Code -eq 0) {
            # Wrangler prints a TOML snippet with: database_id = "<uuid>"
            $m = [regex]::Match($r.Text, "database_id\s*=\s*`"($uuid)`"")
            if (-not $m.Success) { $m = [regex]::Match($r.Text, "($uuid)") }
            if ($m.Success) { $dbId = $m.Groups[1].Value }
        }
        if (-not $dbId) {
            Write-Info 'Looking for an existing database...'
            $list = WranglerCapture -ArgList @('d1', 'list', '--json') -Quiet
            if ($list.Code -ne 0) { throw "'npx wrangler d1 list --json' failed (exit code $($list.Code))." }
            $db = ConvertFrom-WranglerJson $list.Text | Where-Object { $_.name -eq $D1Name } | Select-Object -First 1
            if (-not $db) { throw "Could not create the D1 database $D1Name and found no existing one (see the output above)." }
            $dbId = $db.uuid
        }
        Set-TomlPlaceholder $D1Placeholder $dbId
        Write-Ok "D1 database id $dbId written to wrangler.toml."
    } else {
        Write-Ok 'Already set in wrangler.toml.'
    }
    # Applying migrations is safe to repeat: already applied ones are skipped.
    # Piping "y" makes standard input non-interactive, so wrangler skips its confirmation.
    Write-Info 'Applying migrations...'
    Wrangler @('d1', 'migrations', 'apply', $D1Name, '--remote') -InputText 'y'
    Write-Ok 'Migrations applied.'

    # -----------------------------------------------------------------------------------------
    Write-Step 5 'Fault code table'
    if ($SkipDtc) {
        Write-Info 'Skipped (-SkipDtc).'
    } elseif (-not (Test-Path -LiteralPath $DtcFile)) {
        Write-Warn2 "Fault code table not found: $DtcFile"
        Write-Warn2 'Continuing without it. Answers still work, just without fault code descriptions.'
        Write-Warn2 'Upload it later with: .\setup.ps1 -SkipApiKey -DtcFile <path>'
    } else {
        # Writes dtc-kv.json (git-ignored) in this folder.
        Invoke-Native -Exe 'node' -ArgList @('scripts/build-dtc-kv.mjs', $DtcFile) -What 'node scripts/build-dtc-kv.mjs'
        Wrangler @('kv', 'bulk', 'put', 'dtc-kv.json', '--binding', $KvBinding, '--remote')
        Write-Ok 'Fault code table uploaded.'
    }

    # -----------------------------------------------------------------------------------------
    Write-Step 6 'Deploying the Worker'
    # Output is captured to read the address. Captured output isn't a terminal, so wrangler
    # can't ask questions; if the account has no workers.dev subdomain yet, deploy once
    # interactively so you can pick one, then deploy again to read the address.
    $r = WranglerCapture -ArgList @('deploy') -MergeStderr
    if ($r.Code -ne 0 -and $r.Text -match 'workers\.dev subdomain') {
        Write-Info 'Your Cloudflare account has no workers.dev subdomain yet. Wrangler asks for one now:'
        Wrangler @('deploy') -Interactive
        $r =WranglerCapture -ArgList @('deploy') -MergeStderr
    }
    if ($r.Code -ne 0) { throw "'npx wrangler deploy' failed (exit code $($r.Code))." }
    $m = [regex]::Match($r.Text, 'https://[A-Za-z0-9.-]+\.workers\.dev')
    if (-not $m.Success) { throw 'Deployed, but no https://...workers.dev address was found in the output above.' }
    $baseUrl = $m.Value.TrimEnd('/')
    $askUrl = "$baseUrl/ask"
    Write-Ok "Deployed at $baseUrl"

    # -----------------------------------------------------------------------------------------
    Write-Step 7 'Secrets'
    $secrets = Get-SecretNames

    # IP_SALT: 48 random bytes as hex, piped straight to wrangler. Never printed or saved.
    if ($secrets -contains 'IP_SALT') {
        Write-Ok 'IP_SALT is already set, keeping it.'
    } else {
        $bytes = New-Object byte[] 48
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $salt = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        try {
            Wrangler @('secret', 'put', 'IP_SALT') -InputText $salt
        } finally {
            $salt = $null
            [Array]::Clear($bytes, 0, $bytes.Length)
        }
        Write-Ok 'IP_SALT set (random, not shown).'
    }

    # ANTHROPIC_API_KEY: wrangler asks for it itself; this script never sees the value.
    $hasKey = $secrets -contains 'ANTHROPIC_API_KEY'
    $askKey = $false
    if ($SkipApiKey) {
        Write-Info 'ANTHROPIC_API_KEY skipped (-SkipApiKey).'
    } elseif ($hasKey) {
        $answer = Read-Host '      ANTHROPIC_API_KEY is already set. Replace it? (y/N)'
        $askKey = ($answer -match '^\s*[yY]')
        if (-not $askKey) { Write-Ok 'Keeping the current ANTHROPIC_API_KEY.' }
    } else {
        $askKey = $true
    }
    if ($askKey) {
        Write-Info 'Paste your Anthropic API key at the prompt below and press Enter (it is not shown).'
        Wrangler @('secret', 'put', 'ANTHROPIC_API_KEY') -Interactive
        $hasKey = $true
        Write-Ok 'ANTHROPIC_API_KEY set.'
    }

    # -----------------------------------------------------------------------------------------
    Write-Step 8 'Test question'
    if ($SkipSmokeTest) {
        Write-Info 'Skipped (-SkipSmokeTest).'
    } elseif (-not $hasKey) {
        Write-Warn2 'ANTHROPIC_API_KEY is not set, so the Worker cannot answer yet. Skipping the test.'
        Write-Warn2 'Set it with: npx wrangler secret put ANTHROPIC_API_KEY'
    } else {
        Write-Info 'This costs about a cent and appears in the research log as device setup-test-0001.'
        $body = '{"device":"setup-test-0001","messages":[{"role":"user","text":"What does B208896 mean?"}]}'
        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
        $result = $null
        $lastError = $null
        # New secrets can take a few seconds to reach every Cloudflare location: try twice.
        for ($attempt = 1; $attempt -le 2 -and -not $result; $attempt++) {
            if ($attempt -gt 1) { Write-Info 'Trying again in 15 seconds...'; Start-Sleep -Seconds 15 }
            try {
                $result = Invoke-RestMethod -Method Post -Uri $askUrl -ContentType 'application/json; charset=utf-8' -Body $bodyBytes -TimeoutSec 120
            } catch {
                $detail = $null
                if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
                $lastError = "$($_.Exception.Message) $detail".Trim()
                Write-Warn2 "Attempt $attempt failed: $lastError"
            }
        }
        if (-not $result) {
            throw "The test question failed: $lastError`nThe Worker is deployed at $askUrl; check 'npx wrangler tail' while running the test again."
        }
        Write-Ok 'Answer:'
        Write-Host ''
        Write-Host $result.answer
        Write-Host ''
        if ($result.PSObject.Properties['remainingToday']) {
            Write-Info "(Questions left today for this test device: $($result.remainingToday))"
        }
    }

    # -----------------------------------------------------------------------------------------
    Write-Step 9 'Done'
    Write-Host ''
    Write-Host '      Put this address in the GitHub repository variable OCEAN_ASK_URL' -ForegroundColor Green
    Write-Host '      (repo Settings > Secrets and variables > Actions > Variables):' -ForegroundColor Green
    Write-Host ''
    Write-Host "          $askUrl" -ForegroundColor White
    Write-Host ''
    Write-Host '      Also set a monthly spend limit for the API key''s workspace in the Anthropic Console' -ForegroundColor Yellow
    Write-Host '      (console.anthropic.com > Settings > Limits). The Worker stops at MONTHLY_CAP_USD,' -ForegroundColor Yellow
    Write-Host '      but that counter can run a few cents over.' -ForegroundColor Yellow
    Write-Host ''

    # Optional: set the repository variable with the GitHub CLI if it is installed and logged in.
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        $ghStatus = Invoke-Capture -Exe 'gh' -ArgList @('auth', 'status') -MergeStderr -Quiet
        if ($ghStatus.Code -eq 0) {
            $answer = Read-Host "      Set OCEAN_ASK_URL in $GitHubRepo now with the GitHub CLI? (y/N)"
            if ($answer -match '^\s*[yY]') {
                Invoke-Native -Exe 'gh' -ArgList @('variable', 'set', 'OCEAN_ASK_URL', '--body', $askUrl, '--repo', $GitHubRepo) -What 'gh variable set OCEAN_ASK_URL'
                Write-Ok "OCEAN_ASK_URL set in $GitHubRepo."
            }
        }
    }
} catch {
    Write-Host ''
    Write-Host "SETUP STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Fix the problem above and run the script again; finished steps are skipped.' -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
exit 0
