/**
 * Story Quality Checker: runs the layer 1 rules on one story and returns the
 * ranked, capped list of flags.
 *
 * Pipeline (PRD "AI MVP", steps 2, 3 and 5):
 *   parse -> fixed checks in code -> quote check -> rank by fixed priority -> cap at 5
 *
 * There is no score, grade or percentage anywhere (PRD F3.3). The checker never
 * rewrites the story; each flag carries a suggestion of what to add, and the
 * author decides.
 */
import { parseStory } from './parse.js';
import {
  checkAcMissing,
  checkAcUntestable,
  checkGoalMissing,
  checkVagueWords,
  checkEdgeState,
  checkEdgeAccess,
} from './rules.js';
import { PRIORITY, MAX_FLAGS_SHOWN, RULES, RULES_VERSION } from './wordlists.js';

/** Normalise whitespace and quote marks so quotes compare the way users see them. */
export function normalise(text) {
  return String(text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Run all layer 1 checks on a story.
 * @param {object} input { summary, description, acceptanceCriteria } as plain text.
 * @param {object} [options] { maxShown: number }
 * @returns {object} Check result.
 */
export function checkStory(input, options = {}) {
  const parsed = parseStory(input);
  const maxShown = options.maxShown || MAX_FLAGS_SHOWN;

  const raw = [
    ...checkAcMissing(parsed),
    ...checkAcUntestable(parsed),
    ...checkGoalMissing(parsed),
    ...checkEdgeAccess(parsed),
    ...checkEdgeState(parsed),
    ...checkVagueWords(parsed),
  ];

  // Quote check: every quote must be real text from the story. Code-decided
  // rules always pass this; it guards against parser bugs and, later, LLM flags.
  const fullText = normalise([input.summary, input.description, input.acceptanceCriteria].join('\n'));
  const dropped = [];
  const verified = raw.filter((f) => {
    const ok = f.quote && fullText.includes(normalise(f.quote));
    if (!ok) dropped.push({ rule: f.rule, reason: 'quote_not_found' });
    return ok;
  });

  // Rank by the fixed priority order. Array.prototype.sort is stable, so flags of
  // the same rule keep reading order. Same input, same order, every run.
  const ranked = verified
    .map((f) => ({
      ...f,
      ruleName: RULES[f.rule].name,
      source: RULES[f.rule].source,
      why: RULES[f.rule].why,
      suggestion: RULES[f.rule].suggestion,
      decidedBy: 'code',
    }))
    .sort((a, b) => PRIORITY.indexOf(a.rule) - PRIORITY.indexOf(b.rule));

  const notices = [];
  if (parsed.format === 'none') {
    notices.push('This story has no "As a ..., I want ..., so that ..." sentence, so the state and access questions were skipped.');
  }
  notices.push('No team Definition of Ready is connected yet, so only the universal checks ran.');

  return {
    rulesVersion: RULES_VERSION,
    format: parsed.format,
    acSource: parsed.acSource,
    acLineCount: parsed.acLines.length,
    flags: ranked.slice(0, maxShown),
    moreFlags: ranked.slice(maxShown),
    totalFlags: ranked.length,
    droppedQuotes: dropped,
    notices,
  };
}
