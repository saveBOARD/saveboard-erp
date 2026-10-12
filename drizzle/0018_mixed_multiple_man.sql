ALTER TABLE "sales_orders" ADD COLUMN "invoice_number" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_entity_invoice_number" ON "sales_orders" USING btree ("entity_id","invoice_number");--> statement-breakpoint
-- NZ numbers its invoices separately from INV-1760 (Paul, 12/10/26); AUS keeps using the SO number.
INSERT INTO "number_sequences" ("entity_id", "kind", "prefix", "next_value") SELECT 'NZ', 'INV', 'INV-', 1760 FROM "entities" WHERE "id" = 'NZ' ON CONFLICT DO NOTHING;
