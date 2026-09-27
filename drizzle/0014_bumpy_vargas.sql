CREATE TABLE "xero_connections" (
	"entity_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text NOT NULL,
	"connection_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" text,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xero_sync_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"record_id" text,
	"doc_number" text,
	"ok" boolean NOT NULL,
	"message" text,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "xero_invoice_id" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "xero_status" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "xero_amount_due" numeric(16, 4);--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "xero_amount_paid" numeric(16, 4);--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "xero_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "xero_credit_note_id" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "xero_status" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "xero_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "xero_connections" ADD CONSTRAINT "xero_connections_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_connections" ADD CONSTRAINT "xero_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_sync_log" ADD CONSTRAINT "xero_sync_log_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_sync_log" ADD CONSTRAINT "xero_sync_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "xero_sync_log_entity_at" ON "xero_sync_log" USING btree ("entity_id","at");--> statement-breakpoint
ALTER TABLE "xero_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "xero_sync_log" ENABLE ROW LEVEL SECURITY;