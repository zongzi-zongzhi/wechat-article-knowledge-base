$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $root 'logs'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$startLog = Join-Path $logDir "start-$timestamp.log"
$buildEntry = Join-Path $root '.output\server\index.mjs'
$nodeModules = Join-Path $root 'node_modules'
$envFile = Join-Path $root '.env'
$envExampleFile = Join-Path $root '.env.example'
$appUrl = 'http://127.0.0.1:3000'
$healthUrl = "$appUrl/api/kb/settings/storage"
$requiredNodeMajor = 22

Set-Location $root

function Write-Step {
  param([string]$Text)
  Write-Host $Text
}

function Write-Info {
  param([string]$Text)
  Write-Host $Text -ForegroundColor Cyan
}

function Fail-And-Exit {
  param([string]$Message)
  Write-Host ''
  Write-Host $Message -ForegroundColor Red
  Write-Host "See log: $startLog"
  Read-Host 'Press Enter to exit'
  exit 1
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath"
}

function Find-CommandPath {
  param([string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $commonPaths = @(
    (Join-Path $env:ProgramFiles "nodejs\$Name.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\$Name.exe")
  )

  foreach ($candidate in $commonPaths) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Get-NodeMajorVersion {
  param([string]$NodePath)

  if (-not $NodePath) {
    return $null
  }

  try {
    $versionText = & $NodePath --version
    $normalized = $versionText.Trim().TrimStart('v')
    return ([Version]$normalized).Major
  } catch {
    return $null
  }
}

function Test-NpmAvailable {
  cmd /c "npm --version" > $null 2>&1
  return $LASTEXITCODE -eq 0
}

function Confirm-AutoSetup {
  param([string]$Prompt)

  $answer = Read-Host "$Prompt [Y/N]"
  return $answer -match '^(y|yes)$'
}

function Install-Or-UpgradeNode {
  $wingetPath = Find-CommandPath -Name 'winget'
  if (-not $wingetPath) {
    Fail-And-Exit 'Node.js 22+ is required. winget was not found, so automatic installation is unavailable.'
  }

  if (-not (Confirm-AutoSetup 'Node.js 22+ is missing or too old. Allow automatic installation now?')) {
    Fail-And-Exit 'Startup cancelled because Node.js 22+ is required.'
  }

  Write-Step '[1/6] Installing or upgrading Node.js 22+ ...'

  & $wingetPath install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements --scope user
  if ($LASTEXITCODE -ne 0) {
    & $wingetPath upgrade --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  }

  Refresh-Path
}

function Ensure-NodeRuntime {
  $nodePath = Find-CommandPath -Name 'node'
  $nodeMajorVersion = Get-NodeMajorVersion -NodePath $nodePath
  $npmReady = Test-NpmAvailable

  if ($nodePath -and $npmReady -and $nodeMajorVersion -ge $requiredNodeMajor) {
    Write-Info "Detected Node.js v$nodeMajorVersion and npm."
    return
  }

  Install-Or-UpgradeNode

  $nodePath = Find-CommandPath -Name 'node'
  $nodeMajorVersion = Get-NodeMajorVersion -NodePath $nodePath
  $npmReady = Test-NpmAvailable

  if (-not $nodePath -or -not $npmReady -or $nodeMajorVersion -lt $requiredNodeMajor) {
    Fail-And-Exit 'Automatic Node.js setup did not complete successfully. Please reopen this launcher after installation finishes.'
  }

  Write-Info "Detected Node.js v$nodeMajorVersion and npm."
}

function Ensure-EnvFile {
  if (Test-Path $envFile) {
    return
  }

  if (-not (Test-Path $envExampleFile)) {
    Fail-And-Exit '.env.example was not found, so the default environment file could not be created.'
  }

  Copy-Item -LiteralPath $envExampleFile -Destination $envFile
  Write-Info 'Created .env from .env.example.'
}

function Test-AppReady {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

Write-Host ''
Write-Host 'WeChat Article Knowledge Base'
Write-Host ''

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

Set-Content -LiteralPath $startLog -Value '' -Encoding utf8

Write-Step '[1/6] Checking environment...'
Ensure-NodeRuntime
Ensure-EnvFile

$needsInstall = -not (Test-Path $nodeModules)
$needsBuild = -not (Test-Path $buildEntry)

if ($needsInstall -or $needsBuild) {
  Write-Step '[2/6] First-time project setup is required.'
  Write-Step 'This may take several minutes.'

  if ($needsInstall) {
    Write-Step '[3/6] Installing dependencies...'
    cmd /c "npm install >> `"$startLog`" 2>&1"
    if ($LASTEXITCODE -ne 0) {
      Fail-And-Exit 'Failed to install dependencies.'
    }
  } else {
    Write-Step '[3/6] Dependencies already installed.'
  }

  Write-Step '[4/6] Building project...'
  cmd /c "npm run build >> `"$startLog`" 2>&1"
  if ($LASTEXITCODE -ne 0) {
    Fail-And-Exit 'Build failed.'
  }
} else {
  Write-Step '[2/6] App files are ready.'
  Write-Step '[3/6] Skipping install and build.'
}

$portListeners = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($portListeners) {
  if (Test-AppReady) {
    Write-Step '[4/6] Existing app instance detected. Restarting...'
    $processIds = $portListeners | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($processId in $processIds) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
  }
  else {
    Fail-And-Exit 'Port 3000 is already in use by another program.'
  }
}

Write-Step '[5/6] Starting server...'
Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/c', "node .output/server/index.mjs >> `"$startLog`" 2>&1" `
  -WorkingDirectory $root `
  -WindowStyle Hidden

Write-Step '[6/6] Waiting for app to be ready...'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-AppReady) {
    $ready = $true
    break
  }
}

if (-not $ready) {
  Fail-And-Exit 'The app did not become ready in time.'
}

Start-Process 'http://localhost:3000'

Write-Host ''
Write-Host 'App started. Your browser will open automatically.'
Write-Host 'http://localhost:3000'
Write-Host ''
Write-Host 'First step after opening the page: input account name and storage folder.'
Write-Host ''
Write-Host "If startup fails, check log: $startLog"
Write-Host ''
