# Download the evaluation feeds and Tranco list, then build the allowlist, the labelled dataset and the brand
# reference assets. Each step runs even if an earlier one failed; a summary is printed at the end.
#
# Usage (from anywhere): powershell -ExecutionPolicy Bypass -File scripts\setup_data.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PYTHONIOENCODING = 'utf-8'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Python = Join-Path $Root '.venv\Scripts\python.exe'
$Feeds = Join-Path $Root 'data\runtime\feeds'
$TrancoDir = Join-Path $Root 'data\runtime\tranco'
$TrancoZip = Join-Path $Root 'data\runtime\tranco.zip'
$TrancoCsv = Join-Path $TrancoDir 'top-1m.csv'

$Results = New-Object System.Collections.Generic.List[object]
$FailedBrands = New-Object System.Collections.Generic.List[string]

function Invoke-Python {
    param([string[]]$Arguments)
    $output = & $Python @Arguments
    $code = $LASTEXITCODE
    $output | ForEach-Object { Write-Host "    $_" }
    if ($code -ne 0) { throw "python exited with code $code" }
    return $output
}

function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    try {
        & $Action
        Write-Host "OK: $Name" -ForegroundColor Green
        $Results.Add([pscustomobject]@{ Step = $Name; Ok = $true; Reason = '' })
    }
    catch {
        $reason = $_.Exception.Message
        Write-Host "FAILED: $Name - $reason" -ForegroundColor Red
        $Results.Add([pscustomobject]@{ Step = $Name; Ok = $false; Reason = $reason })
    }
}

if (-not (Test-Path $Python)) {
    Write-Host "FAILED: setup - $Python not found. Create the venv first (py -3.12 -m venv .venv)." -ForegroundColor Red
    exit 1
}
New-Item -ItemType Directory -Force $Feeds, $TrancoDir | Out-Null

Invoke-Step 'Download OpenPhish feed' {
    Invoke-WebRequest 'https://openphish.com/feed.txt' -OutFile (Join-Path $Feeds 'openphish.txt') -UseBasicParsing
}

Invoke-Step 'Download Phishing.Database active links' {
    Invoke-WebRequest 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-links-ACTIVE.txt' `
        -OutFile (Join-Path $Feeds 'phishing-links-ACTIVE.txt') -UseBasicParsing
}

Invoke-Step 'Download Tranco top 1M' {
    Invoke-WebRequest 'https://tranco-list.eu/top-1m.csv.zip' -OutFile $TrancoZip -UseBasicParsing
    Expand-Archive $TrancoZip $TrancoDir -Force
    if (-not (Test-Path $TrancoCsv)) { throw "top-1m.csv was not found in the archive" }
}

Invoke-Step 'Build allowlist' {
    if (-not (Test-Path $TrancoCsv)) { throw "Tranco list missing; the download step failed" }
    Invoke-Python @('scripts\build_allowlist.py', $TrancoCsv) | Out-Null
}

Invoke-Step 'Build labelled dataset' {
    $arguments = @('scripts\build_dataset.py')
    $openphish = Join-Path $Feeds 'openphish.txt'
    $phishdb = Join-Path $Feeds 'phishing-links-ACTIVE.txt'
    if (Test-Path $openphish) { $arguments += @('--openphish', $openphish) }
    if (Test-Path $phishdb) { $arguments += @('--phishdb', $phishdb) }
    if (Test-Path $TrancoCsv) { $arguments += @('--tranco', $TrancoCsv) }
    if ($arguments.Count -eq 1) { throw "no feed or Tranco files available" }
    Invoke-Python $arguments | Out-Null
}

Invoke-Step 'Capture brand assets' {
    $output = Invoke-Python @('scripts\capture_brand_assets.py')
    foreach ($line in $output) {
        if ($line -match '^FAIL\s+(\S+)') { $FailedBrands.Add($Matches[1]) }
    }
    if ($FailedBrands.Count -gt 0) { Write-Host "    $($FailedBrands.Count) brand(s) could not be captured" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "==================== Summary ====================" -ForegroundColor Cyan
foreach ($result in $Results) {
    if ($result.Ok) { Write-Host "  OK      $($result.Step)" -ForegroundColor Green }
    else { Write-Host "  FAILED  $($result.Step) - $($result.Reason)" -ForegroundColor Red }
}
if ($FailedBrands.Count -gt 0) {
    Write-Host "  Brands not captured: $($FailedBrands -join ', ')" -ForegroundColor Yellow
    Write-Host "  Save a browser screenshot as shared\brand_assets\<id>\reference.png for each of these." -ForegroundColor Yellow
}
elseif (($Results | Where-Object { $_.Step -eq 'Capture brand assets' -and $_.Ok })) {
    Write-Host "  All brands captured." -ForegroundColor Green
}
if ($Results | Where-Object { -not $_.Ok }) { exit 1 }
