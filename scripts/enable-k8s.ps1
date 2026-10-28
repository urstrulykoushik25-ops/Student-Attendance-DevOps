#Requires -Version 5.1
<#
.SYNOPSIS
  Enables the built-in Kubernetes cluster in Docker Desktop.
.DESCRIPTION
  Docker Desktop does not expose a CLI command to toggle Kubernetes, so this
  script updates its settings store, restarts Docker Desktop and waits for the
  single-node cluster to become ready. A backup of the settings file is kept
  next to the original.
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
Set-Setting $settings 'kubernetes.enabled' $true
Set-Setting $settings 'kubernetes.mode' 'kind'
Set-Setting $settings 'kubernetes.nodesCount' 1
Set-Setting $settings 'kubernetes.showSystemContainers' $true

$settings | ConvertTo-Json -Depth 20 | Set-Content -Path $settingsPath -Encoding UTF8
Write-Host 'Enabled Kubernetes (kind mode, 1 node, system containers visible).' -ForegroundColor Green

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
while ((Get-Date) -lt $deadline) {
  kubectl cluster-info --request-timeout=5s *> $null
  if ($LASTEXITCODE -eq 0) {
    $node = kubectl get nodes --no-headers --request-timeout=5s 2>$null | Select-Object -First 1
    if ($node -match '\sReady(\s|$)') {
      $ready = $true
      break
    }
  }
  Start-Sleep -Seconds 5
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
