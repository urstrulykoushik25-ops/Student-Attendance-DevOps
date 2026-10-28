#Requires -Version 5.1
<#
.SYNOPSIS
  Enables the built-in Kubernetes cluster in Docker Desktop.
.DESCRIPTION
  Docker Desktop does not expose a CLI command to toggle Kubernetes, so this
  script updates its settings store, restarts Docker Desktop and waits for the
  single-node cluster to become ready. A backup of the settings file is kept
  next to the original.

  Note: Docker Desktop stores settings under Go field names (for example
  "KubernetesEnabled"), not the dotted names used by its GUI API.
.NOTES
  Run this from an elevated/normal PowerShell session. Docker Desktop must be
  installed. Existing containers with a restart policy are restarted by Docker
  Desktop after the restart.
#>
[CmdletBinding()]
param(
  [int]$TimeoutSeconds = 600,
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$settingsPath = Join-Path $env:APPDATA 'Docker\settings-store.json'
$backupPath = "$settingsPath.bak"

if (-not (Test-Path $settingsPath)) {
  throw "Docker Desktop settings file not found: $settingsPath"
}

function Set-Setting {
  param($Object, [string]$Name, $Value)
  $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

Write-Host 'Stopping Docker Desktop...' -ForegroundColor Cyan
docker desktop stop --timeout 180
if ($LASTEXITCODE -ne 0) {
  throw 'Could not stop Docker Desktop. Close it manually and retry.'
}

Copy-Item $settingsPath $backupPath -Force
Write-Host "Backed up settings to $backupPath" -ForegroundColor DarkGray

$settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
# Remove legacy dotted keys if an older run left them behind.
foreach ($legacy in @(
    'kubernetes.enabled',
    'kubernetes.mode',
    'kubernetes.nodesCount',
    'kubernetes.showSystemContainers'
  )) {
  $settings.PSObject.Properties.Remove($legacy)
}
Set-Setting $settings 'KubernetesEnabled' $true
Set-Setting $settings 'KubernetesMode' 'kind'
Set-Setting $settings 'KubernetesNodesCount' 1

$settings | ConvertTo-Json -Depth 20 | Set-Content -Path $settingsPath -Encoding UTF8
Write-Host 'Enabled Kubernetes (kind mode, 1 node).' -ForegroundColor Green

if ($NoRestart) {
  Write-Host 'Settings updated. Start Docker Desktop manually to create the cluster.' -ForegroundColor Yellow
  return
}

Write-Host 'Starting Docker Desktop...' -ForegroundColor Cyan
docker desktop start --timeout 300
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Desktop did not start. Restore the backup if needed.'
}

Write-Host 'Waiting for the Kubernetes API...' -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$ready = $false
$previousErrorAction = $ErrorActionPreference
# kubectl writes connection errors to stderr while the cluster is booting;
# keep them from terminating the polling loop.
$ErrorActionPreference = 'Continue'
try {
  while ((Get-Date) -lt $deadline) {
    $node = & kubectl get nodes --no-headers --request-timeout=5s 2>$null
    if ($LASTEXITCODE -eq 0 -and $node -match '\sReady(\s|$)') {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 5
  }
} finally {
  $ErrorActionPreference = $previousErrorAction
}

if (-not $ready) {
  docker desktop kubernetes status
  throw "Kubernetes did not become ready within $TimeoutSeconds seconds."
}

Write-Host ''
docker desktop kubernetes status
kubectl get nodes -o wide
Write-Host ''
Write-Host 'Kubernetes is ready. Next: docker build -t student-attendance:latest .' -ForegroundColor Green
Write-Host 'Then load the image into the kind node (see docs/DEVOPS_GUIDE.md, section 6.3).' -ForegroundColor Green

$syncScript = Join-Path $PSScriptRoot 'sync-kubeconfig.ps1'
if (Test-Path $syncScript) {
  & $syncScript
}
