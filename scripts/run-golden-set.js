#!/usr/bin/env node
/**
 * Run the checker over the golden-set CSV and write what it flagged.
 *
 * Usage:
 *   node scripts/run-golden-set.js <path/to/golden-set.csv> [--split dev] [--runs 3] [--out results.csv]
 *
 * Rules from the PRD (F6) that this script enforces:
 *   - Only the dev split runs by default. Sealed stories must not be run before
 *     14 Dec (F6.6), so the "sealed" split is refused unless --allow-sealed is given.
 *   - The script never writes labels. It reads `kate_label` (Kate's own labels) only
 *     to compare, and ignores `draft_expected_flags` (Claude's drafts).
 *   - Every story runs N times (default 3) and the script reports whether the
 *     flags (rule, quote, order) were identical across runs (guardrail 2).
 *
 * The golden set itself is not in this repository; it lives in Kate's project folder.
 */
import fs from 'node:fs';
import { checkStory } from '../src/checker/index.js';
import { parseCsv } from './csv.js';

/** Quote a value for CSV output. */
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  const args = process.argv.slice(2);
  // The CSV path is the first argument that is not an option or an option's value.
  const valueOptions = new Set(['--split', '--runs', '--out']);
  const file = args.find((a, i) => !a.startsWith('--') && !valueOptions.has(args[i - 1]));
  if (!file) {
    console.error('Usage: node scripts/run-golden-set.js <golden-set.csv> [--split dev] [--runs 3] [--out results.csv]');
    process.exit(1);
  }
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  const split = opt('split', 'dev');
  const runs = Number(opt('runs', '3'));
  const out = opt('out', null);

  if (split === 'sealed' && !args.includes('--allow-sealed')) {
    console.error('Refusing to run the sealed split. Sealed stories are not run before 14 Dec (PRD F6.6). Pass --allow-sealed on the agreed date.');
    process.exit(2);
  }

  const rows = parseCsv(fs.readFileSync(file, 'utf8')).filter((r) => split === 'all' || r.split === split);
  const results = [];
  let stable = 0;

  for (const r of rows) {
    const input = { summary: '', description: r.story, acceptanceCriteria: r.acceptance_criteria };
    const signatures = [];
    let result = null;
    for (let n = 0; n < runs; n += 1) {
      result = checkStory(input);
      const all = [...result.flags, ...result.moreFlags];
      signatures.push(JSON.stringify(all.map((f) => [f.rule, f.quote, f.matched || ''])));
    }
    const isStable = signatures.every((s) => s === signatures[0]);
    if (isStable) stable += 1;
    const all = [...result.flags, ...result.moreFlags];
    results.push({
      id: r.id,
      split: r.split,
      design: r.design,
      flags: all.map((f) => (f.matched ? `${f.rule} ('${f.matched}', ${f.location})` : `${f.rule} (${f.location})`)).join('; ') || 'none',
      shown: result.flags.length,
      folded: result.moreFlags.length,
      stable_across_runs: isStable ? 'yes' : 'NO',
      kate_label: r.kate_label || '',
    });
  }

  // Console summary.
  for (const x of results) {
    console.log(`${x.id.padEnd(7)} ${x.design.padEnd(22)} ${x.flags}${x.folded ? `  [${x.folded} folded]` : ''}`);
  }
  console.log(`\n${rows.length} stories, split=${split}, ${runs} runs each. Identical flags across runs: ${stable} of ${rows.length}.`);
  const clean = results.filter((x) => x.design.startsWith('clean'));
  const cleanZero = clean.filter((x) => x.flags === 'none');
  console.log(`Clean stories with zero flags: ${cleanZero.length} of ${clean.length}.`);

  if (out) {
    const cols = Object.keys(results[0] || { id: '' });
    const body = [cols.join(','), ...results.map((x) => cols.map((c) => csvCell(x[c])).join(','))].join('\n');
    fs.writeFileSync(out, `${body}\n`);
    console.log(`Wrote ${out}`);
  }
}

main();
