#Requires -Version 5.1
<#
.SYNOPSIS
  Creates a Jenkins-compatible kubeconfig for Docker Desktop Kubernetes.
.DESCRIPTION
  Docker Desktop writes a kubeconfig whose API server is https://127.0.0.1:<port>.
  That address is not reachable from inside the Jenkins container, and the API
  certificate does not include host.docker.internal. This script rewrites the
  server to host.docker.internal and pins tls-server-name to the "kubernetes"
  SAN, then writes the result to .kube/config (mounted into Jenkins).

  Re-run this after Docker Desktop restarts, because the published API port can
  change.
#>
[CmdletBinding()]
param(
  [string]$Source = (Join-Path $env:USERPROFILE '.kube\config'),
  [string]$Destination = (Join-Path (Split-Path -Parent $PSScriptRoot) '.kube\config')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Source)) {
  throw "Kubeconfig not found: $Source. Enable Kubernetes in Docker Desktop first."
}

$content = Get-Content $Source -Raw
$match = [regex]::Match($content, '(?m)^\s*server:\s*https://127\.0\.0\.1:(\d+)\s*$')
if (-not $match.Success) {
  throw "Could not find a Docker Desktop API server in $Source."
}

$port = $match.Groups[1].Value
$content = $content -replace '(?m)^(\s*server:\s*)https://127\.0\.0\.1:\d+\s*$', "`$1https://host.docker.internal:$port"
if ($content -notmatch '(?m)^\s*tls-server-name:') {
  $content = $content -replace '(?m)^(\s*server:\s*https://host\.docker\.internal:\d+)\s*$', "`$1`n    tls-server-name: kubernetes"
}

$directory = Split-Path -Parent $Destination
New-Item -ItemType Directory -Force -Path $directory | Out-Null
Set-Content -Path $Destination -Value $content -Encoding ASCII
Write-Host "Wrote Jenkins kubeconfig to $Destination (API port $port)." -ForegroundColor Green

if (docker ps --format '{{.Names}}' | Select-String -SimpleMatch 'attendance-jenkins') {
  Write-Host 'Verifying access from the Jenkins container...' -ForegroundColor Cyan
  docker exec attendance-jenkins kubectl get nodes
  if ($LASTEXITCODE -ne 0) {
    throw 'The Jenkins container still cannot reach the cluster.'
  }
}
