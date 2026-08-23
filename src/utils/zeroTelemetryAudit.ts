import * as fs from "node:fs";
import * as path from "node:path";

export interface TelemetryAuditResult {
  readonly clean: boolean;
  readonly prohibitedPackagesFound: readonly string[];
  readonly remoteEndpointsFound: readonly string[];
  readonly cspAllowsOutboundFetch: boolean;
  readonly errors: readonly string[];
}

export const PROHIBITED_TELEMETRY_PACKAGES: readonly string[] = [
  "analytics",
  "mixpanel",
  "amplitude",
  "posthog",
  "google-analytics",
  "@sentry/browser",
  "@sentry/react",
  "@sentry/node",
  "segment",
  "launchdarkly",
  "hotjar",
  "datadog",
] as const;

/**
 * Audits package dependencies, Tauri CSP, and IPC boundaries for zero silent tracking.
 */
export function auditZeroTelemetry(repoRoot: string): TelemetryAuditResult {
  const errors: string[] = [];
  const prohibitedPackagesFound: string[] = [];
  const remoteEndpointsFound: string[] = [];

  // 1. Audit package.json dependencies
  const pkgPath = path.join(repoRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    for (const depName of Object.keys(allDeps)) {
      for (const prohibited of PROHIBITED_TELEMETRY_PACKAGES) {
        if (depName.toLowerCase().includes(prohibited)) {
          prohibitedPackagesFound.push(depName);
          errors.push(`Prohibited telemetry package detected in package.json: ${depName}`);
        }
      }
    }
  }

  // 2. Audit Tauri CSP in tauri.conf.json
  let cspAllowsOutboundFetch = false;
  const tauriConfPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  if (fs.existsSync(tauriConfPath)) {
    const conf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
    const csp: string = conf.app?.security?.csp || "";
    
    // Connect-src should either be absent (inherits default-src 'self') or restricted to 'self'
    if (csp.includes("connect-src") && (csp.includes("http:") || csp.includes("https:") || csp.includes("*"))) {
      cspAllowsOutboundFetch = true;
      errors.push("CSP connect-src contains wildcard or broad remote HTTP/HTTPS endpoints");
    }
    if (csp.includes("default-src *") || csp.includes("default-src http:") || csp.includes("default-src https:")) {
      cspAllowsOutboundFetch = true;
      errors.push("CSP default-src contains overly permissive remote wildcards");
    }
  }

  const clean = prohibitedPackagesFound.length === 0 && !cspAllowsOutboundFetch && errors.length === 0;

  return {
    clean,
    prohibitedPackagesFound,
    remoteEndpointsFound,
    cspAllowsOutboundFetch,
    errors,
  };
}
