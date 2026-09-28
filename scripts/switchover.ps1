# Switchover from Katana: loads Katana's FINAL exports into the app, in the right order, for NZ and AUS.
# Picks the newest export of each kind from the project's parent folder (the "saveBOARD ERP system" folder):
#   "<NZ|AUS> katana_customers_edit_*.xlsx"   Sell > Customers > export for editing   (optional)
#   "<NZ|AUS> InventoryItems-*.xlsx"          Stock > Inventory > download
#   "<NZ|AUS> SalesOrders-*.xlsx"             Sell > Quotes > download
#   "<NZ|AUS> OpenSalesOrders-*.xlsx"         Sell > Sales orders > Open > download
#   "<NZ|AUS> DoneSalesOrders-*.xlsx"         Sell > Sales orders > Done > download   (optional: completed orders + sales history)
#
#   powershell -ExecutionPolicy Bypass -File scripts/switchover.ps1                 # rehearsal on the LOCAL database
#   powershell -ExecutionPolicy Bypass -File scripts/switchover.ps1 -Target prod    # the real thing (Supabase)
#
# Stop `npm run dev` before a local run (PGlite is single-process). The inventory import refuses to run once the
# app has any real stock movements (shipments, receipts, adjustments), so run this BEFORE trading starts in the app.
# -CatchUp: for an entity that has already shipped in the app (AUS, 28/9/26): keeps those movements and sets stock to
#   Katana's figure (Katana must already include everything shipped in the app). Use with -Entities AUS.
param([ValidateSet("local", "prod")] [string]$Target = "local", [string[]]$Entities = @("NZ", "AUS"), [switch]$CatchUp)
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot)
$folder = Split-Path (Get-Location)
$prodFlag = @()
if ($Target -eq "prod") { $prodFlag = @("--prod") }

function Newest([string]$pattern) {
  Get-ChildItem -Path $folder -Filter $pattern -File |
    Where-Object { $_.Name -notmatch " - import (preview|result)" -and $_.Name -notlike "~$*" } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

function Run([string[]]$cmd) {
  Write-Host "> $($cmd -join ' ')" -ForegroundColor Cyan
  & npx @cmd @prodFlag 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -match "^(NZ|AUS)|^  |Target|rror|expired|written|Written|PREVIEW|No open|Catch-up|Kept" }
  if ($LASTEXITCODE -ne 0) { throw "Failed: $($cmd -join ' ') - stopped here; fix the problem and run the script again (every step is safe to repeat)." }
}

# 1. Work out the files first, so nothing runs unless everything needed is there.
$plan = @{}
foreach ($e in $Entities) {
  $files = @{
    customers = Newest "$e katana_customers_edit_*.xlsx"
    inventory = Newest "$e InventoryItems-*.xlsx"
    quotes    = Newest "$e SalesOrders-*.xlsx"
    open      = Newest "$e OpenSalesOrders-*.xlsx"
    history   = Newest "$e DoneSalesOrders-*.xlsx"
  }
  foreach ($k in @("inventory", "quotes", "open")) { if (-not $files[$k]) { throw "$e : no '$k' export found in $folder" } }
  $plan[$e] = $files
  Write-Host "$e files:" -ForegroundColor Yellow
  foreach ($k in @("customers", "inventory", "quotes", "open", "history")) {
    $f = $files[$k]
    if ($f) { Write-Host ("  {0,-10} {1}  (saved {2:dd/MM/yyyy HH:mm})" -f $k, $f.Name, $f.LastWriteTime) } else { Write-Host "  $k  (none - skipped)" }
  }
}
Write-Host "Target: $Target database" -ForegroundColor Yellow

# 2. Load, entity by entity.
foreach ($e in $Entities) {
  $f = $plan[$e]
  if ($f.customers) { Run @("tsx", "scripts/import-katana-customers.ts", $e, $f.customers.FullName, "--apply") }
  $inv = @("tsx", "scripts/import-katana-inventory.ts", $e, $f.inventory.FullName)
  if ($CatchUp) { $inv += "--catch-up" }
  Run $inv
  Run @("tsx", "scripts/import-katana-sales.ts", $e, $f.quotes.FullName)
  Run @("tsx", "scripts/import-katana-sales.ts", $e, $f.open.FullName)
  Run @("tsx", "scripts/close-katana-missing.ts", $e, $f.open.FullName, $f.quotes.FullName, "--apply")
  if ($f.history) {
    Run @("tsx", "scripts/import-katana-done.ts", $e, $f.history.FullName)
    Run @("tsx", "scripts/import-sales-history.ts", $e, $f.history.FullName)
  }
}
Run @("tsx", "scripts/expire-quotes.ts", "365")
Write-Host "Switchover load finished ($Target). Now check stock value and open orders against Katana." -ForegroundColor Green
