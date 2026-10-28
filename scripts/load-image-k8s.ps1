#Requires -Version 5.1
<#
.SYNOPSIS
  Loads a locally built Docker image into the Docker Desktop Kubernetes node.
.DESCRIPTION
  Docker Desktop's Kubernetes is kind-based and keeps its own containerd image
  store. A host image built with `docker build` is therefore not automatically
  visible to pods. This script saves the image, copies it into the control-plane
  container and imports it into the k8s.io containerd namespace.
#>
[CmdletBinding()]
param(
  [string]$Image = 'student-attendance:latest'
)

$ErrorActionPreference = 'Stop'

docker image inspect $Image *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Image '$Image' not found locally. Build it first: docker build -t $Image ."
}

$candidates = docker ps -a --format '{{.Names}} {{.Image}}' |
  Where-Object { $_ -match 'desktop-control-plane|k8s-control-plane|kind-control-plane|kindest/node' }

if (-not $candidates) {
  throw @'
No Kubernetes control-plane container found.
Make sure Kubernetes is enabled in Docker Desktop and "Show system containers" is on.
If your cluster is not Docker Desktop Kubernetes, push the image to a registry
that the cluster can reach instead.
'@
}

$node = ($candidates | Select-Object -First 1).Split(' ')[0]
$safeName = $Image -replace '[/:]', '-'
$tar = Join-Path $env:TEMP "$safeName.tar"

Write-Host "Saving $Image ..." -ForegroundColor Cyan
docker save $Image -o $tar
if ($LASTEXITCODE -ne 0) { throw 'docker save failed.' }

try {
  Write-Host "Copying image archive to $node ..." -ForegroundColor Cyan
  docker cp $tar "${node}:/tmp/$safeName.tar"
  if ($LASTEXITCODE -ne 0) { throw 'docker cp failed.' }

  Write-Host 'Importing into the k8s.io containerd namespace ...' -ForegroundColor Cyan
  docker exec $node ctr -n k8s.io images import "/tmp/$safeName.tar"
  if ($LASTEXITCODE -ne 0) { throw 'ctr images import failed.' }

  # Keep the :latest tag in sync for manifests that use it.
  if ($Image -match ':latest$') {
    $repo = $Image -replace ':latest$', ''
    docker exec $node ctr -n k8s.io images tag "docker.io/library/$Image" "docker.io/library/$repo`:latest" *> $null
  }

  docker exec $node ctr -n k8s.io images ls | Select-String ([regex]::Escape(($Image -split ':')[0]))
  Write-Host "Image '$Image' is now available to the cluster." -ForegroundColor Green
} finally {
  Remove-Item $tar -Force -ErrorAction SilentlyContinue
}
