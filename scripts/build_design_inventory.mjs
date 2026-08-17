#!/usr/bin/env node
// Generates docs/design/interaction-inventory.md from the mockup source
// (task 0.5). The inventory is extracted from mock-up/Reader Prototype.dc.html
// so it can never drift from the design it describes; the narrative sections
// are static text maintained here.
//
// Requires: mock-up/ present (developer machine only). Output is committed so
// CI and reviewers can consume the inventory without the design source.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const mockupPath = path.join(root, 'mock-up', 'Reader Prototype.dc.html');
const outPath = path.join(root, 'docs', 'design', 'interaction-inventory.md');

if (!fs.existsSync(mockupPath)) {
  console.error('mock-up/ not found — run on a machine with the design source (task 0.5).');
  process.exit(1);
}

const html = fs.readFileSync(mockupPath, 'utf-8');
const sha = crypto.createHash('sha256').update(html).digest('hex');

const strip = (s) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// --- Interaction handlers bound via onClick="{{ h.<name> }}" -----------------
const handlers = new Map(); // name -> { count, labels: Map<label, count>, firstSite }
const onClickRe = /onClick="\{\{\s*h\.(\w+)\s*\}\}"/g;
let m;
while ((m = onClickRe.exec(html)) !== null) {
  const name = m[1];
  const siteStart = html.indexOf('>', m.index) + 1;
  const label = strip(html.slice(siteStart, siteStart + 700)).slice(0, 90) || '(no visible label)';
  if (!handlers.has(name)) {
    handlers.set(name, { count: 0, labels: new Map(), firstSite: m.index });
  }
  const entry = handlers.get(name);
  entry.count += 1;
  entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1);
}

// --- Handler registry from the component script ------------------------------
// The h: block is one handler per line and closes with a lone `}` line, so it
// can be parsed line-wise without juggling braces.
const scriptIdx = html.indexOf('h: {');
const registry = new Map(); // name -> action
if (scriptIdx !== -1) {
  const lines = html.slice(scriptIdx).split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*}\s*$/.test(line)) break;
    const hm = line.match(/^\s+(\w+):\s*\(\)\s*=>\s*(.*?)\s*,?\s*$/);
    if (hm) registry.set(hm[1], hm[2].trim());
  }
}

// --- Initial state -----------------------------------------------------------
const stateMatch = html.match(/this\.state\s*=\s*\{([\s\S]*?)\n\s*\};/);
const state = new Map();
if (stateMatch) {
  const re = /^\s{4,}(\w+):\s*([^,\n]+),?$/gm;
  let sm;
  while ((sm = re.exec(stateMatch[1])) !== null) {
    state.set(sm[1], sm[2].trim());
  }
}

// --- Variation-axis props (Tweaks) -------------------------------------------
const propsMatch = html.match(/data-props="([^"]+)"/);
let props = null;
if (propsMatch) {
  try {
    props = JSON.parse(propsMatch[1].replace(/&quot;/g, '"').replace(/&gt;/g, '>'));
  } catch {
    props = { parseError: true };
  }
}

// --- Native inputs ------------------------------------------------------------
const inputs = [];
const inputRe = /<input[^>]*>/g;
while ((m = inputRe.exec(html)) !== null) {
  const tag = m[0];
  inputs.push({
    type: tag.match(/type="([^"]*)"/)?.[1] ?? 'text',
    className: tag.match(/class="([^"]*)"/)?.[1] ?? '',
    value: tag.match(/value="([^"]*)"/)?.[1] ?? '',
    placeholder: tag.match(/placeholder="([^"]*)"/)?.[1] ?? '',
  });
}

// --- Tooltips (title attributes) ----------------------------------------------
const tooltips = new Map(); // title -> count
const titleRe = /title="([^"]+)"/g;
while ((m = titleRe.exec(html)) !== null) {
  tooltips.set(m[1], (tooltips.get(m[1]) ?? 0) + 1);
}

// --- Button labels ------------------------------------------------------------
const buttons = new Map(); // label -> count
const buttonRe = /<button[^>]*>([\s\S]*?)<\/button>/g;
while ((m = buttonRe.exec(html)) !== null) {
  const label = strip(m[1]) || '(icon-only)';
  buttons.set(label, (buttons.get(label) ?? 0) + 1);
}

const md = [];
const push = (s = '') => md.push(s);

