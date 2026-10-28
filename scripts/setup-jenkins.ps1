#Requires -Version 5.1
<#
.SYNOPSIS
  Starts the full AttendX stack with Docker Compose: the application and Jenkins.
.DESCRIPTION
  Builds both images, starts the containers, waits for Jenkins and prints the
  URL plus the demo credentials. The Jenkins job is created automatically by
  Configuration as Code.
#>
[CmdletBinding()]
param(
  [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

Write-Step 'Checking Docker'
docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker is not running. Start Docker Desktop and try again.'
}

# Make the host kubeconfig available to Jenkins when it exists. This lets the
# optional Kubernetes stage run without hard-coding a Windows user path.
if (-not $env:KUBE_CONFIG_DIR) {
  $hostKube = Join-Path $HOME '.kube'
  if (Test-Path (Join-Path $hostKube 'config')) {
    $env:KUBE_CONFIG_DIR = (Resolve-Path $hostKube).Path.Replace('\', '/')
    Write-Host "Using kubeconfig from $env:KUBE_CONFIG_DIR"
  } else {
    New-Item -ItemType Directory -Path (Join-Path $projectRoot '.kube') -Force | Out-Null
  }
}

Write-Step 'Building and starting the application and Jenkins'
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
  throw 'docker compose up failed.'
}

Write-Step 'Waiting for Jenkins'
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri 'http://localhost:8080/login' -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    # Jenkins is still starting.
  }
  Start-Sleep -Seconds 5
}

if (-not $ready) {
  Write-Host 'Jenkins did not answer in time. Recent logs:' -ForegroundColor Yellow
  docker compose logs --tail 80 jenkins
  throw 'Jenkins startup timed out.'
}

Write-Step 'Stack is ready'
docker compose ps
Write-Host ""
Write-Host "Application : http://localhost:3000" -ForegroundColor Green
Write-Host "Jenkins     : http://localhost:8080" -ForegroundColor Green
Write-Host "Username    : admin" -ForegroundColor Green
Write-Host "Password    : admin123" -ForegroundColor Green
Write-Host ""
Write-Host "Trigger the pipeline with:" -ForegroundColor Cyan
Write-Host "  .\scripts\trigger-jenkins.ps1" -ForegroundColor White
