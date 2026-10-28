#Requires -Version 5.1
<#
.SYNOPSIS
  Triggers the AttendX Jenkins pipeline and optionally waits for its result.
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://localhost:8080',
  [string]$Job = 'student-attendance-pipeline',
  [string]$User = 'admin',
  [string]$Password = 'admin123',
  [switch]$NoWait,
  [int]$TimeoutSeconds = 900
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$pair = "${User}:${Password}"
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$headers = @{ Authorization = "Basic $auth" }
# Jenkins binds CSRF crumbs to the HTTP session. Keep the cookies from the
# crumb request and send them with the build trigger, otherwise Jenkins
# answers 403 "No valid crumb was included in the request".
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Invoke-JenkinsApi {
  param([string]$Path, [string]$Method = 'GET')
  Invoke-RestMethod -Uri "$BaseUrl$Path" -Method $Method -Headers $headers `
    -WebSession $session -TimeoutSec 30
}

Write-Host "Connecting to Jenkins at $BaseUrl ..." -ForegroundColor Cyan
$crumb = Invoke-JenkinsApi -Path '/crumbIssuer/api/json'
$headers[$crumb.crumbRequestField] = $crumb.crumb

$previous = $null
try {
  $previous = (Invoke-JenkinsApi -Path "/job/$Job/api/json?tree=lastBuild[number]").lastBuild.number
} catch {
  $previous = $null
}

Write-Host "Triggering $Job ..." -ForegroundColor Cyan
Invoke-JenkinsApi -Path "/job/$Job/build" -Method 'POST' | Out-Null

if ($NoWait) {
  Write-Host "Build queued. Open $BaseUrl/job/$Job/ to follow it." -ForegroundColor Green
  exit 0
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$build = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  try {
    $info = Invoke-JenkinsApi -Path "/job/$Job/lastBuild/api/json?tree=number,building,result,url"
  } catch {
    continue
  }
  if ($null -eq $info.number) { continue }
  if ($null -ne $previous -and $info.number -le $previous) { continue }
  $build = $info
  Write-Host "Build #$($info.number): building=$($info.building) result=$($info.result)" -ForegroundColor DarkGray
  if (-not $info.building) { break }
}

if (-not $build) {
  throw "Timed out waiting for build #$previous + 1."
}

Write-Host ""
Write-Host "Build #$($build.number) finished with result: $($build.result)" -ForegroundColor $(if ($build.result -eq 'SUCCESS') { 'Green' } else { 'Red' })
Write-Host "Details: $($build.url)" -ForegroundColor Cyan
if ($build.result -ne 'SUCCESS') {
  exit 1
}
