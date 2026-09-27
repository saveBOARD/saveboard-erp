CREATE TYPE "public"."order_status" AS ENUM('quote', 'open', 'picked', 'shipped', 'invoiced', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"sku" text,
	"description" text NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 4) NOT NULL,
	"discount_pct" numeric(7, 4) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 4) NOT NULL,
	"line_subtotal" numeric(16, 4) NOT NULL,
	"line_tax" numeric(16, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"number" text NOT NULL,
	"title" text,
	"status" "order_status" NOT NULL,
	"quote_status" "quote_status",
	"customer_id" uuid NOT NULL,
	"customer_reference" text,
	"order_date" date NOT NULL,
	"delivery_deadline" date,
	"quote_expires_on" date,
	"ship_to_name" text,
	"ship_to_phone" text,
	"ship_to_line1" text,
	"ship_to_line2" text,
	"ship_to_city" text,
	"ship_to_region" text,
	"ship_to_postcode" text,
	"ship_to_country" text,
	"notes" text,
	"currency" text NOT NULL,
	"subtotal" numeric(16, 4) DEFAULT '0' NOT NULL,
	"tax" numeric(16, 4) DEFAULT '0' NOT NULL,
	"total" numeric(16, 4) DEFAULT '0' NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_lines_order" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_product" ON "order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_entity_number" ON "sales_orders" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "sales_orders_entity_status" ON "sales_orders" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "sales_orders_customer" ON "sales_orders" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_lines" ENABLE ROW LEVEL SECURITY;
