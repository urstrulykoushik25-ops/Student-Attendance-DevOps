#Requires -Version 5.1
<#
.SYNOPSIS
  Installs dependencies, seeds demo data and starts AttendX locally.
#>
[CmdletBinding()]
param(
  [switch]$NoSeed
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required. Install Node.js 24 or newer.'
}

$nodeVersion = (node --version).TrimStart('v')
if ([version]$nodeVersion -lt [version]'24.0.0') {
  throw "Node.js 24 or newer is required (found $nodeVersion)."
}

if (-not (Test-Path 'node_modules')) {
  Write-Host 'Installing npm dependencies...' -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
}

if (-not $NoSeed) {
  Write-Host 'Seeding demo data (safe to run more than once)...' -ForegroundColor Cyan
  npm run seed
}

$env:SEED_DEMO = 'true'
Write-Host ''
Write-Host 'Starting AttendX at http://localhost:3000' -ForegroundColor Green
Write-Host 'Press Ctrl+C to stop.'
npm start
