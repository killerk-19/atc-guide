// Encrypts src/ (app code + data) into vault.bin. Credentials come from a gitignored file
// (.vault-credentials: line 1 username, line 2 password) or the path given as argv[2] — never
// from argv itself, so they stay out of shell history and process listings.
// Usage: node tools/build_vault.mjs [credentials-file] [--allow-weak]
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const allowWeak = args.includes("--allow-weak");
const credPath = args.find((a) => !a.startsWith("--")) || join(root, ".vault-credentials");
const [user, password] = readFileSync(credPath, "utf8").split(/\r?\n/);
if (!user || !password) throw new Error("credentials file needs 2 lines: username, password");
if (password.length < 12) {
  const msg = "password under 12 characters — vault.bin is public, so an offline guesser can try every short or dictionary password";
  if (!allowWeak) throw new Error(msg + " (override with --allow-weak)");
  console.warn("WARNING:", msg);
}

const SALT = Buffer.from(readFileSync(join(root, "js/lock.js"), "utf8").match(/atob\("([^"]+)"\)/)[1], "base64");
const ITERATIONS = Number(readFileSync(join(root, "js/lock.js"), "utf8").match(/ITERATIONS = (\d+)/)[1]);

const files = {
  "js/app.js": readFileSync(join(root, "src/app.js"), "utf8"),
  "data/guide.json": readFileSync(join(root, "src/guide.json"), "utf8"),
  "data/paycheck.json": readFileSync(join(root, "src/paycheck.json"), "utf8"),
};

const { subtle } = webcrypto;
const base = await subtle.importKey("raw", new TextEncoder().encode(user.trim().toLowerCase() + "\n" + password), "PBKDF2", false, ["deriveKey"]);
const key = await subtle.deriveKey({ name: "PBKDF2", salt: SALT, iterations: ITERATIONS, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(files))));
writeFileSync(join(root, "vault.bin"), Buffer.concat([Buffer.from("ATCV1"), Buffer.from(iv), Buffer.from(ct)]));
console.log("vault.bin written,", ct.length, "bytes");
