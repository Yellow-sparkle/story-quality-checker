# Story Quality Checker

A Rovo agent for Jira, built on Atlassian Forge, that reviews a user story before refinement and flags what is missing. Each flag quotes the exact sentence and names the rule behind it. At most five flags are shown. The checker never rewrites the story: the author decides what to change.

> The checker asks the awkward questions, so you don't have to.

Built for Atlassian Codegeist 2026, category Apps for Software Teams.

## What it checks (layer 1, rules 0.4.1)

| Rule | Fires when | Source |
| --- | --- | --- |
| AC-MISSING | The story has no acceptance criteria (no AC field, no "Acceptance criteria" section, no Given/When/Then lines). | INVEST "Testable" |
| AC-UNTESTABLE | An AC line contains a phrase from a fixed list with no observable outcome, such as "works as expected", "handled properly" or "looks good". | INVEST "Testable" |
| GOAL-MISSING | There is no "so that ..." clause. | QUS "well-formed"; Connextra template |
| EDGE-ACCESS | An access word (only, admin, approve, edit, delete, view, access, cannot, can't, permission, restricted) is in the "I want" clause, and no AC line names the story's role, a restriction word (only, cannot, can't, never) and the access verb together. | Own rule |
| EDGE-STATE | A state word (cancel, approve, publish, complete, ...) is in the "I want" clause, and the AC mention neither the reverse step nor items already in progress. Also fires when an AC line defines a quoted "Not ...", "Non-...", "Un...", "Other", "All except" or "Everything but" option as "only" a list of states, and asks which states belong to neither filter. | Own rule |
| VAGUE-WORD | A listed vague word (fast, easy, intuitive, flexible, properly, correctly, ...) is in the "I want" clause or an AC line, with no number and unit in the same clause. Numbers elsewhere in the AC do not cancel it. | QUS "unambiguous" |

Words in the "so that" clause are not checked, because that clause states the benefit, which is not built or tested.

Every rule is decided in code, so the same story gets the same flags in the same order on every run. Flags are ranked in a fixed order (AC-MISSING, AC-UNTESTABLE, GOAL-MISSING, EDGE-ACCESS, EDGE-STATE, VAGUE-WORD) and capped at five; the rest fold under "N more, lower priority". There is no score, grade or story generation.

Rovo's language model does two things only: it presents the flags in the order the code returned them, and it words one clarifying question per flag.

## How it fits together

```
Rovo chat (on a Jira issue)
   -> rovo:agent "Story Quality Checker"
      -> action "check-story" (Forge function, src/index.js)
           -> Jira REST, as the user: issue summary, description, "Acceptance criteria" field
           -> src/checker: parse -> rules -> quote check -> rank -> cap at 5
      <- flags: rule, quote, location, source, why it matters, suggestion
   -> agent shows the flags, asks one question per flag, and the author decides
```

| Path | What it is |
| --- | --- |
| `manifest.yml` | Forge manifest: `rovo:agent`, `action`, `function`, scope `read:jira-work` |
| `src/index.js` | The action handler. Reads the issue with `asUser()`, never writes to Jira. |
| `src/checker/` | Parser, rules, word lists and rule catalog. Plain JavaScript, no Forge dependency, so it can be tested offline. |
| `test/` | Unit tests on made-up stories (`npm test`). |
| `scripts/run-golden-set.js` | Runs the checker over the golden-set CSV, 3 runs per story, and checks the flags are identical across runs. Only the dev split runs by default; it refuses the sealed split before 14 Dec. It never writes labels. |

## Run it

```
npm install
npm test
forge deploy
forge install --upgrade   # once, because the app now asks for the read:jira-work scope
```

Then open a Jira story, open Rovo chat, pick the Story Quality Checker agent and ask it to check the story.

To run the golden set (kept outside this repository):

```
node scripts/run-golden-set.js "path/to/golden-set.csv" --split dev --runs 3 --out eval-results/dev.csv
```

## Not in this version yet

- Team Definition of Ready from a Confluence page and the parent epic (layer 2, week 2).
- The "post clarifying questions" action with edit and confirm (week 2).
- AC-UNTESTABLE stays a fixed phrase list for the hackathon (decided 25 Nov), so it is stable across runs and needs no LLM credits.

## Credits and sources

- Rules are based on the Quality User Story (QUS) framework: Lucassen, G., Dalpiaz, F., van der Werf, J. M. E. M., and Brinkkemper, S. (2016). Improving agile requirements: the Quality User Story framework and tool. *Requirements Engineering*, 21(3), 383-403.
- INVEST: Wake, B. (2003). INVEST in Good Stories, and SMART Tasks.
- Part of the evaluation set uses story sentences from Dalpiaz, F. (2018). *Requirements data sets (user stories)*. Mendeley Data, v1, doi:10.17632/7zbk8zsd8y.1, licensed CC BY 4.0. Acceptance criteria for those stories were added by us and are used for tuning only.
- All other test stories are about made-up products (Lumen Home, PaceMate, Kestrel Bank).
