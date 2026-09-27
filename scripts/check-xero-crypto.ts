/** Self-check for Xero token encryption: npx tsx --conditions=react-server scripts/check-xero-crypto.ts */
import "./env";
import assert from "node:assert/strict";
import { seal, unseal } from "../src/lib/xero/crypto";

const token = "eyJhbGciOiJSUzI1NiJ9.example-refresh-token-" + "x".repeat(500);
const sealed = seal(token);
assert.notEqual(sealed, token);
assert.ok(!sealed.includes("example-refresh-token"), "token must not appear in the stored text");
assert.equal(unseal(sealed), token);
assert.notEqual(seal(token), sealed, "each seal uses a fresh IV");
const tampered = sealed.slice(0, -3) + (sealed.endsWith("A") ? "BBB" : "AAA");
assert.throws(() => unseal(tampered), "tampered token must be rejected");
console.log("Xero token encryption checks passed.");
