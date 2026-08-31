import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  auditZeroTelemetry,
  PROHIBITED_TELEMETRY_PACKAGES,
} from "./zeroTelemetryAudit";

describe("zeroTelemetryAudit", () => {
  const repoRoot = path.resolve(__dirname, "../..");

  it("verifies repository contains zero telemetry packages and strict offline CSP", () => {
    const audit = auditZeroTelemetry(repoRoot);
    expect(audit.clean).toBe(true);
    expect(audit.prohibitedPackagesFound).toEqual([]);
    expect(audit.cspAllowsOutboundFetch).toBe(false);
    expect(audit.remoteEndpointsFound).toEqual([
      'https://github.com/roshanmishra86/Mereth-Reader/releases/latest/download/latest.json',
    ]);
    expect(audit.errors).toEqual([]);
  });

  it("contains comprehensive prohibited telemetry package definitions", () => {
    expect(PROHIBITED_TELEMETRY_PACKAGES).toContain("analytics");
    expect(PROHIBITED_TELEMETRY_PACKAGES).toContain("posthog");
    expect(PROHIBITED_TELEMETRY_PACKAGES).toContain("mixpanel");
    expect(PROHIBITED_TELEMETRY_PACKAGES).toContain("@sentry/browser");
    expect(PROHIBITED_TELEMETRY_PACKAGES).toContain("segment");
  });
});
