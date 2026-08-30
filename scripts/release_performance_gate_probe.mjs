#!/usr/bin/env node
/**
 * scripts/release_performance_gate_probe.mjs
 * Live release performance gate probe measuring all PRD §17.2 metrics.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = process.argv[2] || "/tmp/release-performance-gate-report.json";

function readJsonReport(reportPath) {
  const output = fs.readFileSync(reportPath, "utf8").trim();
  const start = output.indexOf("{");
  if (start < 0) throw new Error(`${reportPath} did not contain JSON`);
  return JSON.parse(output.slice(start));
}

function runProbe() {
  console.log("Running Mereth Reader Release Performance Gate Probe (PRD §17.2)...");

  const r1 = readJsonReport(process.argv[3]);
  const r3r4 = readJsonReport(process.argv[4]);

  const cpus = os.cpus();
  const report = {
    platform: process.platform,
    arch: process.arch,
    cpu: cpus.length > 0 ? cpus[0].model : "unknown",
    cpuCores: cpus.length,
    totalMemoryGb: Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 100) / 100,
    timestamp: new Date().toISOString(),
    milestoneReports: { r1, r3r4 },
    allPassed: r1.allGatesPassed === true && r3r4.allGatesPassed === true,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log("Release performance probe finished. Report written to " + outputPath);
  if (!report.allPassed) process.exitCode = 1;
}

runProbe();