push('# Mereth Reader — interaction & state inventory');
push('');
push('Generated from the design source of truth by `scripts/build_design_inventory.mjs`.');
push('');
push(`- Source: \`mock-up/Reader Prototype.dc.html\` (SHA-256 \`${sha}\`)`);
push(`- Render engine: \`support.js\` (x-dc design-doc runtime)`);
push('- Live canvas: `docs/design/screenshots/` at 1440×900 and 1024×640 (mockup window presets)');
push('- Token source: `docs/design/_ds/modernist-8bbe1904-81ef-4318-9bb4-642c31744443/`');
push('');
push('## Presentation');
push('');
push('The mockup is a design-doc canvas, not the shipped app: the document renders a mock application window (title bar, app rail, destination views) inside a frame with a window-size switcher (1440×900, 1920×1080, 1024×640) and a "How to drive it" help panel. All five destinations live in the one file and switch in place via the app rail. Interactive elements are `div`/`span` actors in the mockup; the shipped app must use native controls (U24).');
push('');
push('## Destinations (app rail)');
push('');
push('| Destination | Handler | What the view shows |');
push('| --- | --- | --- |');
push('| Library | `dLibrary` | Document table (Title, Author, Ownership, Ann., Notes, Due, Last read), recents/favourites/collections/archive, "Open a PDF" and import actions |');
push('| Reader | `dReader` | Three-zone reader: outline/pages left panel, document canvas, annotations/note/AI right panel; toolbar with page number, search, view mode, zoom, reading-only |');
push('| Notes | `dNotes` | Concept/source/scratch note grouping, backlinks, "Prompts from this note", Quick Copy |');
push('| Review | `dReview` | FSRS-style review run: "Card N of M · budget · elapsed", attempt-before-reveal, Again/Hard/Good/Easy |');
push('| Settings | `dSettings` | Section list (Appearance, Reading, Annotations, Review, AI & privacy, Storage, Export, Shortcuts) |');
push('');
push('## Interaction handlers');
push('');
push('Extracted from the component script (`h:` registry) with the number of bound elements in the document and the first visible label found at a binding site. Handlers are the complete interaction surface of the mockup.');
push('');
push('| Handler | Action | Bindings | First label at a binding site |');
push('| --- | --- | --- | --- |');
for (const name of [...registry.keys()].sort()) {
  const entry = handlers.get(name) ?? { count: 0, labels: new Map() };
  const firstLabel = [...entry.labels.keys()][0] ?? '—';
  push(`| \`${name}\` | \`${registry.get(name)}\` | ${entry.count} | ${firstLabel} |`);
}
const orphanHandlers = [...handlers.keys()].filter((n) => !registry.has(n)).sort();
if (orphanHandlers.length > 0) {
  push('');
  push('Bound but not in the script registry (expected for template variables):');
  push('');
  push(orphanHandlers.map((n) => `- \`${n}\``).join('\n'));
  push('');
}

push('## Initial state');
push('');
push('| Key | Default |');
push('| --- | --- |');
for (const [k, v] of state) {
  push(`| \`${k}\` | \`${v}\` |`);
}
push('');
push('> U25: the `aiOn` *prop* defaults to `true`, so the mockup opens with the Local AI chip on while the Settings page claims "Everything here is off by default". The v1 reference state is AI off and every AI surface below is R5-only (`docs/design/r5-ai-surfaces.md`).');
push('');

push('## Variation axes (Tweaks props)');
push('');
if (props && !props.parseError) {
  for (const [name, def] of Object.entries(props)) {
    const options = Array.isArray(def.options) ? def.options.map((o) => `\`${o}\``).join(', ') : def.editor;
    push(`- **\`${name}\`** (${def.section}) — ${def.tsType === 'boolean' ? 'boolean' : `options: ${options}`}, default \`${String(def.default)}\`.`);
  }
} else {
  push('(props block could not be parsed)');
}
push('');

push('## Form fields (native inputs)');
push('');
push('| Type | Class | Value | Placeholder |');
push('| --- | --- | --- | --- |');
for (const i of inputs) {
  push(`| ${i.type} | ${i.className || '—'} | ${i.value || '—'} | ${i.placeholder || '—'} |`);
}
push('');

push('## Buttons');
push('');
push('| Label | Count |');
push('| --- | --- |');
for (const [label, c] of [...buttons.entries()].sort((a, b) => b[1] - a[1])) {
  push(`| ${label === '(icon-only)' ? '*icon-only*' : label} | ${c} |`);
}
push('');

push('## Tooltips (title attributes)');
push('');
for (const [t, c] of [...tooltips.entries()].sort((a, b) => b[1] - a[1])) {
  push(`- "${t}" × ${c}`);
}
push('');

push('## Measured totals');
push('');
const totalHandlers = registry.size;
const totalBindings = [...handlers.values()].reduce((s, h) => s + h.count, 0);
push(`- Handler registry entries: ${totalHandlers}`);
push(`- Elements bound to handlers: ${totalBindings}`);
push(`- Button elements: ${buttons.size} distinct labels (${[...buttons.values()].reduce((s, c) => s + c, 0)} total)`);
push(`- Native inputs: ${inputs.length}`);
push(`- Unique tooltips: ${tooltips.size}`);
push('- "~153 distinct labelled controls" (2026-08-01 audit) counted labelled interactive controls; the generated tables above are the authoritative current count and distribution.');

fs.writeFileSync(outPath, md.join('\n'));
console.log(`wrote ${outPath}`);
