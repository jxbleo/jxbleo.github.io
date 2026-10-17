"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const {ROOT, SEALED, privatePath, contentKey, unseal} = require("./handout-store");
const {SOURCE, renderTopicBank} = require("./render-topic-bank");

// Refresh this one source without importing unrelated private handout drafts.
const files = unseal();
const source = fs.readFileSync(privatePath(ROOT, "source/" + SOURCE), "utf8");
renderTopicBank({[SOURCE]: source});
files[SOURCE] = source;
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", contentKey(), iv);
cipher.setAAD(Buffer.from("mrcat-independent-handouts-v1"));
const ciphertext = Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(JSON.stringify(files)))), cipher.final()]);
const sealed = {schemaVersion: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64")};
// Authenticate and bound the new payload before replacing the previous source.
const decipher = crypto.createDecipheriv("aes-256-gcm", contentKey(), iv);
decipher.setAAD(Buffer.from("mrcat-independent-handouts-v1"));
decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
const checked = JSON.parse(zlib.gunzipSync(Buffer.concat([decipher.update(ciphertext), decipher.final()]), {maxOutputLength: 12 * 1024 * 1024}));
if (JSON.stringify(checked) !== JSON.stringify(files)) throw new Error("Topic-bank source authentication failed.");
fs.writeFileSync(path.join(ROOT, SEALED), JSON.stringify(sealed) + "\n");
console.log("Topic-bank encrypted source refreshed; other handout sources and link identities preserved. No deployment performed.");
