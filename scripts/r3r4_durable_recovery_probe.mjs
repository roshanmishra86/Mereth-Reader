// Node-only integration probe for the production AutosaveCoordinator. Uses a
// disk-backed Storage adapter; this is not a benchmark of Tauri/SQLite latency.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

function syncDirectory(path) {
  if (process.platform === 'win32') return; // Windows cannot fs.openSync directories.
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function atomicWrite(path, contents) {
  const temp = `${path}.tmp`;
  const fd = openSync(temp, 'w');
  try { writeFileSync(fd, contents, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
  syncDirectory(dirname(path));
}

async function child(mode, directory, modulePath) {
  const { AutosaveCoordinator, getRecoverableDraft } = await import(pathToFileURL(modulePath).href);
  const storage = {
    getItem(key) { const path = join(directory, `${encodeURIComponent(key)}.json`); return existsSync(path) ? readFileSync(path, 'utf8') : null; },
    setItem(key, value) { atomicWrite(join(directory, `${encodeURIComponent(key)}.json`), value); },
    removeItem(key) { const path = join(directory, `${encodeURIComponent(key)}.json`); if (existsSync(path)) unlinkSync(path); syncDirectory(directory); },
  };
  const noteId = 'durable-probe-note';
  const notePath = join(directory, 'persisted-note.json');
  const persist = async (id, title, bodyMarkdown) => atomicWrite(notePath, JSON.stringify({ id, title, bodyMarkdown }));
  const coordinator = new AutosaveCoordinator(60_000, storage);
  if (mode === 'writer') {
    coordinator.enqueue(noteId, 'Crash-safe draft', 'Draft before process restart', persist);
    assert.equal(existsSync(notePath), false);
    assert.equal(getRecoverableDraft(noteId, storage)?.bodyMarkdown, 'Draft before process restart');
    process.exit(0); // No flush/dispose: terminate before debounce.
  }
  const recovered = getRecoverableDraft(noteId, storage);
  assert.equal(recovered?.bodyMarkdown, 'Draft before process restart');
  coordinator.enqueue(noteId, recovered.title, recovered.bodyMarkdown, persist);
  await coordinator.flush(noteId, persist);
  assert.equal(JSON.parse(readFileSync(notePath, 'utf8')).bodyMarkdown, recovered.bodyMarkdown);
  assert.equal(getRecoverableDraft(noteId, storage), null);
  const timings = [];
  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    await coordinator.replace(noteId, recovered.title, recovered.bodyMarkdown, persist);
    timings.push(performance.now() - start);
  }
  process.stdout.write(JSON.stringify({ durableRestartRecovery: true, durableAutosaveMedianMs: timings.sort((a, b) => a - b)[12] }));
}

if (process.argv[2] === 'writer' || process.argv[2] === 'recovery') {
  await child(process.argv[2], process.argv[3], process.argv[4]);
} else {
  const directory = mkdtempSync(join(tmpdir(), 'mereth-durable-probe-'));
  try {
    const ts = (await import('typescript')).default;
    const source = readFileSync(new URL('../src/utils/noteRevisions.ts', import.meta.url), 'utf8');
    const modulePath = join(directory, 'noteRevisions.mjs');
    writeFileSync(modulePath, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    const runChild = (mode) => {
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), mode, directory, modulePath], { encoding: 'utf8', timeout: 30_000 });
      if (result.error || result.status !== 0) throw new Error(`Probe ${mode} failed: ${result.error?.message ?? result.stderr}`);
      return result.stdout;
    };
    runChild('writer');
    const report = JSON.parse(runChild('recovery'));
    assert.equal(JSON.parse(readFileSync(join(directory, 'persisted-note.json'), 'utf8')).bodyMarkdown, 'Draft before process restart');
    console.log(JSON.stringify({ ...report, persistence: 'atomic-file-fsync', childProcesses: 2, tauriSqliteMeasured: false }, null, 2));
  } finally {
    rmSync(directory, { recursive: true, force: true }); // Only our newly created probe directory.
  }
}
