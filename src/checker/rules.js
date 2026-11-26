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
  // Group sub-check first (decided 25 Nov, file 11): it reads the AC lines only,
  // so it also runs when the "I want" clause has no state word.
  const group = findGroupGap(parsed);
  if (group) return [group];

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
// EDGE-STATE group sub-check (decided 25 Nov, file 11, SQC-31).
//
// An AC line names a filter option in quotes whose name is a complement
// ("Not delivered", "Non-urgent", "Unpaid", "Other", "All except refunds",
// "Everything but drafts"), and then says "only" followed by a list of states.
// A complement is right only if it covers everything else, and code cannot tell
// whether the list is complete, so the flag asks which states fall under
// neither filter. Real parent states ("Open", "Active", "In progress",
// "Pending") are left out on purpose: they usually have a complete list, and
// including them would put questions on clean stories. A name that is not on
// the list, such as "Express", never fires.
// ---------------------------------------------------------------------------

// Quoted option name: straight or curly, single or double quotes.
const QUOTED_OPTION = /(?:"|“|'|‘)([^"'“”‘’]{1,40})(?:"|”|'|’)/g;
// Complement names. "Un..." excludes common words that are not negations
// (under, unit, union, unique, universal, until).
const GROUP_NAME = /^(?:not\s+\S|non[-\s]?\S|un(?!der|it|ion|ique|iver|til)[a-z]|other\b|all\s+except\b|everything\s+(?:but|except)\b)/i;
// "only" followed by a list: at least two items joined by a comma, "or" or "and".
const ONLY_LIST = /\bonly\s+([^.;]*?(?:,|\s+or\s+|\s+and\s+)[^.;]*?)(?=\s+(?:are|is|appear|appears|show|shows|shown|listed|remain|remains)\b|[.;]|$)/i;

// Exclusion names: the option is "everything except the values I pick".
const EXCLUDE_NAME = /^(?:all\s+except\b|everything\s+(?:but|except)\b)/i;
// "except", "but" or "excluding" followed by the left-out values (one or more).
const EXCEPT_LIST = /\b(?:except|but|excluding)\s+([^.;]+?)(?=\s+(?:are|is|appear|appears|show|shows|shown|listed|remain|remains)\b|[.;]|$)/i;

export function findGroupGap(parsed) {
  for (const ac of parsed.acLines) {
    QUOTED_OPTION.lastIndex = 0;
    let m;
    while ((m = QUOTED_OPTION.exec(ac.text)) !== null) {
      const name = m[1].trim();
      if (!GROUP_NAME.test(name)) continue;
      const after = ac.text.slice(m.index + m[0].length);
      const list = ONLY_LIST.exec(after);
      if (!list) {
        // Exclusion form: the option leaves out picked values ("All except",
        // "Everything but"), and the line then says "except" or "but" and a list.
        // The gap is values the filter list does not show: are they in or out?
        if (!EXCLUDE_NAME.test(name)) continue;
        const ex = EXCEPT_LIST.exec(after);
        if (!ex) continue;
        return {
          rule: 'EDGE-STATE',
          quote: ac.text,
          location: `AC line ${ac.n}`,
          matched: name,
          detail: `AC line ${ac.n} defines "${name}" as everything except ${ex[1].trim()}. It does not say whether values the filter does not list are included, so those items may show up or disappear without anyone deciding.`,
          suggestion: `Say whether "${name}" also includes values that are not in the filter list, and list every value it can return.`,
        };
      }
      return {
        rule: 'EDGE-STATE',
        quote: ac.text,
        location: `AC line ${ac.n}`,
        matched: name,
        detail: `AC line ${ac.n} defines "${name}" as only ${list[1].trim()}. Any state not in that list and not in the other filters belongs to neither filter, so those items disappear from every list.`,
        suggestion: `List every state "${name}" includes, or say which states belong to neither filter (for example cancelled, returned or failed items) and where they appear.`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// EDGE-ACCESS (own rule): an access word in the "I want" clause (never the
// "As a [role]" opening), and the AC don't say who can't.
//
// Coverage check (decided 25 Nov, call 3A): the flag stays silent when one AC
// line names the story's own role, a restriction word (only, cannot, can't,
// never) and the access verb from the "I want" clause. Role words come from the
// story itself, never from a fixed list, so the rule is not tuned to one story.
// Known false alarm kept on purpose: "only" used as a filter (SQC-05).
// ---------------------------------------------------------------------------

// Access words that are verbs. Matched by stem so "Delete", "deleted" and
// "deleting" all count as the verb "delete".
const ACCESS_VERB_STEMS = { approve: 'approv', edit: 'edit', delete: 'delet', view: 'view', access: 'access' };
const RESTRICTION = /\b(only|cannot|can['\u2019]t|never)\b/i;
const ROLE_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'user', 'person', 'someone']);

/** Content words of the role in "As a [role]", e.g. "camp administrator" -> camp, administrator. */
function roleWords(role) {
  return String(role || '')
    .toLowerCase()
    .split(/[^a-z\u00c0-\u024f]+/)
    .filter((w) => w.length > 3 && !ROLE_STOPWORDS.has(w));
}

/** True when some AC line already says who can or cannot do the action. */
export function acCoverAccess(parsed) {
  const roles = roleWords(parsed.story && parsed.story.role);
  if (roles.length === 0) return false;
  const verbs = allMatches(accessRes, parsed.story.iWant)
    .map((m) => ACCESS_VERB_STEMS[m.word.toLowerCase()])
    .filter(Boolean);
  return parsed.acLines.some((ac) => {
    const t = ac.text.toLowerCase();
    if (!RESTRICTION.test(t)) return false;
    // Role word, with or without a plural "s" ("moderator", "moderators").
    if (!roles.some((r) => new RegExp(`\\b${escapeRe(r)}s?\\b`).test(t))) return false;
    // If the "I want" clause has an access verb, the same AC line must name it.
    if (verbs.length > 0 && !verbs.some((v) => new RegExp(`\\b${v}`).test(t))) return false;
    return true;
  });
}

export function checkEdgeAccess(parsed) {
  if (!parsed.story || !parsed.story.iWant) return [];
  const hit = firstMatch(accessRes, parsed.story.iWant);
  if (!hit) return [];
  if (acCoverAccess(parsed)) return [];

  return [{
    rule: 'EDGE-ACCESS',
    quote: parsed.story.iWant,
    location: '"I want" clause',
    matched: hit.text,
    detail: `"${hit.text}" limits or grants an action, but the acceptance criteria do not say who is not allowed to do it.`,
  }];
}
