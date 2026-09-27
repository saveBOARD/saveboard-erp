/**
 * Creates the two entities and the first admin user. Safe to re-run (existing rows are left alone,
 * except the admin password, which is only set when the user is first created).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import bcrypt from "bcryptjs";
import { createDb } from "../src/db/client";
import { entities, userEntities, users } from "../src/db/schema";

const ENTITIES = [
  {
    id: "NZ",
    name: "saveBOARD NZ",
    legalName: "Upcycled Building Materials Ltd",
    currency: "NZD",
    gstRate: "0.15",
    locationName: "New Zealand",
    businessNumberLabel: "NZBN",
  },
  {
    id: "AUS",
    name: "saveBOARD AUS",
    legalName: "Upcycled Building Materials Australian Pty Ltd",
    currency: "AUD",
    gstRate: "0.10",
    locationName: "saveBOARD NSW",
    businessNumberLabel: "ABN",
  },
];

async function main() {
  const db = createDb();
  await db.insert(entities).values(ENTITIES).onConflictDoNothing();

  const username = (process.env.ADMIN_USERNAME ?? "paul").toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 10) throw new Error("Set ADMIN_PASSWORD (10+ characters) before seeding.");
  const [admin] = await db
    .insert(users)
    .values({
      username,
      displayName: process.env.ADMIN_DISPLAY_NAME ?? username,
      passwordHash: await bcrypt.hash(password, 12),
      isAdmin: true,
    })
    .onConflictDoNothing()
    .returning();
  if (admin) {
    await db
      .insert(userEntities)
      .values(ENTITIES.map((e) => ({ userId: admin.id, entityId: e.id })))
      .onConflictDoNothing();
    console.log(`Created admin user "${username}" with access to NZ and AUS.`);
  } else {
    console.log(`Admin user "${username}" already exists; password unchanged.`);
  }
  console.log("Seed complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
