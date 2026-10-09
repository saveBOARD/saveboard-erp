import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
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
  // Printed on quotes, order acknowledgements and packing slips (Settings > Company details)
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  taxNumber: text("tax_number"), // GST number / ABN
  quoteTerms: text("quote_terms"),
  /** How invoices are coded in this entity's Xero organisation (chosen in Settings → Xero). Null = the defaults. */
  xeroAccountCode: text("xero_account_code"), // sales account code, e.g. "200"
  xeroTaxIncome: text("xero_tax_income"), // tax rate name for GST lines, e.g. "15% GST on Income"
  xeroTaxZero: text("xero_tax_zero"), // tax rate name for zero-rated lines, e.g. "Zero Rated"
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
    priceTier: text("price_tier"), // legacy text from the workbooks; replaced by priceListId
    priceListId: uuid("price_list_id").references(() => priceLists.id), // null = the entity's default list
    creditLimit: money("credit_limit"),
    creditHold: boolean("credit_hold").notNull().default(false),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    /** Deleted in the app (no longer trading / no longer a customer). Kept only so past orders keep their customer. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
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
    /** True once someone sets the cost in the app; Katana imports then leave it alone. */
    costSetManually: boolean("cost_set_manually").notNull().default(false),
    defaultSupplierId: uuid("default_supplier_id").references(() => suppliers.id),
    trackStock: boolean("track_stock").notNull().default(true),
    safetyStock: qty("safety_stock").notNull().default("0"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("products_entity_sku").on(t.entityId, t.sku)],
);

/**
 * Selling price lists (ex GST, entity currency). One per entity is the default ("Standard"); customers without a
 * list use it. A list can also be "default less/plus N%" (adjustPct, e.g. -0.15), with its own prices overriding.
 */
export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    adjustPct: numeric("adjust_pct", { precision: 7, scale: 4 }), // -0.15 = 15% below the default list
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("price_lists_entity_name").on(t.entityId, t.name)],
);

export const priceListItems = pgTable(
  "price_list_items",
  {
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    price: money("price").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.priceListId, t.productId] }), index("price_list_items_product").on(t.productId)],
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

/**
 * Quotes and sales orders are one table: a quote is an order in status "quote" and keeps its number
 * when converted (Katana style).
 */
export const orderStatus = pgEnum("order_status", ["quote", "open", "picked", "shipped", "invoiced", "closed", "cancelled"]);
export const quoteStatus = pgEnum("quote_status", ["draft", "sent", "accepted", "declined", "expired"]);

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    number: text("number").notNull(), // "SO-1586" (Katana imports may be "QSO-151")
    title: text("title"), // Katana's text after the number, e.g. "Chris Tramix"
    status: orderStatus("status").notNull(),
    quoteStatus: quoteStatus("quote_status"),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    customerReference: text("customer_reference"),
    orderDate: date("order_date").notNull(),
    deliveryDeadline: date("delivery_deadline"),
    quoteExpiresOn: date("quote_expires_on"),
    shipToName: text("ship_to_name"),
    shipToPhone: text("ship_to_phone"),
    shipToLine1: text("ship_to_line1"),
    shipToLine2: text("ship_to_line2"),
    shipToCity: text("ship_to_city"),
    shipToRegion: text("ship_to_region"),
    shipToPostcode: text("ship_to_postcode"),
    shipToCountry: text("ship_to_country"),
    notes: text("notes"),
    /** Price list used to price this quote / order (starts as the customer's list; can be changed per document). */
    priceListId: uuid("price_list_id").references(() => priceLists.id, { onDelete: "set null" }),
    currency: text("currency").notNull(),
    /** Entity currency per 1 unit of the order currency (1 unless e.g. a USD export order). */
    fxRate: numeric("fx_rate", { precision: 14, scale: 6 }).notNull().default("1"),
    subtotal: money("subtotal").notNull().default("0"),
    tax: money("tax").notNull().default("0"),
    total: money("total").notNull().default("0"),
    /** Set when the order is marked Invoiced (invoice date and due date sent to Xero). */
    invoicedOn: date("invoiced_on"),
    invoiceDueOn: date("invoice_due_on"),
    /** Xero invoice created through the live connection, and its status/payment as last read back. */
    xeroInvoiceId: text("xero_invoice_id"),
    xeroStatus: text("xero_status"), // DRAFT | SUBMITTED | AUTHORISED | PAID | VOIDED | DELETED
    xeroAmountDue: money("xero_amount_due"),
    xeroAmountPaid: money("xero_amount_paid"),
    xeroSyncedAt: timestamp("xero_synced_at", { withTimezone: true }),
    source: text("source").notNull().default("app"), // "app" | "katana"
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("sales_orders_entity_number").on(t.entityId, t.number),
    index("sales_orders_entity_status").on(t.entityId, t.status),
    index("sales_orders_customer").on(t.customerId),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").references(() => products.id), // null for free-text lines (e.g. freight quotes)
    sku: text("sku"),
    description: text("description").notNull(),
    qty: qty("qty").notNull(),
    unitPrice: money("unit_price").notNull(),
    discountPct: numeric("discount_pct", { precision: 7, scale: 4 }).notNull().default("0"), // 0.10 = 10%
    taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull(), // 0.15 = 15%
    lineSubtotal: money("line_subtotal").notNull(), // qty x price x (1 - discount), ex tax
    lineTax: money("line_tax").notNull(),
    batchNo: text("batch_no"), // recorded when picked / shipped (traceability)
    ...timestamps,
  },
  (t) => [index("order_lines_order").on(t.orderId), index("order_lines_product").on(t.productId)],
);

