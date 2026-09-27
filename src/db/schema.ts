import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Quantities and money: numeric so totals never drift. Drizzle returns these as strings.
const qty = (name: string) => numeric(name, { precision: 16, scale: 4 });
const money = (name: string) => numeric(name, { precision: 16, scale: 4 });

/** NZ and AUS. Everything business-related hangs off an entity and never crosses to the other. */
export const entities = pgTable("entities", {
  id: text("id").primaryKey(), // "NZ" | "AUS"
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  currency: text("currency").notNull(),
  gstRate: numeric("gst_rate", { precision: 5, scale: 4 }).notNull(),
  locationName: text("location_name").notNull(),
  businessNumberLabel: text("business_number_label").notNull(), // NZBN / ABN
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  active: boolean("active").notNull().default(true),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export const userEntities = pgTable(
  "user_entities",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull().references(() => entities.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.entityId] })],
);

/** Per-entity document numbering (SO, PO, MO, SA, STK), continuing from Katana. */
export const numberSequences = pgTable(
  "number_sequences",
  {
    entityId: text("entity_id").notNull().references(() => entities.id),
    kind: text("kind").notNull(),
    prefix: text("prefix").notNull(),
    nextValue: integer("next_value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.kind] })],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    leadTimeDays: integer("lead_time_days"),
    paymentTerms: text("payment_terms"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("suppliers_entity_name").on(t.entityId, t.name)],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    code: text("code"),
    name: text("name").notNull(),
    billingLine1: text("billing_line1"),
    billingLine2: text("billing_line2"),
    billingCity: text("billing_city"),
    billingRegion: text("billing_region"),
    billingPostcode: text("billing_postcode"),
    billingCountry: text("billing_country"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    businessNumber: text("business_number"),
    paymentTerms: text("payment_terms"),
    priceTier: text("price_tier"),
    creditLimit: money("credit_limit"),
    creditHold: boolean("credit_hold").notNull().default(false),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    xeroContactId: text("xero_contact_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("customers_entity_name").on(t.entityId, t.name)],
);

/** Delivery sites: a customer can have many. */
export const customerSites = pgTable("customer_sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  line1: text("line1"),
  line2: text("line2"),
  city: text("city"),
  region: text("region"),
  postcode: text("postcode"),
  country: text("country"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  isDefault: boolean("is_default").notNull().default(false),
  ...timestamps,
});

export const productType = pgEnum("product_type", ["product", "material", "service"]);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    type: productType("type").notNull().default("product"),
    category: text("category"),
    uom: text("uom"),
    standardCost: money("standard_cost").notNull().default("0"),
    defaultSupplierId: uuid("default_supplier_id").references(() => suppliers.id),
    trackStock: boolean("track_stock").notNull().default(true),
    safetyStock: qty("safety_stock").notNull().default("0"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("products_entity_sku").on(t.entityId, t.sku)],
);

export const movementKind = pgEnum("movement_kind", [
  "opening",
  "receipt",
  "production_output",
  "production_consume",
  "shipment",
  "adjustment",
  "return",
]);

/** The stock ledger. On hand = SUM(qty). Rows are never edited; corrections are new rows. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    kind: movementKind("kind").notNull(),
    qty: qty("qty").notNull(),
    unitCost: money("unit_cost"),
    batchNo: text("batch_no"),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    refNumber: text("ref_number"),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_movements_entity_product").on(t.entityId, t.productId),
    index("stock_movements_batch").on(t.entityId, t.batchNo),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    userId: uuid("user_id").references(() => users.id),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("audit_log_record").on(t.tableName, t.recordId)],
);
