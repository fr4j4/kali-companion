#!/usr/bin/env node
import { readFileSync } from "fs";

const en = JSON.parse(readFileSync("kali-web/src/locale/en/common.json", "utf8"));
const es = JSON.parse(readFileSync("kali-web/src/locale/es/common.json", "utf8"));

const enKeys = Object.keys(en).sort();
const esKeys = Object.keys(es).sort();

let errors = 0;

const missingInEs = enKeys.filter(k => !esKeys.includes(k));
const missingInEn = esKeys.filter(k => !enKeys.includes(k));

if (missingInEs.length) {
  console.error(`Keys in EN but missing in ES: ${missingInEs.join(", ")}`);
  errors++;
}
if (missingInEn.length) {
  console.error(`Keys in ES but missing in EN: ${missingInEn.join(", ")}`);
  errors++;
}

for (const [k, v] of Object.entries(en)) {
  if (v === "") { console.error(`Empty value in EN: ${k}`); errors++; }
}
for (const [k, v] of Object.entries(es)) {
  if (v === "") { console.error(`Empty value in ES: ${k}`); errors++; }
}

if (errors === 0) console.log("i18n check passed ✓");
process.exit(errors > 0 ? 1 : 0);
