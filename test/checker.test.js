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

test('summary line uses the right count and grammar', async () => {
  const { countLine } = await import('../src/index.js');
  assert.equal(countLine('SQCT-1', 0, 0), 'No layer 1 issues were found for SQCT-1.');
  assert.equal(countLine('SQCT-3', 1, 1), 'SQCT-3: 1 flag found.');
  assert.equal(countLine('SQCT-2', 2, 2), 'SQCT-2: 2 flags found.');
  assert.equal(countLine('SQCT-7', 8, 5), 'SQCT-7: 8 flags found, the top 5 shown.');
});

test('EDGE-ACCESS is silent when an AC line names the role, a restriction and the verb', () => {
  const covered = checkStory({
    description: 'As a PaceMate coach, I want to delete a training plan, so that athletes stop seeing it.\nAcceptance criteria:\n- Only the coach who created the plan sees Delete. Athletes never see it.\n- Delete removes the plan from every athlete within 1 minute.',
  });
  assert.ok(!rules(covered).includes('EDGE-ACCESS'));

  // "cannot" about timing, with no role in the line, does not answer who can't.
  const timing = checkStory({
    description: 'As a PaceMate coach, I want to delete a training plan, so that athletes stop seeing it.\nAcceptance criteria:\n- A plan that is in use this week cannot be deleted until Sunday.',
  });
  assert.ok(rules(timing).includes('EDGE-ACCESS'));

  // Role and restriction without the access verb do not count either.
  const noVerb = checkStory({
    description: 'As a Kestrel Bank manager, I want to approve card limit increases, so that large limits get checked.\nAcceptance criteria:\n- Only managers see the Limits queue.',
  });
  assert.ok(rules(noVerb).includes('EDGE-ACCESS'));
});

test('"looks good" and "etc." are untestable AC phrases', () => {
  const result = checkStory({
    description: 'As a Lumen Home shopper, I want to print my receipt, so that I can return items.\nAcceptance criteria:\n- The receipt looks good on paper.\n- It shows items, prices, VAT etc.',
  });
  assert.equal(result.flags.filter((f) => f.rule === 'AC-UNTESTABLE').length, 2);
});

test('VAGUE-WORD suggestion offers to confirm and dismiss when the AC define the word', () => {
  const result = checkStory({ description: 'As a PaceMate user, I want a fast way to log a workout, so that I keep my streak.\nAcceptance criteria:\n- Logging takes at most 2 taps.' });
  const v = result.flags.find((f) => f.rule === 'VAGUE-WORD');
  assert.match(v.suggestion, /confirm that and dismiss this flag/);
});

// EDGE-STATE group sub-check (decided 25 Nov, file 11).
test('EDGE-STATE asks which states fall under neither filter for a "Not ..." option', () => {
  const input = {
    description: 'As a returning Lumen Home shopper, I want to filter my orders by delivery state, so that I can find an order that has not arrived.\nAcceptance criteria:\n1. Given I have orders in more than one delivery state, When I choose \'Not delivered\' in the filter, Then only orders in Processing, Shipped or Out for delivery are listed, newest first.\n2. Given I choose \'Delivered\', Then only delivered orders are listed.',
  };
  const result = checkStory(input);
  const state = result.flags.filter((f) => f.rule === 'EDGE-STATE');
  assert.equal(state.length, 1);
  assert.equal(state[0].location, 'AC line 1');
  assert.equal(state[0].matched, 'Not delivered');
  assert.match(state[0].detail, /Processing, Shipped or Out for delivery/);
  assert.match(state[0].suggestion, /neither filter/);
  assert.ok(input.description.includes(state[0].quote));
  // Same flags on every run.
  assert.equal(JSON.stringify(checkStory(input)), JSON.stringify(result));
});

test('EDGE-STATE group sub-check fires on "Other" and "All except" without a state word in "I want"', () => {
  const other = checkStory({
    description: 'As a Kestrel Bank customer, I want to sort my payments into groups, so that I see where money goes.\nAcceptance criteria:\n- When I pick "Other", Then only Refunded, Disputed and Held payments are shown.',
  });
  assert.deepEqual(rules(other), ['EDGE-STATE']);

  const except = checkStory({
    description: 'As a PaceMate coach, I want to see my athletes in one list, so that I plan the week.\nAcceptance criteria:\n- Choosing ‘All except injured’ shows only Active, Resting or Travelling athletes.',
  });
  assert.deepEqual(rules(except), ['EDGE-STATE']);
});

