/**
 * Word lists and rule catalog for the Story Quality Checker.
 *
 * Everything here is fixed in code on purpose: the same story must always get
 * the same flags (PRD F1.6, "code decides, the LLM only words the questions").
 * The lists are the drafts from the golden-set README (v0.2). Kate still has to
 * confirm the vague-word and state-word lists (PRD "Open decisions for Kate" #1).
 * Change them only through a release, and freeze them before the sealed-set run.
 */

// Version of the rules. Logged with every check so eval runs can be compared.
export const RULES_VERSION = '0.2.0';

// VAGUE-WORD list (draft, to confirm). Matched as whole words / phrases.
// Scope (decided 25 Nov, calls 1A and 2A): words in the "so that" clause are not
// checked, because that clause states the benefit, which is not built or tested.
// A vague word stays silent only when its own clause has a number and a unit;
// numbers elsewhere in the acceptance criteria do not cancel it.
export const VAGUE_WORDS = [
  'fast', 'faster', 'quick', 'quickly', 'easy', 'easily', 'simple',
  'user-friendly', 'intuitive', 'flexible', 'great', 'nice', 'smooth',
  'seamless', 'sensible', 'efficient', 'efficiently', 'appropriate',
  'appropriately', 'robust', 'modern', 'as needed',
];

// EDGE-STATE trigger words (draft, to confirm). Read in the "I want" clause only.
export const STATE_WORDS = [
  'status', 'state', 'pending', 'active', 'inactive', 'suspend', 'suspended',
  'cancel', 'cancelled', 'canceled', 'archive', 'archived', 'enrol', 'enroll',
  'enrolled', 'admitted', 'approve', 'reject', 'rejected', 'publish',
  'published', 'public', 'hidden', 'hide', 'complete', 'completed', 'expire',
  'expired', 'reopen', 'draft',
  // 'freeze' is not on the draft list yet. Left out on purpose: Kate owns the list.
];

// EDGE-ACCESS trigger words (decided 22 Nov). Whole words, "I want" clause only.
// Bare "can" is excluded because "so that I can" is in about half of all stories.
export const ACCESS_WORDS = [
  'only', 'admin', 'approve', 'edit', 'delete', 'view', 'access', 'cannot',
  "can't", 'permission', 'restricted',
];

/**
 * EDGE-STATE coverage check. The rule asks its question only when the
 * acceptance criteria mention neither the reverse step nor records already in
 * flight. Both checks are plain word matches, so they are deterministic.
 */

// Words in the AC that show in-flight records or undo are covered, whatever the state.
export const STATE_COVERAGE_GENERIC = [
  'undo', 'revert', 'reverse', 'reversed', 'pending', 'in progress',
  'in-flight', 'in flight', 'already', 'existing',
];

// Reverse steps per state word. If the AC name the reverse step, it is covered.
// A word never covers itself: "Cancelled cards are handled properly" does not
// answer "can a cancellation be undone?".
export const STATE_REVERSE_WORDS = {
  approve: ['reject', 'rejected', 'rejecting', 'decline', 'declined', 'revoke', 'revoked', 'withdraw', 'withdrawn'],
  reject: ['approve', 'approved', 'resubmit', 'resubmitted', 'appeal'],
  rejected: ['approve', 'approved', 'resubmit', 'resubmitted', 'appeal'],
  cancel: ['reactivate', 'reactivated', 'reinstate', 'reinstated', 'restore', 'restored'],
  cancelled: ['reactivate', 'reactivated', 'reinstate', 'reinstated', 'restore', 'restored'],
  canceled: ['reactivate', 'reactivated', 'reinstate', 'reinstated', 'restore', 'restored'],
  suspend: ['reactivate', 'reactivated', 'resume', 'resumed', 'unsuspend', 'reinstate'],
  suspended: ['reactivate', 'reactivated', 'resume', 'resumed', 'unsuspend', 'reinstate'],
  archive: ['restore', 'restored', 'unarchive', 'unarchived'],
  archived: ['restore', 'restored', 'unarchive', 'unarchived'],
  enrol: ['withdraw', 'withdrawn', 'unenrol', 'unenroll', 'cancel', 'cancelled', 'canceled'],
  enroll: ['withdraw', 'withdrawn', 'unenrol', 'unenroll', 'cancel', 'cancelled', 'canceled'],
  enrolled: ['withdraw', 'withdrawn', 'unenrol', 'unenroll', 'cancel', 'cancelled', 'canceled'],
  admitted: ['withdraw', 'withdrawn', 'cancel', 'cancelled', 'canceled', 'refuse', 'refused'],
  publish: ['unpublish', 'unpublished', 'hide', 'hidden', 'withdraw', 'withdrawn'],
  published: ['unpublish', 'unpublished', 'hide', 'hidden', 'withdraw', 'withdrawn'],
  public: ['private', 'unpublish', 'unpublished', 'hide', 'hidden'],
  hide: ['unhide', 'show', 'restore', 'restored'],
  hidden: ['unhide', 'show', 'restore', 'restored'],
  complete: ['reopen', 'reopened', 'incomplete'],
  completed: ['reopen', 'reopened', 'incomplete'],
  expire: ['renew', 'renewed', 'extend', 'extended', 'reactivate'],
  expired: ['renew', 'renewed', 'extend', 'extended', 'reactivate'],
  reopen: ['close', 'closed'],
  draft: ['discard', 'discarded', 'submit', 'submitted'],
  active: ['deactivate', 'deactivated', 'inactive'],
  inactive: ['activate', 'activated', 'reactivate', 'reactivated'],
  // status, state and pending rely on the generic list only.
};