/**
 * A shipment sends some or all of an order's outstanding quantities. An order can have several (partial
 * shipments). A reversed shipment stays on record; its stock is put back by reversing movements.
 */
export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id),
    seq: integer("seq").notNull(), // SO-1586/1, SO-1586/2 …
    shippedOn: date("shipped_on").notNull(),
    carrier: text("carrier"),
    consignmentNo: text("consignment_no"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shipments_order_seq").on(t.orderId, t.seq)],
);

export const shipmentLines = pgTable(
  "shipment_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id), // no cascade: a shipped line can't be deleted
    productId: uuid("product_id").references(() => products.id),
    qty: qty("qty").notNull(),
    batchNo: text("batch_no"),
  },
  (t) => [index("shipment_lines_shipment").on(t.shipmentId), index("shipment_lines_order_line").on(t.orderLineId), index("shipment_lines_batch").on(t.batchNo)],
);

/**
 * Sales already shipped in Katana (one row per order line), for reports only: never shown as orders and never
 * moves stock. Replaced per entity by each import of a Katana "done" sales orders export.
 */
export const salesHistory = pgTable(
  "sales_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    soNumber: text("so_number").notNull(), // "SO-706" (Katana's text after the number is in title)
    title: text("title"),
    customerName: text("customer_name").notNull(),
    customerId: uuid("customer_id").references(() => customers.id), // matched on name at import
    orderDate: date("order_date").notNull(),
    shippedOn: date("shipped_on"), // Katana's "SO picked date"
    productId: uuid("product_id").references(() => products.id),
    sku: text("sku"),
    description: text("description").notNull(),
    category: text("category"),
    qty: qty("qty").notNull(),
    unitPrice: money("unit_price").notNull(),
    discountPct: numeric("discount_pct", { precision: 7, scale: 4 }).notNull().default("0"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull().default("0"),
    subtotal: money("subtotal").notNull(), // ex tax, order currency
    currency: text("currency").notNull(),
    customerRef: text("customer_ref"),
  },
  (t) => [index("sales_history_entity_date").on(t.entityId, t.shippedOn), index("sales_history_entity_so").on(t.entityId, t.soNumber)],
);

export const returnStatus = pgEnum("return_status", ["open", "received", "cancelled"]);

/**
 * A customer return (RET-…) against a shipped sales order. Open = waiting for the goods; Received = goods back
 * (restock lines added to stock with "return" movements). Its credit note (same number) goes to Xero via the
 * invoicing CSV; the amounts are in the order's currency, ex tax per line like the order.
 */
export const salesReturns = pgTable(
  "sales_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    number: text("number").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    status: returnStatus("status").notNull().default("open"),
    returnDate: date("return_date").notNull(), // date raised
    receivedOn: date("received_on"),
    notes: text("notes"),
    currency: text("currency").notNull(),
    subtotal: money("subtotal").notNull().default("0"),
    tax: money("tax").notNull().default("0"),
    total: money("total").notNull().default("0"),
    creditedOn: date("credited_on"), // set when the credit note is exported to Xero
    xeroCreditNoteId: text("xero_credit_note_id"),
    xeroStatus: text("xero_status"),
    xeroSyncedAt: timestamp("xero_synced_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    receivedBy: uuid("received_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("sales_returns_entity_number").on(t.entityId, t.number), index("sales_returns_order").on(t.orderId)],
);

