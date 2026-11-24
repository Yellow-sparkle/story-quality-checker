/**
 * Layer 1 rules. Every rule here is decided in code, so the same story always
 * gets the same flags in the same order (PRD F1.6 and guardrail 2).
 *
 * A flag looks like:
 *   {
 *     rule: 'VAGUE-WORD',
 *     quote: 'exact text from the story',  // always a real substring of the story
 *     location: 'AC line 3' | '"I want" clause' | 'Story',
 *     matched: 'fast',                      // the word or phrase that triggered it, if any
 *     detail: 'short plain-language explanation for this story',
 *   }
 */
import {
  VAGUE_WORDS,
  STATE_WORDS,
  ACCESS_WORDS,
  STATE_COVERAGE_GENERIC,
  STATE_REVERSE_WORDS,
  UNTESTABLE_PHRASES,
} from './wordlists.js';

/** Escape a string for use inside a regular expression. */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a whole-word regex for a word or phrase. "only" must not match
 * "commonly", and "delete" must not match "deletions" (golden set SQC-14).
 * Apostrophes are normalised, so "can't" matches with a straight or a curly apostrophe.
 */
function wordRe(word) {
  const body = escapeRe(word).replace(/'/g, "['\u2019]").replace(/\\-/g, '[-\u2011]').replace(/ /g, '\\s+');
  return new RegExp(`(?<![\\w-])${body}(?![\\w-])`, 'i');
}

const vagueRes = VAGUE_WORDS.map((w) => ({ word: w, re: wordRe(w) }));
const stateRes = STATE_WORDS.map((w) => ({ word: w, re: wordRe(w) }));
const accessRes = ACCESS_WORDS.map((w) => ({ word: w, re: wordRe(w) }));
const untestableRes = UNTESTABLE_PHRASES.map((w) => ({ word: w, re: wordRe(w) }));

/**
 * True when the clause has a number with a unit ("2 seconds", "95%", "3,500 EUR").
 * Then a vague word in the same clause has a measure and stays silent (SQC-32).
 */
export function hasNumberAndUnit(text) {
  return /\d[\d.,]*\s*(?:%|\u2030|[a-z\u00c0-\u024f\u20ac$\u00a3\u00a5/]+)/i.test(text) || /[\u20ac$\u00a3]\s*\d/.test(text);
}

/** Return the first match of any regex in the list, as { word, index, text }. */
function firstMatch(list, text) {
  let best = null;
  for (const { word, re } of list) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) best = { word, index: m.index, text: m[0] };
  }
  return best;
}

/** Return every distinct listed word found in the text, in reading order. */
function allMatches(list, text) {
  const found = [];
  for (const { word, re } of list) {
    const m = re.exec(text);
    if (m) found.push({ word, index: m.index, text: m[0] });
  }
  return found.sort((a, b) => a.index - b.index);
}

/** True when any word in the list appears in the text (whole words). */
function mentionsAny(words, text) {
  return words.some((w) => wordRe(w).test(text));
}

/**
 * Split an AC line into clauses for the number-and-unit check. A clause ends at
 * ";" or at a "Then"/"When"/"And" boundary, so "Then pages load fast" is judged
 * on its own and not rescued by a number elsewhere in a long Given/When/Then line.
 */
