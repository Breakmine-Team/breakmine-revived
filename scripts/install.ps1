<#
.SYNOPSIS
    Breakmine Desktop installer for Windows.

.DESCRIPTION
    There are no prebuilt installers published on the mod wiki or in GitHub
    Releases, so this script fetches the game source from GitHub, builds it
    locally and packages the result as an NSIS installer. That means Node,
    npm and a working network connection are required.

    Re-running the script finds an existing install, compares the installed
    commit against the remote one and offers to update.

.PARAMETER Ref
    Branch, tag or commit to install. Defaults to main.

.PARAMETER InstallDir
    Where to install. Defaults to %LOCALAPPDATA%\Breakmine.

.PARAMETER Force
    Rebuild even when already up to date.

.PARAMETER Yes
    Answer yes to every prompt. Required when Breakmine Desktop drives this
    script itself, because Read-Host has no console to read from.

.EXAMPLE
    .\scripts\install.ps1
    .\scripts\install.ps1 -Ref 4.7.9a-93f80b7
    .\scripts\install.ps1 -Force
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string] $Ref = 'main',
    [string] $InstallDir = (Join-Path $env:LOCALAPPDATA 'Breakmine'),
    [switch] $Force,
    [switch] $Yes
)

$ErrorActionPreference = 'Stop'

$Repo = 'Breakmine-Team/breakmine-revived'
$Api = "https://api.github.com/repos/$Repo"

# Kept out of $InstallDir on purpose: the NSIS installer rewrites that folder
# during an upgrade, so a version marker kept there can be wiped. %APPDATA%
# survives reinstalls, and it is also where the game keeps userData/mods.
$StateFile = Join-Path $env:APPDATA 'Breakmine\install-state.json'

# ------------------------------------------------------------------ output

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Green }
function Write-Info { param([string]$Message) Write-Host "    $Message" }
function Write-Warn2 { param([string]$Message) Write-Host " !! $Message" -ForegroundColor Yellow }
function Die { param([string]$Message) Write-Host " xx $Message" -ForegroundColor Red; exit 1 }

function Confirm-Prompt {
    param([string]$Message, [bool]$Default = $true)
    if ($Yes) { return $true }
    $hint = if ($Default) { 'Y/n' } else { 'y/N' }
    $answer = Read-Host "    $Message [$hint]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return $answer.Trim().ToLowerInvariant() -in @('y', 'yes')
}

# Run a native command and turn a non-zero exit code into a terminating error.
# PowerShell does not throw when an external program fails.
function Invoke-Native {
    param([string]$Exe, [string[]]$NativeArgs, [string]$What)
    Write-Info "$What ..."
    & $Exe @NativeArgs
    if ($LASTEXITCODE -ne 0) {
        Die "$What failed (exit code $LASTEXITCODE)."
    }
}

function Assert-Command {
    param([string]$Name, [string]$Hint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        $suffix = if ($Hint) { " $Hint" } else { '' }
        Die "'$Name' is required but not installed.$suffix"
    }
}

# ------------------------------------------------------------------ preflight

Write-Step 'Checking prerequisites'
Assert-Command 'node' 'Install Node 22 or newer from https://nodejs.org'
Assert-Command 'npm'  'It ships with Node.'
Assert-Command 'tar'  'It ships with Windows 10 1803 and newer.'

$nodeVersion = (node --version).Trim()
if ([int](($nodeVersion -replace '^v', '').Split('.')[0]) -lt 22) {
    Write-Warn2 "Node $nodeVersion found; package.json asks for 22 or newer."
}
Write-Info "node $nodeVersion, npm $((npm --version) | Out-String).Trim()"

# ------------------------------------------------------------------ existing install

$installedSha = $null
$installedRef = $null
if (Test-Path $StateFile) {
    try {
        $state = Get-Content $StateFile -Raw | ConvertFrom-Json
        $installedSha = $state.sha
        $installedRef = $state.ref
    } catch {
        Write-Warn2 "Could not read $StateFile; treating the install as unknown."
    }
}

# ------------------------------------------------------------------ remote state

Write-Step "Checking $Repo ($Ref)"

$headers = @{ 'User-Agent' = 'breakmine-installer' }
if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $env:GITHUB_TOKEN" }

$remoteSha = $null
$remoteDate = $null
try {
    $commit = Invoke-RestMethod -Uri "$Api/commits/$Ref" -Headers $headers -TimeoutSec 30
    $remoteSha = $commit.sha
    $remoteDate = $commit.commit.author.date
} catch {
    # Not fatal: the tarball endpoint may still work, we just cannot compare.
    Write-Warn2 "Could not read the remote commit: $($_.Exception.Message)"
    Write-Warn2 'Set GITHUB_TOKEN to raise the API rate limit.'
}

$remoteShort = if ($remoteSha) { $remoteSha.Substring(0, 7) } else { '' }

# ------------------------------------------------------------------ already installed?

