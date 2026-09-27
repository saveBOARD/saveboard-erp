/** Dev/pre-go-live only: clears document number sequences so the next `db:import` recalculates them. */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { createDb } from "../src/db/client";
import { numberSequences } from "../src/db/schema";

createDb()
  .delete(numberSequences)
  .then(() => {
    console.log("Number sequences cleared.");
    process.exit(0);
  });