/**
 * AC-UNTESTABLE phrases. The PRD wants an LLM to judge testability with a
 * code-enforced quote check (PRD F1.5). That choice is still open (open
 * decision #5: Rovo reasoning or a Forge LLM call). Until it is made, v1 uses
 * this fixed phrase list so the result is deterministic. Each match is an AC
 * line with no observable outcome.
 */
export const UNTESTABLE_PHRASES = [
  'works as expected', 'work as expected', 'as expected', 'as intended',
  'handled properly', 'handled correctly', 'handled appropriately',
  'behaves correctly', 'behave correctly', 'behaves as expected',
  'works correctly', 'work correctly', 'works properly', 'work properly',
  'works fine', 'works well', 'without any issues', 'without issues',
  'without problems', 'is handled', 'are handled', 'properly', 'correctly',
  // Added 25 Nov (call 4A).
  // "etc." added after checking it raises no flag on any of the 28 dev stories.
  'looks good', 'look good', 'etc.', 'etc',
];

// Fixed priority order for ranking (draft, decided 22 Nov; review after the dev run).
// DoR lines will slot in after GOAL-MISSING in layer 2.
export const PRIORITY = [
  'AC-MISSING',
  'AC-UNTESTABLE',
  'GOAL-MISSING',
  'EDGE-ACCESS',
  'EDGE-STATE',
  'VAGUE-WORD',
];

// Maximum number of flags shown. The rest fold under "N more, lower priority".
export const MAX_FLAGS_SHOWN = 5;

/**
 * Rule catalog: plain-language name and the published source behind each rule.
 * QUS = Quality User Story framework, Lucassen, Dalpiaz, van der Werf and
 * Brinkkemper (2016), "Improving agile requirements: the Quality User Story
 * framework and tool", Requirements Engineering 21(3).
 */
export const RULES = {
  'AC-MISSING': {
    name: 'No acceptance criteria',
    source: 'INVEST "Testable" (Wake, 2003)',
    why: 'Without acceptance criteria, dev and QA have nothing to test against, so "done" is decided by whoever reads the story last.',
    suggestion: 'Add acceptance criteria that describe what the user sees or what the system does, including at least one error or edge case. If they live in an attachment or another field, say where.',
  },
  'AC-UNTESTABLE': {
    name: 'Acceptance criterion has no observable outcome',
    source: 'INVEST "Testable" (Wake, 2003)',
    why: 'A tester cannot tell when this line passes or fails, so dev and QA may read it differently.',
    suggestion: 'Replace this line with the result someone can see or measure: the message shown, the value saved, the state the record ends in.',
  },
  'GOAL-MISSING': {
    name: 'No goal ("so that ...")',
    source: 'QUS "well-formed" (Lucassen et al., 2016); Connextra template',
    why: 'Without the reason, the team cannot judge trade-offs or spot a simpler way to reach the same goal.',
    suggestion: 'Add a "so that ..." clause that says why the user needs this.',
  },
  'EDGE-ACCESS': {
    name: 'Who cannot do this is not stated',
    source: 'Own rule (Story Quality Checker), not part of QUS',
    why: 'The story limits or grants an action, but the acceptance criteria do not say who is not allowed. Permission gaps tend to surface after release.',
    suggestion: 'Add an acceptance criterion for a user who is not allowed to do this, and what they see instead.',
  },
  'EDGE-STATE': {
    name: 'Reverse step or in-flight records not covered',
    source: 'Own rule (Story Quality Checker), not part of QUS',
    why: 'The story changes a state, but the acceptance criteria do not say how to undo it or what happens to records already in progress.',
    suggestion: 'Decide whether the change can be reversed, and what happens to items that are already pending when it happens.',
  },
  'VAGUE-WORD': {
    name: 'Vague word without a measure',
    source: 'QUS "unambiguous" (Lucassen et al., 2016)',
    why: 'Words like this mean different things to different readers, and there is no number and unit to test against.',
    suggestion: 'Replace the word with a measurable target (a number and a unit). If your acceptance criteria already define it, confirm that and dismiss this flag, or move the measure up into the story.',
  },
};
