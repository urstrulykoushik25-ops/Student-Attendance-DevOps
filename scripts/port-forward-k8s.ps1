#Requires -Version 5.1
<#
.SYNOPSIS
  Forwards local port 30080 to the attendance Service in Kubernetes.
.DESCRIPTION
  Docker Desktop's kind-based cluster does not publish NodePorts to Windows.
  This keeps a kubectl port-forward running so the app is available at
  http://localhost:30080. Press Ctrl+C to stop.
#>
[CmdletBinding()]
param(
  [int]$LocalPort = 30080,
  [string]$Namespace = 'student-attendance',
  [string]$Service = 'attendance-app'
)

$ErrorActionPreference = 'Stop'

Write-Host "Forwarding http://localhost:$LocalPort -> $Namespace/$Service:80" -ForegroundColor Cyan
Write-Host 'Press Ctrl+C to stop.' -ForegroundColor DarkGray

kubectl -n $Namespace port-forward "service/$Service" "${LocalPort}:80"
if ($LASTEXITCODE -ne 0) {
  throw 'kubectl port-forward failed. Is the Deployment running?'
}
