# Agent Marketplace - Windows PowerShell Installer
# Run: powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  +======================================+" -ForegroundColor Cyan
Write-Host "  |   Agent Marketplace - Easy Setup     |" -ForegroundColor Cyan
Write-Host "  +======================================+" -ForegroundColor Cyan
Write-Host ""

# -- Step 1: Check Node.js --
Write-Host "  [1/5] Checking Node.js..." -ForegroundColor White
try {
    $nodeVersion = (node -v 2>$null)
    if ($nodeVersion) {
        $major = [int]($nodeVersion -replace 'v','').Split('.')[0]
        if ($major -lt 18) {
            Write-Host ""
            Write-Host "  ERROR: Node.js v18+ is required (you have $nodeVersion)" -ForegroundColor Red
            Write-Host ""
            Write-Host "  Download the latest version from: https://nodejs.org/en/download" -ForegroundColor Yellow
            Write-Host ""
            Read-Host "  Press Enter to exit"
            exit 1
        }
        Write-Host "  Found Node.js $nodeVersion" -ForegroundColor Green
    } else {
        throw "not found"
    }
} catch {
    Write-Host ""
    Write-Host "  ERROR: Node.js is not installed." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Download it from: https://nodejs.org/en/download" -ForegroundColor Yellow
    Write-Host "  (Choose the LTS version, run the installer, then try again)" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "  Press Enter to exit"
    exit 1
}

# -- Step 2: Get the code --
$installDir = Join-Path $env:USERPROFILE "agent-marketplace"

if (Test-Path $installDir) {
    Write-Host "  [2/5] Updating existing installation..." -ForegroundColor White
    Set-Location $installDir
    if (Test-Path ".git") {
        try { git pull --quiet 2>$null } catch {}
    }
} else {
    Write-Host "  [2/5] Downloading Agent Marketplace..." -ForegroundColor White
    try {
        $gitVersion = git --version 2>$null
        if ($gitVersion) {
            git clone --quiet https://github.com/SCJedi/agent-marketplace.git $installDir
        } else {
            throw "no git"
        }
    } catch {
        Write-Host "  (git not found, downloading zip...)" -ForegroundColor Yellow
        $zipPath = Join-Path $env:TEMP "am-download.zip"
        $extractPath = Join-Path $env:TEMP "am-extract"
        Invoke-WebRequest -Uri "https://github.com/SCJedi/agent-marketplace/archive/refs/heads/master.zip" -OutFile $zipPath
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
        Move-Item (Join-Path $extractPath "agent-marketplace-master") $installDir
        Remove-Item $zipPath -Force
        Remove-Item $extractPath -Recurse -Force
    }
}

Set-Location $installDir

# -- Step 3: Install dependencies --
Write-Host "  [3/5] Installing dependencies..." -ForegroundColor White
npm install --quiet 2>$null

# -- Step 4: Create default config --
Write-Host "  [4/5] Setting up configuration..." -ForegroundColor White
$dataDir = Join-Path $installDir "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

# -- Step 5: Start the node --
Write-Host "  [5/5] Starting your node..." -ForegroundColor White
Write-Host ""

# Start the server
$serverProcess = Start-Process -FilePath "node" -ArgumentList "src/server.js" -WorkingDirectory $installDir -PassThru -NoNewWindow

# Wait for server to come up
$attempts = 0
while ($attempts -lt 20) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 2 -UseBasicParsing 2>$null
        if ($response.StatusCode -eq 200) { break }
    } catch {}
    Start-Sleep -Milliseconds 500
    $attempts++
}

# Open browser
Start-Process "http://localhost:3001/dashboard"

Write-Host ""
Write-Host "  +======================================+" -ForegroundColor Green
Write-Host "  |  Your node is running!               |" -ForegroundColor Green
Write-Host "  |                                      |" -ForegroundColor Green
Write-Host "  |  Dashboard: http://localhost:3001/dashboard" -ForegroundColor Green
Write-Host "  |                                      |" -ForegroundColor Green
Write-Host "  |  Close this window to stop.          |" -ForegroundColor Green
Write-Host "  +======================================+" -ForegroundColor Green
Write-Host ""

# Keep window open - wait for the server process
try {
    $serverProcess.WaitForExit()
} catch {
    Write-Host "  Server stopped." -ForegroundColor Yellow
}
