# FortenLog Interactive Setup Script (Windows PowerShell)

Write-Host "--------------------------------------------------" -ForegroundColor Cyan
Write-Host "   FortenLog Infrastructure Setup Engine v1.0" -ForegroundColor Cyan
Write-Host "--------------------------------------------------" -ForegroundColor Cyan

# Default Values
$DEFAULT_PORT = "3000"
$DEFAULT_DOMAIN = "localhost"
$DEFAULT_ADMIN = "admin"
$DEFAULT_PASS = "fortenlog2026"

# Prompt for Configuration
$PORT = Read-Host "Enter Deployment Port [$DEFAULT_PORT]"
if (-not $PORT) { $PORT = $DEFAULT_PORT }

$DOMAIN = Read-Host "Enter Domain/Hostname [$DEFAULT_DOMAIN]"
if (-not $DOMAIN) { $DOMAIN = $DEFAULT_DOMAIN }

$ADMIN = Read-Host "Enter Initial Admin Username [$DEFAULT_ADMIN]"
if (-not $ADMIN) { $ADMIN = $DEFAULT_ADMIN }

$PASS = Read-Host "Enter Initial Admin Password [$DEFAULT_PASS]"
if (-not $PASS) { $PASS = $DEFAULT_PASS }

# Create .env file
$EnvContent = @"
PORT=$PORT
DOMAIN=$DOMAIN
FORTENLOG_ADMIN_USER=$ADMIN
FORTENLOG_ADMIN_PASS=$PASS
RUST_LOG=info
"@

$EnvContent | Out-File -FilePath .env -Encoding ascii

Write-Host "--------------------------------------------------"
Write-Host "Configuration saved to .env"
Write-Host "Deploying via Docker Compose..."
Write-Host "--------------------------------------------------"

docker-compose up -d --build

Write-Host ""
Write-Host "Deployment Successful!" -ForegroundColor Green
Write-Host "Access Platform at: http://$DOMAIN:$PORT"
Write-Host "Initial Credentials: $ADMIN / $PASS"
Write-Host "--------------------------------------------------"