export const returnLines = pgTable(
  "return_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => salesReturns.id, { onDelete: "cascade" }),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").references(() => products.id),
    sku: text("sku"),
    description: text("description").notNull(),
    qty: qty("qty").notNull(),
    unitPrice: money("unit_price").notNull(), // credit per unit, ex tax, after the order line's discount
    taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull(),
    lineSubtotal: money("line_subtotal").notNull(),
    lineTax: money("line_tax").notNull(),
    restock: boolean("restock").notNull().default(true), // false = damaged/written off: credit only, no stock back
    reason: text("reason"),
    batchNo: text("batch_no"),
  },
  (t) => [index("return_lines_return").on(t.returnId), index("return_lines_order_line").on(t.orderLineId)],
);

/** A stock adjustment (SA-…): manual +/- corrections. Posted immediately; never edited — reversed instead. */
export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    number: text("number").notNull(),
    adjustedOn: date("adjusted_on").notNull(),
    reason: text("reason").notNull(),
    notes: text("notes"),
    stocktakeId: uuid("stocktake_id"), // set when created by completing a stocktake
    reversesId: uuid("reverses_id"), // set on a reversing adjustment
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stock_adjustments_entity_number").on(t.entityId, t.number)],
);

export const stockAdjustmentLines = pgTable(
  "stock_adjustment_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adjustmentId: uuid("adjustment_id")
      .notNull()
      .references(() => stockAdjustments.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    qty: qty("qty").notNull(), // signed: + adds stock, - removes it
    unitCost: money("unit_cost").notNull(),
    batchNo: text("batch_no"),
    note: text("note"),
  },
  (t) => [index("stock_adjustment_lines_adjustment").on(t.adjustmentId)],
);

export const stocktakeStatus = pgEnum("stocktake_status", ["counting", "completed", "cancelled"]);

/** A stocktake (STK-…): expected quantities frozen at the start, counts entered, differences posted as one adjustment. */
export const stocktakes = pgTable(
  "stocktakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    number: text("number").notNull(),
    reason: text("reason").notNull(),
    scope: text("scope").notNull(), // what was counted, e.g. "All stock items", "Materials", "Category: Multi-use Panel"
    status: stocktakeStatus("status").notNull().default("counting"),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    adjustmentId: uuid("adjustment_id").references(() => stockAdjustments.id),
    createdBy: uuid("created_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stocktakes_entity_number").on(t.entityId, t.number)],
);

export const stocktakeLines = pgTable(
  "stocktake_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stocktakeId: uuid("stocktake_id")
      .notNull()
      .references(() => stocktakes.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    expectedQty: qty("expected_qty").notNull(), // on hand when the stocktake started
    countedQty: qty("counted_qty"), // null = not counted yet
    note: text("note"),
    countedBy: uuid("counted_by").references(() => users.id),
    countedAt: timestamp("counted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("stocktake_lines_item").on(t.stocktakeId, t.productId)],
);

export const poStatus = pgEnum("po_status", ["draft", "open", "received", "cancelled"]);

/** Purchase order to a supplier. Draft -> open (placed) -> received (automatically when every line has arrived). */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    number: text("number").notNull(), // PO-23
    title: text("title"), // Katana style reference after the number, e.g. "White LDPE"
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    status: poStatus("status").notNull().default("draft"),
    billed: boolean("billed").notNull().default(false),
    orderDate: date("order_date").notNull(),
    expectedOn: date("expected_on"),
    currency: text("currency").notNull(),
    fxRate: numeric("fx_rate", { precision: 14, scale: 6 }).notNull().default("1"), // entity currency per 1 PO currency
    notes: text("notes"),
    subtotal: money("subtotal").notNull().default("0"),
    tax: money("tax").notNull().default("0"),
    total: money("total").notNull().default("0"),
    source: text("source").notNull().default("app"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("purchase_orders_entity_number").on(t.entityId, t.number), index("purchase_orders_supplier").on(t.supplierId)],
);

export const poLines = pgTable(
  "po_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").references(() => products.id),
    sku: text("sku"),
    description: text("description").notNull(),
    qty: qty("qty").notNull(),
    unitPrice: money("unit_price").notNull(), // in the PO currency
    taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull(),
    lineSubtotal: money("line_subtotal").notNull(),
    lineTax: money("line_tax").notNull(),
    ...timestamps,
  },
  (t) => [index("po_lines_po").on(t.poId), index("po_lines_product").on(t.productId)],
);