$reinstall = $false
if (Test-Path $InstallDir) {
    Write-Step 'Existing install found'
    Write-Info "location : $InstallDir"
    Write-Info "ref      : $(if ($installedRef) { $installedRef } else { 'unknown' })"
    Write-Info "commit   : $(if ($installedSha) { $installedSha } else { 'unknown' })"

    if ($remoteSha -and $installedSha -eq $remoteSha -and -not $Force -and -not $Yes) {
        Write-Step "Already up to date ($remoteShort)"
        Write-Info 'Re-run with -Force to rebuild anyway.'
        exit 0
    }

    if ($remoteSha) {
        Write-Info "remote   : $remoteShort ($remoteDate)"
    }

    if (Confirm-Prompt 'Update to the latest version?') {
        $reinstall = $true
    } else {
        Write-Step 'Keeping the current install.'
        exit 0
    }
}

# ------------------------------------------------------------------ fetch source

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("breakmine-build-" + [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
    Write-Step "Downloading source ($Ref)"
    $tarball = Join-Path $workDir 'source.tar.gz'
    # The tarball endpoint resolves branches, tags and commit SHAs alike, so
    # there is no need to guess refs/heads vs refs/tags.
    $tarballUrl = "$Api/tarball/$Ref"
    Write-Info $tarballUrl
    Invoke-WebRequest -Uri $tarballUrl -Headers $headers -OutFile $tarball -MaximumRedirection 10 `
        -UseBasicParsing | Out-Null

    Write-Step 'Extracting source'
    Invoke-Native -Exe 'tar' -NativeArgs @('-xzf', $tarball, '-C', $workDir, '--strip-components=1') -What 'extracting archive'

    if (-not (Test-Path (Join-Path $workDir 'package.json'))) {
        Die 'Downloaded archive does not look like the game (no package.json).'
    }

    # ---------------------------------------------------------------- build

    Push-Location $workDir
    try {
        Write-Step 'Installing build dependencies'
        if (Test-Path 'package-lock.json') {
            Invoke-Native -Exe 'npm' -NativeArgs @('ci', '--no-audit', '--no-fund') -What 'npm ci'
        } else {
            Write-Warn2 'No package-lock.json found; falling back to npm install.'
            Invoke-Native -Exe 'npm' -NativeArgs @('install', '--no-audit', '--no-fund') -What 'npm install'
        }

        Write-Step 'Building the game (this takes a few minutes)'
        Invoke-Native -Exe 'npm' -NativeArgs @('run', 'build') -What 'npm run build'

        if (-not (Test-Path 'dist\index.html')) {
            Die 'Build finished but dist\index.html is missing; the vite build likely failed.'
        }

        Write-Step 'Packaging the Windows installer'
        Invoke-Native -Exe 'npx' -NativeArgs @('--no-install', 'electron-builder', '--win', 'nsis', '--publish', 'never') `
            -What 'electron-builder'
    } finally {
        Pop-Location
    }

    $setupExe = Get-ChildItem -Path (Join-Path $workDir 'release') -Filter '*.exe' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $setupExe) {
        Die 'electron-builder produced no installer (look above for the error).'
    }

    # ---------------------------------------------------------------- install

    Write-Step "Installing to $InstallDir"
    if ($reinstall) { Write-Info 'replacing previous build' }

    if ($InstallDir.Contains(' ')) {
        Write-Warn2 'The install path contains a space. NSIS /D= cannot be quoted, so the'
        Write-Warn2 'installer may fall back to its own default directory.'
    }

    # NSIS honours /D= only as the final argument and only unquoted, which is
    # why this runs the installer directly instead of via Start-Process.
    Write-Info 'running the generated installer silently (this can take a minute)'
    & $setupExe.FullName /S "/D=$InstallDir"
    $installerExit = $LASTEXITCODE
    if ($installerExit -ne 0) {
        Die "The installer failed (exit code $installerExit)."
    }

    # Confirm it actually landed, rather than trusting the exit code alone.
    $exe = Get-ChildItem -Path $InstallDir -Filter '*.exe' -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch 'Uninstall' } |
        Select-Object -First 1
    if (-not $exe) {
        Die "Nothing was installed in $InstallDir. Run the installer by hand from $($setupExe.FullName)."
    }

    # ---------------------------------------------------------------- state

    New-Item -ItemType Directory -Path (Split-Path $StateFile) -Force | Out-Null
    [pscustomobject]@{
        sha        = $remoteSha
        ref        = $Ref
        installed  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        installDir = $InstallDir
    } | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8

    # ---------------------------------------------------------------- done

    Write-Host ''
    Write-Host ' Breakmine Desktop installed.' -ForegroundColor Green
    Write-Host ''
    Write-Info "binary : $($exe.FullName)"
    Write-Info "mods   : $(Join-Path $env:APPDATA 'Breakmine\mods')"
    Write-Host ''
    Write-Info 'Launch it from the Start menu, or run the binary above.'
    Write-Host ''
    Write-Info 'Re-run this script any time to check for and install an update.'
    Write-Info "Uninstall via Settings, or by running Uninstall $($exe.BaseName).exe."
}
finally {
    if (Test-Path $workDir) {
        Remove-Item -Path $workDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}