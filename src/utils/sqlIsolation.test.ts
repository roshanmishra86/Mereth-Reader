import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Task 3.1 — "SQL is never exposed to the webview" (PRD §15.3): database
// access lives entirely in the Rust crate behind typed IPC commands; the
// webview must never contain SQL strings. This suite pins that contract
// mechanically so a pull request that smuggles `SELECT ...` or a raw query
// builder into the frontend fails CI instead of shipping (the same
// checkable-invariant approach as designPackage.test.ts).
//
// The patterns are deliberately case-sensitive uppercase statement heads:
// legitimate camelCase JavaScript ("setUpdate", "createTable") cannot match,
// while a real SQL string ("INSERT INTO notes ...") always does.

const SQL_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'SELECT', re: /\bSELECT\b/ },
  { label: 'INSERT INTO', re: /\bINSERT\s+INTO\b/ },
  { label: 'UPDATE ... SET', re: /\bUPDATE\b[^\n;]{0,120}\bSET\b/ },
  { label: 'DELETE FROM', re: /\bDELETE\s+FROM\b/ },
  { label: 'CREATE TABLE', re: /\bCREATE\s+(?:VIRTUAL\s+)?TABLE\b/ },
  { label: 'CREATE INDEX', re: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/ },
  { label: 'ALTER TABLE', re: /\bALTER\s+TABLE\b/ },
  { label: 'DROP TABLE', re: /\bDROP\s+TABLE\b/ },
  { label: 'PRAGMA', re: /\bPRAGMA\b/ },
  { label: 'ON CONFLICT', re: /\bON\s+CONFLICT\b/ },
  { label: 'ATTACH', re: /\bATTACH\b/ },
];

const srcRoot = path.resolve(process.cwd(), 'src');

// The guard file itself necessarily quotes the banned patterns as literals,
// so it is excluded from its own scan — the contract it enforces is about
// application code, not about this meta-test's pattern table.
const SELF_FILENAME = 'sqlIsolation.test.ts';

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && entry.name !== SELF_FILENAME) {
      out.push(full);
    }
  }
  return out;
}

const FAST_CANDIDATE = /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|ON|ATTACH)\b/;

describe('3.1 SQL isolation from the webview', () => {
  it('no frontend source file contains executable SQL', async () => {
    const files = collectSourceFiles(srcRoot);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    await Promise.all(
      files.map(async (file) => {
        const content = await fs.promises.readFile(file, 'utf-8');
        if (!FAST_CANDIDATE.test(content)) {
          return;
        }
        const rel = path.relative(process.cwd(), file);
        for (const { label, re } of SQL_PATTERNS) {
          const match = re.exec(content);
          if (match) {
            const line = content.slice(0, match.index).split('\n').length;
            const snippet = content
              .split('\n')
              .slice(Math.max(0, line - 2), line + 1)
              .map((s) => s.trim())
              .join(' | ')
              .slice(0, 200);
            violations.push(`${rel}:${line} (${label}): …${snippet}…`);
          }
        }
      })
    );

    expect(violations, `SQL strings must not live in the webview\n${violations.join('\n')}`).toEqual([]);
  }, 30_000);
});