test('EDGE-STATE group sub-check stays silent on a named option with a complete list', () => {
  // Clean near-miss from the debate: "Express" is not a complement name.
  const express = checkStory({
    description: 'As a Lumen Home shopper, I want to choose a delivery speed, so that my lamp arrives when I am home.\nAcceptance criteria:\n- Given I am at checkout, When I choose \'Express\', Then only Next-day or Same-day options are listed.',
  });
  assert.ok(!rules(express).includes('EDGE-STATE'));

  // Real parent states are left out on purpose.
  const open = checkStory({
    description: 'As a Kestrel Bank customer, I want to see my support requests, so that I can follow up.\nAcceptance criteria:\n- When I choose \'Open\', Then only New, Assigned or Waiting requests are listed.\n- When I choose \'Under review\', Then only Assigned or Waiting requests are listed.',
  });
  assert.ok(!rules(open).includes('EDGE-STATE'));

  // A complement name with no "only" list does not fire either.
  const noList = checkStory({
    description: 'As a Lumen Home shopper, I want to filter my orders, so that I find one quickly.\nAcceptance criteria:\n- The filter has the options \'Delivered\' and \'Not delivered\'.',
  });
  assert.ok(!rules(noList).includes('EDGE-STATE'));
});

// Rules 0.4.0 (Kate's decisions, 26 Nov).
test('"enrolled", "enroll" and "completed" no longer trigger EDGE-STATE', () => {
  for (const iWant of ['update the details of enrolled members', 'enroll my child in a PaceMate kids class', 'change my booking as long as the class has not been completed']) {
    const result = checkStory({ description: `As a PaceMate member, I want to ${iWant}, so that my plans stay right.\nAcceptance criteria:\n- Saving shows "Saved" and the new value.` });
    assert.ok(!rules(result).includes('EDGE-STATE'), iWant);
  }
});

test('"properly" and "correctly" are vague words as well as untestable phrases', () => {
  const result = checkStory({
    description: 'As a Lumen Home shopper, I want to edit my address, so that parcels arrive.\nAcceptance criteria:\n- Saving shows "Address saved".\n- Invalid postcodes are handled properly.',
  });
  assert.ok(rules(result).includes('AC-UNTESTABLE'));
  const vague = result.flags.find((f) => f.rule === 'VAGUE-WORD');
  assert.equal(vague.matched, 'properly');
});

// Rules 0.4.1 (26 Nov): exclusion form of the group sub-check (SQC-54 miss).
test('EDGE-STATE group sub-check fires on an "All except" option defined by "except" a list', () => {
  const cars = checkStory({
    description: 'As a dealer, I want to filter cars by colour, so that I can find them.\nAcceptance criteria:\n- The filter lists Red, Blue, Green and Black.\n- When I choose "All except" and pick Blue and Green, I see all cars except Blue and Green.',
  });
  assert.deepEqual(rules(cars), ['EDGE-STATE']);

  const food = checkStory({
    description: 'As a diner, I want to filter restaurants by cuisine, so that I can skip food I dislike.\nAcceptance criteria:\n- Given I choose \'Everything but\' and pick Thai or Sushi, Then all restaurants but Thai or Sushi are listed.',
  });
  assert.deepEqual(rules(food), ['EDGE-STATE']);
});

test('EDGE-STATE exclusion form stays silent without a complement option name', () => {
  const hours = checkStory({
    description: 'As a diner, I want to see opening hours, so that I can plan my visit.\nAcceptance criteria:\n- Given I open a restaurant, Then I see opening hours for every day except Sunday and Monday.',
  });
  assert.ok(!rules(hours).includes('EDGE-STATE'));

  const express = checkStory({
    description: 'As a courier, I want to filter orders by speed, so that I can track the fast ones.\nAcceptance criteria:\n- When I choose "Express", I see all orders but Standard and Economy.',
  });
  assert.ok(!rules(express).includes('EDGE-STATE'));
});
