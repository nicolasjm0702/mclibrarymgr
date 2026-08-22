$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$identifier = (Select-String -Path conf.yml -Pattern 'identifier:\s*"?([^"]+)"?' | Select-Object -First 1).Matches[0].Groups[1].Value
$out = Join-Path $PSScriptRoot "$identifier.blueprint"

if (Test-Path $out) { Remove-Item $out -Force }

$excludeDirs = @('.git', '.claude', '.dist')
$excludeFiles = @('build.sh', 'build.ps1')

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
    Get-ChildItem -Recurse -File -Force | ForEach-Object {
        $rel = $_.FullName.Substring($PSScriptRoot.Length + 1)
        $relUnix = $rel -replace '\\', '/'
        $topDir = $relUnix.Split('/')[0]

        if ($excludeDirs -contains $topDir) { return }
        if ($rel -notmatch '/|\\' -and $excludeFiles -contains $_.Name) { return }
        if ($_.Extension -eq '.blueprint') { return }

        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relUnix) | Out-Null
    }
}
finally {
    $zip.Dispose()
}

Write-Host "Built $identifier.blueprint"