function clausesOf(line) {
  return line
    .split(/;|\s(?=(?:when|then|and|but)\b)/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// AC-MISSING: the story has no acceptance criteria.
// ---------------------------------------------------------------------------
export function checkAcMissing(parsed) {
  if (parsed.acLines.length > 0) return [];
  const quote = parsed.story ? parsed.story.sentence : (parsed.storyLines[0] || parsed.summary || '');
  return [{
    rule: 'AC-MISSING',
    quote,
    location: 'Story',
    detail: 'No acceptance criteria were found in an acceptance criteria field, an "Acceptance criteria" section, or Given/When/Then lines.',
  }];
}

// ---------------------------------------------------------------------------
// AC-UNTESTABLE: an AC line has no observable outcome ("works as expected").
// v1 uses a fixed phrase list (see wordlists.js); the LLM judgement is an open decision.
// ---------------------------------------------------------------------------
export function checkAcUntestable(parsed) {
  const flags = [];
  for (const ac of parsed.acLines) {
    const m = firstMatch(untestableRes, ac.text);
    if (!m) continue;
    flags.push({
      rule: 'AC-UNTESTABLE',
      quote: ac.text,
      location: `AC line ${ac.n}`,
      matched: m.text,
      detail: `"${m.text}" does not say what a tester should see.`,
    });
  }
  return flags;
}

// ---------------------------------------------------------------------------
// GOAL-MISSING: no "so that" clause.
// ---------------------------------------------------------------------------
export function checkGoalMissing(parsed) {
  if (parsed.story && parsed.story.soThat) return [];
  // A story without the template may still state its reason in a "so that" sentence.
  if (!parsed.story && parsed.storyLines.some((l) => /\bso\s+that\b/i.test(l))) return [];
  const quote = parsed.story ? parsed.story.sentence : (parsed.storyLines[0] || parsed.summary || '');
  return [{
    rule: 'GOAL-MISSING',
    quote,
    location: 'Story',
    detail: parsed.story
      ? 'The story says who and what, but not why: there is no "so that ..." clause.'
      : 'The story has no "As a ..., I want ..., so that ..." sentence, so the reason behind it is not stated.',
  }];
}

// ---------------------------------------------------------------------------
// VAGUE-WORD: a listed word in the "I want" clause or an AC line, with no number
// and unit in the same clause. Words in the "so that" clause do not fire (draft
// decision, SQC-05). Each word is flagged once, at its first place.
// ---------------------------------------------------------------------------
export function checkVagueWords(parsed) {
  const flags = [];
  const seen = new Set();

  const consider = (clauseText, quote, location) => {
    for (const m of allMatches(vagueRes, clauseText)) {
      if (seen.has(m.word)) continue;
      if (hasNumberAndUnit(clauseText)) continue;
      seen.add(m.word);
      flags.push({
        rule: 'VAGUE-WORD',
        quote,
        location,
        matched: m.text,
        detail: `"${m.text}" has no number or unit here, so readers can understand it differently.`,
      });
    }
  };

  if (parsed.story && parsed.story.iWant) {
    consider(parsed.story.iWant, parsed.story.iWant, '"I want" clause');
  }
  for (const ac of parsed.acLines) {
    for (const clause of clausesOf(ac.text)) consider(clause, ac.text, `AC line ${ac.n}`);
  }
  return flags;
}

// ---------------------------------------------------------------------------
// EDGE-STATE (own rule): a state word in the "I want" clause, and the AC mention
// neither the reverse step nor records already in flight.
// ---------------------------------------------------------------------------
export function checkEdgeState(parsed) {
  if (!parsed.story || !parsed.story.iWant) return []; // skip rather than guess (J4)
  const hits = allMatches(stateRes, parsed.story.iWant);
  if (hits.length === 0) return [];

  const acText = parsed.acLines.map((a) => a.text).join('\n');
  const genericCovered = mentionsAny(STATE_COVERAGE_GENERIC, acText);
  if (genericCovered) return [];

  // The question is asked once per story, for the first state word whose reverse
  // step the AC don't mention.
  for (const hit of hits) {
    const reverse = STATE_REVERSE_WORDS[hit.word.toLowerCase()] || [];
    if (reverse.length > 0 && mentionsAny(reverse, acText)) continue;
    return [{
      rule: 'EDGE-STATE',
      quote: parsed.story.iWant,
      location: '"I want" clause',
      matched: hit.text,
      detail: `"${hit.text}" changes a state, but the acceptance criteria do not say whether it can be reversed or what happens to items already in progress.`,
    }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// EDGE-ACCESS (own rule): an access word in the "I want" clause (never the
// "As a [role]" opening), and the AC don't say who can't.
// The optional coverage check (open decision #4) is off by default; pass
// { accessCoverage: true } to try it.
// ---------------------------------------------------------------------------
export function checkEdgeAccess(parsed, options = {}) {
  if (!parsed.story || !parsed.story.iWant) return [];
  const hit = firstMatch(accessRes, parsed.story.iWant);
  if (!hit) return [];

  if (options.accessCoverage) {
    const acText = parsed.acLines.map((a) => a.text).join('\n');
    if (/\b(only|cannot|can['\u2019]t|not\s+allowed|never\s+(?:see|sees)|no\s+access|is\s+not\s+shown|are\s+not\s+shown|does\s+not\s+see|do\s+not\s+see)\b/i.test(acText)) {
      return [];
    }
  }

  return [{
    rule: 'EDGE-ACCESS',
    quote: parsed.story.iWant,
    location: '"I want" clause',
    matched: hit.text,
    detail: `"${hit.text}" limits or grants an action, but the acceptance criteria do not say who is not allowed to do it.`,
  }];
}
