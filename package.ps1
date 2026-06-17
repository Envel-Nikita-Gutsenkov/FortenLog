# Packaging script for FortenLog deployment
$DistDir = Join-Path -Path $PSScriptRoot -ChildPath "dist"

Write-Host "Packaging FortenLog deployment files..." -ForegroundColor Cyan

# Clean dist directory if it exists
if (Test-Path -Path $DistDir) {
    Remove-Item -Path $DistDir -Recurse -Force
}

# Create directories
New-Item -Path $DistDir -ItemType Directory -Force | Out-Null
New-Item -Path (Join-Path -Path $DistDir -ChildPath "deployment") -ItemType Directory -Force | Out-Null

# Copy root files
Copy-Item -Path (Join-Path -Path $PSScriptRoot -ChildPath "Dockerfile") -Destination $DistDir
Copy-Item -Path (Join-Path -Path $PSScriptRoot -ChildPath "Cargo.toml") -Destination $DistDir
Copy-Item -Path (Join-Path -Path $PSScriptRoot -ChildPath "Cargo.lock") -Destination $DistDir
Copy-Item -Path (Join-Path -Path $PSScriptRoot -ChildPath "build.rs") -Destination $DistDir

# Copy directories (excluding build files if any)
Copy-Item -Path (Join-Path -Path $PSScriptRoot -ChildPath "src") -Destination $DistDir -Recurse
Copy-Item -Path (Join-Path -Path $PSScriptRoot -ChildPath "ui") -Destination $DistDir -Recurse
Copy-Item -Path (Join-Path -Path $PSScriptRoot -ChildPath "deployment\*") -Destination (Join-Path -Path $DistDir -ChildPath "deployment") -Recurse

# Ensure all shell scripts in the dist directory use LF line endings for Linux execution compatibility
Write-Host "Normalizing line endings for Linux compatibility..." -ForegroundColor Cyan
Get-ChildItem -Path $DistDir -Filter *.sh -Recurse | ForEach-Object {
    $content = [System.IO.File]::ReadAllText($_.FullName)
    $content = $content -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($_.FullName, $content, [System.Text.UTF8Encoding]::new($false))
}

Write-Host "Deployment package successfully created in: $DistDir" -ForegroundColor Green
Write-Host "To deploy on your server:" -ForegroundColor Yellow
Write-Host "1. Upload the 'dist' folder to the server" -ForegroundColor Yellow
Write-Host "2. Run the following commands on the server:" -ForegroundColor Yellow
Write-Host "   cd dist/deployment" -ForegroundColor Yellow
Write-Host "   chmod +x prod_deploy.sh && ./prod_deploy.sh" -ForegroundColor Yellow

