CREATE TABLE "sales_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"so_number" text NOT NULL,
	"title" text,
	"customer_name" text NOT NULL,
	"customer_id" uuid,
	"order_date" date NOT NULL,
	"shipped_on" date,
	"product_id" uuid,
	"sku" text,
	"description" text NOT NULL,
	"category" text,
	"qty" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 4) NOT NULL,
	"discount_pct" numeric(7, 4) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"subtotal" numeric(16, 4) NOT NULL,
	"currency" text NOT NULL,
	"customer_ref" text
);
--> statement-breakpoint
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_history_entity_date" ON "sales_history" USING btree ("entity_id","shipped_on");--> statement-breakpoint
CREATE INDEX "sales_history_entity_so" ON "sales_history" USING btree ("entity_id","so_number");--> statement-breakpoint
ALTER TABLE "sales_history" ENABLE ROW LEVEL SECURITY;
