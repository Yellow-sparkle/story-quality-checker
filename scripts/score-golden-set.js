#!/usr/bin/env node
/**
 * Score the checker against Kate's labels on the golden set.
 *
 * Usage:
 *   node scripts/score-golden-set.js <path/to/golden-set.csv> [--exclude SQC-33,SQC-39,SQC-40]
 *
 * Labels are read from `kate_label` only (rule IDs separated by semicolons; an
 * empty cell or "none" means no rule should fire). Labels have no AC line
 * numbers yet, so scoring is per story and per rule: a rule counts as correct on
 * a story when the checker raised it and Kate labeled it.
 * Only the dev split is scored. The script never writes labels.
 */
import fs from 'node:fs';
import { checkStory } from '../src/checker/index.js';
import { parseCsv } from './csv.js';

const RULE_IDS = ['AC-MISSING', 'AC-UNTESTABLE', 'GOAL-MISSING', 'EDGE-ACCESS', 'EDGE-STATE', 'VAGUE-WORD'];
const RUNS = 3;

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--exclude');
if (!file) {
  console.error('Usage: node scripts/score-golden-set.js <golden-set.csv> [--exclude SQC-33,SQC-39,SQC-40]');
  process.exit(1);
}
const ex = args.indexOf('--exclude');
const exclude = new Set(ex >= 0 ? args[ex + 1].split(',') : []);
const rows = parseCsv(fs.readFileSync(file, 'utf8')).filter((r) => r.split === 'dev' && !exclude.has(r.id));

const stats = Object.fromEntries(RULE_IDS.map((r) => [r, { agree: 0, extra: [], missed: [] }]));
let stable = 0;
const noneFlagged = [];
let noneCount = 0;

for (const r of rows) {
  const input = { summary: '', description: r.story, acceptanceCriteria: r.acceptance_criteria };
  const sigs = [];
  let res;
  for (let n = 0; n < RUNS; n += 1) {
    res = checkStory(input);
    sigs.push(JSON.stringify([...res.flags, ...res.moreFlags].map((f) => [f.rule, f.quote, f.matched || ''])));
  }
  if (sigs.every((s) => s === sigs[0])) stable += 1;
  const all = [...res.flags, ...res.moreFlags];
  const got = new Set(all.map((f) => f.rule));
  const want = new Set((r.kate_label || '').split(';').map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== 'none'));
  if (want.size === 0) {
    noneCount += 1;
    if (got.size) noneFlagged.push(`${r.id}: ${all.map((f) => `${f.rule} ("${f.matched || ''}", ${f.location})`).join(', ')}`);
  }
  for (const rule of RULE_IDS) {
    const g = got.has(rule);
    const w = want.has(rule);
    if (g && w) stats[rule].agree += 1;
    else if (g) stats[rule].extra.push(r.id);
    else if (w) stats[rule].missed.push(r.id);
  }
  console.log(`${r.id.padEnd(7)} Kate: ${[...want].join('; ') || 'none'}  |  checker: ${[...got].join('; ') || 'none'}`);
}

console.log(`\n${rows.length} dev stories, ${RUNS} runs each. Identical flags across runs: ${stable} of ${rows.length}.`);
for (const rule of RULE_IDS) {
  const s = stats[rule];
  console.log(`${rule.padEnd(14)} precision ${s.agree} of ${s.agree + s.extra.length}, catch rate ${s.agree} of ${s.agree + s.missed.length}`
    + `${s.extra.length ? `; not in Kate's label: ${s.extra.join(', ')}` : ''}${s.missed.length ? `; missed: ${s.missed.join(', ')}` : ''}`);
}
console.log(`\nStories Kate labeled none: ${noneCount}. With at least one flag: ${noneFlagged.length} of ${noneCount}.`);
for (const x of noneFlagged) console.log(`  ${x}`);
