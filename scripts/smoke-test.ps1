#Requires -Version 5.1
<#
.SYNOPSIS
  Runs a quick smoke test against a running AttendX instance.
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://localhost:3000'
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')

function Test-Endpoint {
  param([string]$Name, [string]$Path)
  try {
    $response = Invoke-WebRequest -Uri "$BaseUrl$Path" -UseBasicParsing -TimeoutSec 10
    Write-Host ("[PASS] {0,-24} {1} {2}" -f $Name, $response.StatusCode, $Path) -ForegroundColor Green
    return $response
  } catch {
    Write-Host ("[FAIL] {0,-24} {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red
    throw
  }
}

Test-Endpoint -Name 'Health' -Path '/api/health' | Out-Null
$students = Test-Endpoint -Name 'Students API' -Path '/api/students'
Test-Endpoint -Name 'Dashboard API' -Path '/api/dashboard' | Out-Null
Test-Endpoint -Name 'Monthly report API' -Path '/api/reports/monthly' | Out-Null
Test-Endpoint -Name 'Dashboard page' -Path '/' | Out-Null
Test-Endpoint -Name 'Attendance page' -Path '/attendance.html' | Out-Null
Test-Endpoint -Name 'Reports page' -Path '/reports.html' | Out-Null

$studentCount = ($students.Content | ConvertFrom-Json).total
Write-Host ""
Write-Host "Smoke test passed for $BaseUrl ($studentCount students)." -ForegroundColor Green
