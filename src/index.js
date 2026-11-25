/**
 * Forge function behind the "check-story" Rovo action.
 *
 * The Rovo agent calls this action with a Jira issue key. The function:
 *   1. reads the issue as the invoking user (asUser), so it only sees what they can see
 *   2. turns the rich-text description and any "Acceptance criteria" field into plain text
 *   3. runs the layer 1 checks in code (src/checker)
 *   4. returns the ranked, capped flags for the agent to present
 *
 * The function never writes to Jira. Posting a comment is a separate action,
 * planned for week 2, and it will always need the author's confirmation.
 */
import api, { route } from '@forge/api';
import { adfToText } from './checker/adf.js';
import { checkStory } from './checker/index.js';

// Jira issue keys look like SHOP-142: a project key, a dash and a number.
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

/**
 * Work out which issue to check. The agent passes `issueKey` as an input; when
 * the user opens Rovo from an issue, Forge also passes the issue in the context.
 */
function resolveIssueKey(payload) {
  const fromInput = payload && typeof payload.issueKey === 'string' ? payload.issueKey.trim().toUpperCase() : '';
  if (ISSUE_KEY.test(fromInput)) return fromInput;
  const ctx = payload && payload.context && payload.context.jira;
  if (ctx && typeof ctx.issueKey === 'string' && ISSUE_KEY.test(ctx.issueKey)) return ctx.issueKey;
  return null;
}

/**
 * Find fields whose name is "Acceptance criteria" (any case). Teams often add a
 * custom field for AC; the PRD says to prefer the field when it exists.
 */
function acceptanceCriteriaText(issue) {
  const names = issue.names || {};
  const parts = [];
  for (const [fieldId, name] of Object.entries(names)) {
    if (!/acceptance\s*criteria/i.test(name)) continue;
    const value = issue.fields ? issue.fields[fieldId] : null;
    const text = adfToText(value).trim();
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

/**
 * The first line of the agent's reply, built in code so the count and its
 * grammar never vary: "1 flag found", "3 flags found", "8 flags found, the top 5 shown".
 */
export function countLine(issueKey, total, shown) {
  if (total === 0) return `No layer 1 issues were found for ${issueKey}.`;
  const noun = total === 1 ? 'flag' : 'flags';
  const tail = shown < total ? `, the top ${shown} shown` : '';
  return `${issueKey}: ${total} ${noun} found${tail}.`;
}

/** Turn the check result into a compact object the agent can present. */
function toAgentResponse(issueKey, summary, result) {
  const present = (f, i) => ({
    position: i + 1,
    rule: f.rule,
    ruleName: f.ruleName,
    source: f.source,
    location: f.location,
    quote: f.quote,
    // The word or phrase that triggered the flag (e.g. "edit"), so the agent can name it.
    triggerWord: f.matched || null,
    whyItMatters: f.why,
    detail: f.detail,
    suggestion: f.suggestion,
  });
  return {
    issueKey,
    summary,
    rulesVersion: result.rulesVersion,
    storyFormat: result.format === 'connextra' ? 'As a / I want / so that' : 'no As a / I want sentence found',
    acceptanceCriteriaFound: result.acLineCount,
    summaryLine: countLine(issueKey, result.totalFlags, result.flags.length),
    totalFlagsFound: result.totalFlags,
    flagsShownCount: result.flags.length,
    flagsShown: result.flags.map(present),
    moreFlagsLowerPriority: result.moreFlags.map((f, i) => present(f, i + result.flags.length)),
    moreFlagsCount: result.moreFlags.length,
    notices: result.notices,
    instructions: result.totalFlags === 0
      ? 'No flags. Say that no layer 1 issues were found, show the notices, and stop. Do not ask the author to decide on flags.'
      : 'Present flagsShown in this exact order with the exact quotes. Do not add, remove or reorder flags. Start with summaryLine, copied exactly. Name triggerWord when it is set. Mention moreFlagsCount as "N more, lower priority" and show them only if the user asks. Do not score the story or rewrite it.',
  };
}

/**
 * Rovo action handler, referenced in manifest.yml as index.checkStory.
 * @param {object} payload Action inputs plus `context` from Rovo.
 */
export async function checkStoryAction(payload) {
  const issueKey = resolveIssueKey(payload);
  if (!issueKey) {
    return {
      error: 'NO_ISSUE_KEY',
      message: 'Ask the user which Jira story to check, for example SHOP-142.',
    };
  }

  // Read the issue as the user. expand=names lets us find an "Acceptance criteria" field by name.
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueKey}?expand=names`, {
      headers: { Accept: 'application/json' },
    });

  if (response.status === 404 || response.status === 403) {
    return {
      error: 'ISSUE_NOT_AVAILABLE',
      message: `Issue ${issueKey} does not exist or you do not have permission to view it.`,
    };
  }
  if (!response.ok) {
    console.error(`Jira returned ${response.status} for ${issueKey}`);
    return {
      error: 'JIRA_ERROR',
      message: `Jira could not return ${issueKey} right now (status ${response.status}). Try again in a moment.`,
    };
  }

  const issue = await response.json();
  const summary = (issue.fields && issue.fields.summary) || '';
  const description = adfToText(issue.fields && issue.fields.description);
  const acceptanceCriteria = acceptanceCriteriaText(issue);

  const result = checkStory({ summary, description, acceptanceCriteria });

  // Telemetry: counts and rule IDs only, never story text (PRD data requirements).
  console.log(JSON.stringify({
    event: 'check_completed',
    rulesVersion: result.rulesVersion,
    format: result.format,
    acSource: result.acSource,
    flagsTotal: result.totalFlags,
    flagsShown: result.flags.length,
    rulesFired: [...result.flags, ...result.moreFlags].map((f) => f.rule),
    droppedQuotes: result.droppedQuotes.length,
  }));

  return toAgentResponse(issueKey, summary, result);
}
