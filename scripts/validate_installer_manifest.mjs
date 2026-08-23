#!/usr/bin/env node
/**
 * scripts/validate_installer_manifest.mjs
 * Validates Tauri NSIS Windows installer configuration and bundle integrity invariants.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tauriConfPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");

function validate() {
  console.log("Validating Tauri NSIS Installer Manifest...");
  if (!fs.existsSync(tauriConfPath)) {
    console.error("FAIL: src-tauri/tauri.conf.json does not exist");
    process.exit(1);
  }

  const conf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
  const errors = [];

  if (conf.productName !== "Mereth Reader") {
    errors.push(`Expected productName "Mereth Reader", got "${conf.productName}"`);
  }
  if (conf.identifier !== "dev.mereth.reader") {
    errors.push(`Expected identifier "dev.mereth.reader", got "${conf.identifier}"`);
  }
  if (!conf.bundle?.active) {
    errors.push("Expected bundle.active to be true");
  }
  if (!Array.isArray(conf.bundle?.targets) || !conf.bundle.targets.includes("nsis")) {
    errors.push("Expected bundle.targets to include nsis");
  }
  if (conf.bundle?.windows?.nsis?.installMode !== "currentUser") {
    errors.push(`Expected bundle.windows.nsis.installMode to be "currentUser", got "${conf.bundle?.windows?.nsis?.installMode}"`);
  }
  
  const fileAssoc = conf.bundle?.fileAssociations;
  if (!Array.isArray(fileAssoc) || fileAssoc.length === 0) {
    errors.push("Expected bundle.fileAssociations to be defined");
  } else {
    const pdfAssoc = fileAssoc.find(a => a.ext && a.ext.includes("pdf"));
    if (!pdfAssoc) {
      errors.push("Expected bundle.fileAssociations to register pdf extension");
    }
  }

  const windowConf = conf.app?.windows?.[0];
  if (!windowConf || windowConf.minWidth < 1024 || windowConf.minHeight < 640) {
    errors.push("Expected window minWidth >= 1024 and minHeight >= 640 for deterministic layout");
  }

  if (errors.length > 0) {
    console.error("Validation failed with errors:");
    for (const err of errors) {
      console.error(" - " + err);
    }
    process.exit(1);
  }

  console.log("PASS: NSIS installer manifest and Tauri configuration are valid!");
}

validate();
