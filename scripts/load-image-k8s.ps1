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

$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  docker image inspect $Image *> $null
  $imageExists = $LASTEXITCODE -eq 0
} finally {
  $ErrorActionPreference = $previousErrorAction
}
if (-not $imageExists) {
  throw "Image '$Image' not found locally. Build it first: docker build -t $Image ."
}

# Docker Desktop hides Kubernetes system containers from `docker ps` unless
# "Show system containers" is enabled, but `docker inspect` still resolves the
# well-known kind node names. Probe both sources.
$candidates = @(
  docker ps -a --format '{{.Names}}' |
    Where-Object { $_ -match 'desktop-control-plane|k8s-control-plane|kind-control-plane' }
) + @('desktop-control-plane', 'k8s-control-plane', 'kind-control-plane')

$node = $null
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    docker inspect $candidate *> $null
    if ($LASTEXITCODE -eq 0) {
      $node = $candidate
      break
    }
  }
} finally {
  $ErrorActionPreference = $previousErrorAction
}

if (-not $node) {
  throw @'
No Kubernetes control-plane container found.
Make sure Kubernetes is enabled in Docker Desktop.
If your cluster is not Docker Desktop Kubernetes, push the image to a registry
that the cluster can reach instead.
'@
}
$safeName = $Image -replace '[/:]', '-'
$tar = Join-Path $env:TEMP "$safeName.tar"

Write-Host "Saving $Image ..." -ForegroundColor Cyan
docker save $Image -o $tar
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tar)) { throw 'docker save failed.' }

try {
  # docker cp silently no-ops into Docker Desktop's hidden kind node, so
  # stream the archive through docker exec stdin instead.
  Write-Host "Streaming image archive to $node ..." -ForegroundColor Cyan
  cmd /c "type ""$tar"" | docker exec -i $node sh -c ""cat > /tmp/$safeName.tar"""
  if ($LASTEXITCODE -ne 0) { throw 'Streaming the image archive failed.' }

  Write-Host 'Importing into the k8s.io containerd namespace ...' -ForegroundColor Cyan
  docker exec $node ctr -n k8s.io images import "/tmp/$safeName.tar"
  if ($LASTEXITCODE -ne 0) { throw 'ctr images import failed.' }
  docker exec $node rm -f "/tmp/$safeName.tar" *> $null

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
