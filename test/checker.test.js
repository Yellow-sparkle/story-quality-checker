/**
 * Unit tests for the layer 1 checks. All stories here are about made-up
 * products (Lumen Home webshop, PaceMate fitness app, Kestrel Bank).
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStory } from '../src/checker/index.js';
import { parseStory } from '../src/checker/parse.js';
import { adfToText } from '../src/checker/adf.js';

const rules = (result) => [...result.flags, ...result.moreFlags].map((f) => f.rule);

const GOOD = {
  summary: 'LUM-12 Save a delivery address',
  description: [
    'As a returning Lumen Home shopper, I want to save a delivery address to my account, so that I do not retype it at checkout.',
    '',
    'Acceptance criteria',
    'Given I am signed in, When I save an address with all required fields, Then it appears in My addresses.',
    'Given I leave the postcode empty, When I click Save, Then the message "Enter a postcode" is shown and nothing is saved.',
    'Given I have 10 saved addresses, When I try to add another, Then I see "You can save up to 10 addresses".',
  ].join('\n'),
};

test('a well-written story gets no flags', () => {
  const result = checkStory(GOOD);
  assert.deepEqual(rules(result), []);
  assert.equal(result.format, 'connextra');
  assert.equal(result.acLineCount, 3);
});

test('AC-MISSING and GOAL-MISSING fire on a one-liner, and clause rules are skipped', () => {
  const result = checkStory({ summary: 'KES-3 Card refunds', description: 'Hook up the card processor for refunds, see chat with Priya.' });
  assert.deepEqual(rules(result), ['AC-MISSING', 'GOAL-MISSING']);
  assert.equal(result.format, 'none');
  assert.ok(result.notices.some((n) => n.includes('skipped')));
});

test('AC-MISSING is identical across repeated runs (repeat-run gate)', () => {
  const input = { description: 'As a PaceMate runner, I want to export my runs as GPX, so that I can load them into other apps.' };
  const first = JSON.stringify(checkStory(input));
  for (let i = 0; i < 5; i += 1) assert.equal(JSON.stringify(checkStory(input)), first);
  assert.deepEqual(rules(checkStory(input)), ['AC-MISSING']);
});

test('"So that" with a capital letter counts as a goal', () => {
  const result = checkStory({
    description: 'As a Kestrel Bank customer I want to rename my savings pots So that I can tell them apart.\nAcceptance criteria:\n- A new name of 1 to 30 characters is shown on the pot within 1 second.',
  });
  assert.ok(!rules(result).includes('GOAL-MISSING'));
});

test('VAGUE-WORD fires on the "I want" clause and quotes it', () => {
  const result = checkStory({
    description: 'As a PaceMate user, I want a fast way to log a workout, so that I keep my streak.\nAcceptance criteria:\n1. Tapping + opens the log form.\n2. Saving shows the workout at the top of my history.',
  });
  const vague = result.flags.find((f) => f.rule === 'VAGUE-WORD');
  assert.ok(vague);
  assert.equal(vague.matched, 'fast');
  assert.equal(vague.quote, 'a fast way to log a workout');
});

test('VAGUE-WORD stays silent when the same clause has a number and unit', () => {
  const result = checkStory({
    description: 'As a Lumen Home shopper, I want search to be fast, under 2 seconds, so that I find lamps.\nAcceptance criteria:\n- Results appear within 2 seconds for 95% of searches.',
  });
  assert.ok(!rules(result).includes('VAGUE-WORD'));
});

test('VAGUE-WORD ignores the "so that" clause', () => {
  const result = checkStory({
    description: 'As a Lumen Home shopper, I want to reorder a past order, so that shopping is easy.\nAcceptance criteria:\n- Reorder adds every item from the order to my basket at today\'s price.',
  });
  assert.ok(!rules(result).includes('VAGUE-WORD'));
});

test('AC-UNTESTABLE quotes the exact AC line', () => {
  const result = checkStory({
    description: 'As a Kestrel Bank customer, I want to freeze my card, so that nobody can use it while it is lost.\nAcceptance criteria:\n- Freeze shows "Card frozen" and card payments are declined.\n- Unfreeze works as expected.',
  });
  const flag = result.flags.find((f) => f.rule === 'AC-UNTESTABLE');
  assert.ok(flag);
  assert.equal(flag.quote, 'Unfreeze works as expected.');
  assert.equal(flag.location, 'AC line 2');
});

test('EDGE-ACCESS reads the "I want" clause only, never the role', () => {
  const adminRole = checkStory({
    description: 'As an admin, I want to see a list of new sign-ups, so that I can welcome them.\nAcceptance criteria:\n- The list shows sign-ups from the last 7 days, newest first.',
  });
  assert.ok(!rules(adminRole).includes('EDGE-ACCESS'));

  const deleteWord = checkStory({
    description: 'As a PaceMate coach, I want to delete a training plan, so that athletes stop seeing it.\nAcceptance criteria:\n- Delete asks "Delete this plan?" and removes it from every athlete within 1 minute.',
  });
  assert.ok(rules(deleteWord).includes('EDGE-ACCESS'));
});

test('whole-word match: "deletions" is not "delete"', () => {
  const result = checkStory({
    description: 'As a Lumen Home manager, I want a weekly report of deletions, so that I see churn.\nAcceptance criteria:\n- The report lists every removed product with its date.',
  });
  assert.ok(!rules(result).includes('EDGE-ACCESS'));
});

test('EDGE-STATE fires when the AC miss the reverse step, and not when they cover it', () => {
  const missing = checkStory({
    description: 'As a PaceMate member, I want to cancel my subscription, so that I stop paying.\nAcceptance criteria:\n- Cancel shows the last billing date.',
  });
  assert.ok(rules(missing).includes('EDGE-STATE'));

  const covered = checkStory({
    description: 'As a PaceMate member, I want to cancel my subscription, so that I stop paying.\nAcceptance criteria:\n- Cancel shows the last billing date.\n- I can reactivate within 30 days and keep my history.',
  });
  assert.ok(!rules(covered).includes('EDGE-STATE'));
});

test('flags are capped at 5 and ranked in the fixed priority order', () => {
  const result = checkStory({
    description: 'As a Kestrel Bank customer, I want to quickly freeze or cancel my card in a simple way, and edit my limits.\nAcceptance criteria:\n- Freezing works as expected.\n- Cancelled cards are handled properly.\n- The screen is intuitive.',
  });
  assert.equal(result.flags.length, 5);
  assert.ok(result.moreFlags.length > 0);
  const order = rules(result);
  assert.equal(order[0], 'AC-UNTESTABLE');
  assert.equal(order[order.length - 1], 'VAGUE-WORD');
});

test('every quote is real text from the story', () => {
  const input = {
    description: 'As a Lumen Home shopper, I want a nice and flexible wishlist.\nAcceptance criteria:\n- The wishlist works correctly.',
  };
  const result = checkStory(input);
  for (const f of [...result.flags, ...result.moreFlags]) {
    assert.ok(input.description.includes(f.quote), `quote not found: ${f.quote}`);
  }
  assert.equal(result.droppedQuotes.length, 0);
});

test('AC in a dedicated field are read, and "(none)" means no AC', () => {
  const withField = parseStory({ description: 'As a PaceMate user, I want to pause a run, so that breaks do not count.', acceptanceCriteria: '1. Pause stops the timer.\n2. Resume continues from the same time.' });
  assert.equal(withField.acLines.length, 2);
  assert.equal(withField.acSource, 'field');

  const none = parseStory({ description: 'As a PaceMate user, I want to pause a run, so that breaks do not count.', acceptanceCriteria: '(none)' });
  assert.equal(none.acLines.length, 0);
});

test('Given/When/Then lines without a heading still count as AC', () => {
  const parsed = parseStory({
    description: 'As a Lumen Home shopper, I want to track my parcel, so that I can plan to be home.\nGiven my order has shipped, When I open it, Then I see the carrier and tracking number.',
  });
  assert.equal(parsed.acLines.length, 1);
});

test('ADF description is flattened to lines with list markers', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'As a Kestrel Bank customer, I want to download a statement, so that I can file taxes.' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The PDF lists every ' }, { type: 'text', text: 'transaction', marks: [{ type: 'strong' }] }, { type: 'text', text: ' of the month.' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Download works as expected.' }] }] },
        ],
      },
    ],
  };
  const text = adfToText(adf);
  assert.equal(text, 'As a Kestrel Bank customer, I want to download a statement, so that I can file taxes.\nAcceptance criteria\n- The PDF lists every transaction of the month.\n- Download works as expected.');
  const result = checkStory({ description: text });
  assert.deepEqual(rules(result), ['AC-UNTESTABLE']);
});

test('no score, grade or percentage in the result', () => {
  const json = JSON.stringify(checkStory(GOOD));
  assert.ok(!/score|grade|percent/i.test(json));
});
