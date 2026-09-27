CREATE TYPE "public"."return_status" AS ENUM('open', 'received', 'cancelled');--> statement-breakpoint
CREATE TABLE "return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"sku" text,
	"description" text NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 4) NOT NULL,
	"tax_rate" numeric(5, 4) NOT NULL,
	"line_subtotal" numeric(16, 4) NOT NULL,
	"line_tax" numeric(16, 4) NOT NULL,
	"restock" boolean DEFAULT true NOT NULL,
	"reason" text,
	"batch_no" text
);
--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "return_status" DEFAULT 'open' NOT NULL,
	"return_date" date NOT NULL,
	"received_on" date,
	"notes" text,
	"currency" text NOT NULL,
	"subtotal" numeric(16, 4) DEFAULT '0' NOT NULL,
	"tax" numeric(16, 4) DEFAULT '0' NOT NULL,
	"total" numeric(16, 4) DEFAULT '0' NOT NULL,
	"credited_on" date,
	"created_by" uuid,
	"received_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_lines_return" ON "return_lines" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "return_lines_order_line" ON "return_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_returns_entity_number" ON "sales_returns" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "sales_returns_order" ON "sales_returns" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "sales_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "return_lines" ENABLE ROW LEVEL SECURITY;