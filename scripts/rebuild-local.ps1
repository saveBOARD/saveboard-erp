# Rebuilds the LOCAL development database (.data/pglite) from the same sources as the live one.
# Stop `npm run dev` first. Never touches Supabase.
#   powershell -ExecutionPolicy Bypass -File scripts/rebuild-local.ps1
$ErrorActionPreference = "Continue" # warnings on stderr are fine; failures are caught by exit code below
Set-Location (Split-Path $PSScriptRoot)
if (Test-Path .data/pglite) { Remove-Item -Recurse -Force .data/pglite }

function Run([string[]]$cmd) {
  Write-Host "> $($cmd -join ' ')" -ForegroundColor Cyan
  & npx @cmd 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -match "^(NZ|AUS)|Migrated|Created|Seed|rror|cost|expired|No open" }
  if ($LASTEXITCODE -ne 0) { throw "Failed: $($cmd -join ' ')" }
}

Run @("tsx", "scripts/migrate.ts")
Run @("tsx", "scripts/seed.ts")
Run @("tsx", "scripts/import-workbooks.ts")
# Katana customer details (contacts, emails, addresses, delivery sites) — before the order imports so they match names
Run @("tsx", "scripts/import-katana-customers.ts", "NZ", "../NZ katana_customers_edit_2026-09-27.xlsx", "--apply")
# Manually corrected AUS costs (27/9/26) — set before the inventory import so it keeps them
foreach ($c in @(@("SPRS", "1.05"), @("SBEXPMULTI129002400GRNPAP", "35"), @("SBEXPMULTI129952400DWHTPAP", "47"), @("SBEXP1012002400BLKPAP", "55"),
                 @("SBEXP1012003000BLKPAP", "35"), @("Nine Dragon Testliner - KP BF3.5", "0.9"), @("SBEXPMULTI1212002400CLRBLK", "23.91"), @("SB_R&D BOARD", "50"))) {
  Run @("tsx", "scripts/set-cost.ts", "AUS", $c[0], $c[1])
}
Run @("tsx", "scripts/import-katana-inventory.ts", "NZ", "../NZ InventoryItems-2026-09-27-16_53.xlsx")
Run @("tsx", "scripts/import-katana-inventory.ts", "AUS", "../AUS InventoryItems-2026-09-27-16_50.xlsx")
Run @("tsx", "scripts/import-katana-sales.ts", "AUS", "../AUS SalesOrders-2026-09-27-16_03.xlsx")
Run @("tsx", "scripts/import-katana-sales.ts", "NZ", "../NZ SalesOrders-2026-09-27-16_18.xlsx")
Run @("tsx", "scripts/import-katana-sales.ts", "NZ", "../NZ OpenSalesOrders-2026-09-27-16_29.xlsx")
Run @("tsx", "scripts/import-katana-sales.ts", "AUS", "../AUS OpenSalesOrders-2026-09-27-16_31.xlsx")
Run @("tsx", "scripts/expire-quotes.ts", "365")
# Katana completed orders (Sell > Sales orders > Done) as Closed orders, and the same lines for the sales reports
foreach ($d in @(@("NZ", "../NZ DoneSalesOrders-2026-09-29-10_07.xlsx"), @("AUS", "../AUS DoneSalesOrders-2026-09-29-10_11.xlsx"))) {
  Run @("tsx", "scripts/import-katana-done.ts", $d[0], $d[1])
  Run @("tsx", "scripts/import-sales-history.ts", $d[0], $d[1])
}
Write-Host "Local database rebuilt." -ForegroundColor Green