/** A delivery received against a PO (PO-23/1, PO-23/2 …). Adds stock. Reversed receipts stay on record. */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    seq: integer("seq").notNull(),
    receivedOn: date("received_on").notNull(),
    supplierRef: text("supplier_ref"), // delivery docket / packing slip number
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("goods_receipts_po_seq").on(t.poId, t.seq)],
);

export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    poLineId: uuid("po_line_id")
      .notNull()
      .references(() => poLines.id), // no cascade: a received line can't be deleted
    productId: uuid("product_id").references(() => products.id),
    qty: qty("qty").notNull(),
    unitCost: money("unit_cost").notNull(), // in the entity currency
    batchNo: text("batch_no"),
  },
  (t) => [index("goods_receipt_lines_receipt").on(t.receiptId), index("goods_receipt_lines_po_line").on(t.poLineId)],
);

/** Recipe (bill of materials) for a finished product: materials per 1 unit made. */
export const recipeLines = pgTable(
  "recipe_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }), // the finished product
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => products.id),
    qtyPerUnit: qty("qty_per_unit").notNull(),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("recipe_lines_product").on(t.productId)],
);

/** Production operations for a product (labour, machine time): hours per 1 unit x cost per hour. */
export const recipeOperations = pgTable(
  "recipe_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hoursPerUnit: qty("hours_per_unit").notNull(),
    costPerHour: money("cost_per_hour").notNull().default("0"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("recipe_operations_product").on(t.productId)],
);

export const moStatus = pgEnum("mo_status", ["not_started", "in_progress", "done", "cancelled"]);

/** Manufacturing order (MO-…): makes a product; completing it uses materials and adds finished stock. */
export const manufacturingOrders = pgTable(
  "manufacturing_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    number: text("number").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    plannedQty: qty("planned_qty").notNull(),
    actualQty: qty("actual_qty"), // set on completion
    status: moStatus("status").notNull().default("not_started"),
    productionDeadline: date("production_deadline"),
    deliveryDeadline: date("delivery_deadline"),
    salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
    batchNo: text("batch_no"), // batch of the finished goods
    notes: text("notes"),
    materialsCost: money("materials_cost").notNull().default("0"), // planned until done, then actual
    operationsCost: money("operations_cost").notNull().default("0"),
    createdBy: uuid("created_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("mo_entity_number").on(t.entityId, t.number), index("mo_entity_status").on(t.entityId, t.status)],
);

export const moMaterials = pgTable(
  "mo_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moId: uuid("mo_id")
      .notNull()
      .references(() => manufacturingOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    plannedQty: qty("planned_qty").notNull(),
    actualQty: qty("actual_qty"),
    unitCost: money("unit_cost"), // standard cost when completed
    batchNo: text("batch_no"), // batch consumed
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("mo_materials_mo").on(t.moId)],
);

export const moOperations = pgTable(
  "mo_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moId: uuid("mo_id")
      .notNull()
      .references(() => manufacturingOrders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    plannedHours: qty("planned_hours").notNull(),
    actualHours: qty("actual_hours"),
    costPerHour: money("cost_per_hour").notNull().default("0"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("mo_operations_mo").on(t.moId)],
);

/**
 * The live Xero link for an entity (one Xero organisation each). Tokens are encrypted (src/lib/xero/crypto.ts);
 * the refresh token rotates on every refresh and lasts 60 days unused.
 */
export const xeroConnections = pgTable("xero_connections", {
  entityId: text("entity_id")
    .primaryKey()
    .references(() => entities.id),
  tenantId: text("tenant_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  connectionId: text("connection_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scopes: text("scopes"),
  connectedBy: uuid("connected_by").references(() => users.id),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** What was sent to / read from Xero, and any error Xero returned. */
export const xeroSyncLog = pgTable(
  "xero_sync_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    kind: text("kind").notNull(), // invoice | credit_note | contact | refresh | connect
    recordId: text("record_id"),
    docNumber: text("doc_number"),
    ok: boolean("ok").notNull(),
    message: text("message"),
    userId: uuid("user_id").references(() => users.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("xero_sync_log_entity_at").on(t.entityId, t.at)],
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
