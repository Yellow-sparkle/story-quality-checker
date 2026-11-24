/**
 * Story parser.
 *
 * Splits a Jira story into the parts the rules read:
 *   - the story sentence and its clauses: "As a [role]", "I want [...]", "so that [...]"
 *   - the acceptance criteria (AC), one entry per line
 *
 * It is tolerant on purpose (PRD "Digital-content edge cases"): "As an",
 * "So that" with a capital, missing commas, AC as Given/When/Then, a checklist,
 * numbered business rules, a section in the description or a custom field.
 * If the story has no "As a / I want" sentence, the parser says so and the
 * clause-based rules are skipped instead of guessing (PRD journey J4).
 */

// Headings that start the acceptance criteria section in a description.
const AC_HEADING = /^\s*(?:#+\s*)?(?:\*\*)?\s*(acceptance\s+criteria|acceptance\s+criterion|ac|business\s+rules|rules|definition\s+of\s+done)\s*(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/i;

// The same headings followed by text on the same line ("Acceptance criteria: Given ...").
const AC_HEADING_INLINE = /^\s*(?:#+\s*)?(?:\*\*)?\s*(acceptance\s+criteria|business\s+rules)\s*(?:\*\*)?\s*:\s*(.+)$/i;

// Headings that end the AC section.
const OTHER_HEADING = /^\s*(?:#+\s*)?(?:\*\*)?\s*(notes?|out\s+of\s+scope|design|designs|links?|dependencies|open\s+questions|description|background|context|story|user\s+story|technical\s+notes?|attachments?)\s*(?:\*\*)?\s*:?\s*$/i;

// A Given/When/Then line anywhere in the text.
const GWT_LINE = /^\s*(?:[-*\u2022]\s*|\d+[.)]\s*)?(given|when|then|and|but)\b/i;

// Placeholder text that means "no AC", e.g. "(none)", "TBD", "n/a".
const EMPTY_AC = /^\s*[([]?\s*(none|n\/a|na|tbd|tbc|todo|-|\u2014)\s*[)\]]?\s*\.?\s*$/i;

// "As a ..., I want ... so that ..." (the Connextra template).
const AS_A = /\bas\s+an?\s+/i;
const I_WANT = /\bI\s+(?:want|would\s+like|need|wish|'d\s+like)\b(?:\s+to\b)?/i;
const SO_THAT = /\bso\s+that\b/i;

/**
 * Remove list markers and checkbox markers from the start of a line.
 * @param {string} line
 * @returns {string}
 */
function stripMarker(line) {
  return line
    .replace(/^\s*(?:[-*\u2022]|\d+[.)]|\[[ xX]?\])\s+/, '')
    .replace(/^\s*\[[ xX]?\]\s+/, '')
    .trim();
}

/**
 * Split text into non-empty trimmed lines.
 * @param {string} text
 * @returns {string[]}
 */
function toLines(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/**
 * Find the story sentence and its clauses.
 * @param {string[]} lines Description lines (AC lines already removed).
 * @param {string} summary Issue summary, used if the description has no story sentence.
 */
function findStorySentence(lines, summary) {
  const candidates = [...lines, summary || ''];
  for (const line of candidates) {
    const asMatch = AS_A.exec(line);
    const wantMatch = I_WANT.exec(line);
    if (!asMatch || !wantMatch || wantMatch.index < asMatch.index) continue;

    const role = line.slice(asMatch.index + asMatch[0].length, wantMatch.index).replace(/[,\s]+$/, '').trim();
    const afterWant = line.slice(wantMatch.index + wantMatch[0].length);
    const soMatch = SO_THAT.exec(afterWant);
    const iWant = (soMatch ? afterWant.slice(0, soMatch.index) : afterWant).replace(/[,.\s]+$/, '').trim();
    const soThat = soMatch ? afterWant.slice(soMatch.index + soMatch[0].length).replace(/[.\s]+$/, '').trim() : '';

    return {
      sentence: line,
      role,
      iWant,
      soThat,
      // Character offset of the "I want" clause inside the sentence, for quoting.
      iWantStart: wantMatch.index + wantMatch[0].length,
    };
  }
  return null;
}

/**
 * Parse a story.
 * @param {object} input
 * @param {string} [input.summary] Jira summary.
 * @param {string} [input.description] Description as plain text.
 * @param {string} [input.acceptanceCriteria] Text of a dedicated AC field, if the site has one.
 * @returns {object} Parsed story.
 */
export function parseStory({ summary = '', description = '', acceptanceCriteria = '' } = {}) {
  const descLines = toLines(description);
  const acLines = [];
  const storyLines = [];

  // 1. AC from a dedicated field: every line counts (the field is preferred, PRD edge cases).
  for (const line of toLines(acceptanceCriteria)) {
    if (EMPTY_AC.test(line) || AC_HEADING.test(line)) continue;
    acLines.push({ text: stripMarker(line), raw: line, source: 'field' });
  }

  // 2. AC from a section of the description, introduced by a heading.
  let inAc = false;
  let sawHeading = false;
  for (const line of descLines) {
    const inline = AC_HEADING_INLINE.exec(line);
    if (AC_HEADING.test(line)) {
      inAc = true;
      sawHeading = true;
      continue;
    }
    if (inline) {
      inAc = true;
      sawHeading = true;
      if (!EMPTY_AC.test(inline[2])) acLines.push({ text: stripMarker(inline[2]), raw: line, source: 'description' });
      continue;
    }
    if (OTHER_HEADING.test(line)) {
      inAc = false;
      continue;
    }
    if (inAc) {
      if (!EMPTY_AC.test(line)) acLines.push({ text: stripMarker(line), raw: line, source: 'description' });
    } else {
      storyLines.push(line);
    }
  }

  // 3. No AC heading: Given/When/Then lines anywhere still count as AC.
  if (!sawHeading) {
    const rest = [];
    for (const line of storyLines) {
      if (GWT_LINE.test(line) && !AS_A.test(line)) {
        acLines.push({ text: stripMarker(line), raw: line, source: 'description' });
      } else {
        rest.push(line);
      }
    }
    storyLines.length = 0;
    storyLines.push(...rest);
  }

  // Number AC lines in reading order, so flags can say "AC line 3".
  acLines.forEach((ac, i) => {
    ac.n = i + 1;
  });

  const story = findStorySentence(storyLines, summary);

  return {
    summary,
    storyLines,
    story, // null when there is no "As a / I want" sentence
    format: story ? 'connextra' : 'none',
    acLines,
    acSource: acLines.length === 0 ? 'none' : [...new Set(acLines.map((a) => a.source))].join('+'),
  };
}
