#Requires -Version 5.1
<#
.SYNOPSIS
  Deploys the AttendX image to the current Kubernetes context.
#>
[CmdletBinding()]
param(
  [string]$Namespace = 'student-attendance',
  [string]$Image = 'student-attendance:latest',
  [string]$Tag = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

kubectl cluster-info | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'No reachable Kubernetes cluster. Enable Kubernetes in Docker Desktop or start minikube, then retry.'
}

Write-Host 'Applying Kubernetes manifests...' -ForegroundColor Cyan
kubectl apply -k k8s/
if ($LASTEXITCODE -ne 0) { throw 'kubectl apply failed.' }

if ($Tag) {
  Write-Host "Updating deployment image to student-attendance:$Tag ..." -ForegroundColor Cyan
  kubectl -n $Namespace set image deployment/attendance-app "attendance-app=student-attendance:$Tag"
  if ($LASTEXITCODE -ne 0) { throw 'kubectl set image failed.' }
}

Write-Host 'Waiting for rollout...' -ForegroundColor Cyan
kubectl -n $Namespace rollout status deployment/attendance-app --timeout=180s
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Pod status:' -ForegroundColor Yellow
  kubectl -n $Namespace get pods
  throw 'Deployment rollout failed. If the image is not visible to the cluster, see docs/DEVOPS_GUIDE.md for the local registry workflow.'
}

kubectl -n $Namespace get pods,svc
Write-Host ""
Write-Host "Application: http://localhost:30080" -ForegroundColor Green
