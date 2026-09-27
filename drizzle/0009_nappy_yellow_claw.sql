CREATE TYPE "public"."mo_status" AS ENUM('not_started', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "manufacturing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"number" text NOT NULL,
	"product_id" uuid NOT NULL,
	"planned_qty" numeric(16, 4) NOT NULL,
	"actual_qty" numeric(16, 4),
	"status" "mo_status" DEFAULT 'not_started' NOT NULL,
	"production_deadline" date,
	"delivery_deadline" date,
	"sales_order_id" uuid,
	"batch_no" text,
	"notes" text,
	"materials_cost" numeric(16, 4) DEFAULT '0' NOT NULL,
	"operations_cost" numeric(16, 4) DEFAULT '0' NOT NULL,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mo_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mo_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"planned_qty" numeric(16, 4) NOT NULL,
	"actual_qty" numeric(16, 4),
	"unit_cost" numeric(16, 4),
	"batch_no" text,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mo_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mo_id" uuid NOT NULL,
	"name" text NOT NULL,
	"planned_hours" numeric(16, 4) NOT NULL,
	"actual_hours" numeric(16, 4),
	"cost_per_hour" numeric(16, 4) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"qty_per_unit" numeric(16, 4) NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hours_per_unit" numeric(16, 4) NOT NULL,
	"cost_per_hour" numeric(16, 4) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mo_materials" ADD CONSTRAINT "mo_materials_mo_id_manufacturing_orders_id_fk" FOREIGN KEY ("mo_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mo_materials" ADD CONSTRAINT "mo_materials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mo_operations" ADD CONSTRAINT "mo_operations_mo_id_manufacturing_orders_id_fk" FOREIGN KEY ("mo_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_ingredient_id_products_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_operations" ADD CONSTRAINT "recipe_operations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mo_entity_number" ON "manufacturing_orders" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "mo_entity_status" ON "manufacturing_orders" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "mo_materials_mo" ON "mo_materials" USING btree ("mo_id");--> statement-breakpoint
CREATE INDEX "mo_operations_mo" ON "mo_operations" USING btree ("mo_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_product" ON "recipe_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "recipe_operations_product" ON "recipe_operations" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "recipe_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mo_materials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mo_operations" ENABLE ROW LEVEL SECURITY;
