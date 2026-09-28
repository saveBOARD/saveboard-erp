# Switchover from Katana — run sheet

Katana has no open purchase orders or manufacturing orders in either entity (checked by Paul, 28/9/26), so the
switchover loads four exports per entity: customers, inventory, quotes and open sales orders.

## Until switchover day
- Keep trading in Katana. Don't ship, receive, adjust stock or complete manufacturing orders in the live app:
  the final stock import refuses to run once the app has real stock movements.
- Quotes, customers, products, recipes and draft purchase/manufacturing orders can be set up in the app freely.

## On the day
1. **Freeze Katana.** Finish the day's dispatches and mark them shipped in Katana. From here, no changes in Katana.
2. **Export from Katana, for NZ and then AUS** (switch Katana to the entity each time). Save each file in the
   `saveBOARD ERP system` folder, with the entity at the front of the name:
   | Katana screen | Save as |
   |---|---|
   | Stock → Inventory → download | `NZ InventoryItems-<date>.xlsx` |
   | Sell → Quotes → download | `NZ SalesOrders-<date>.xlsx` |
   | Sell → Sales orders → Open → download | `NZ OpenSalesOrders-<date>.xlsx` |
   | Sell → Customers → export for editing | `NZ katana_customers_edit_<date>.xlsx` (optional) |
   | Sell → Sales orders → Done → download | `NZ DoneSalesOrders-<date>.xlsx` (optional: completed orders for Sell → Sales orders → Done and the sales reports) |
3. **Load them.** The script takes the newest file of each kind:
   - rehearsal on the local copy: `powershell -ExecutionPolicy Bypass -File scripts/switchover.ps1`
   - live: `powershell -ExecutionPolicy Bypass -File scripts/switchover.ps1 -Target prod`

   In order, per entity: customers → stock (replaces opening stock; negatives set to 0; costs set by hand kept) →
   quotes → open orders → close anything from earlier imports that has since finished in Katana → completed
   orders (Done: loaded as Closed, with a Katana delivery record and no stock movement) and the sales-report history
   → expire quotes over a year old. Every step is safe to repeat, so if one fails, fix it and run the script again.
4. **Check against Katana** (the script prints these):
   - stock value per entity = Katana's inventory value (as at the export time)
   - number of open orders and their totals ("all totals match Katana")
   - spot-check two or three products' stock and one open order in the app.
5. **Start trading in the app.** Ship, receive and invoice from the app from now on. Katana stays read-only for
   reference until the subscription ends.
