# Claude context — tasks

Order matters only where noted. Each task ends with its tests green.

- [x] 1. Per-call usage log in the Claude adapter (criterion 5)
- [x] 2. No dead end: prompt rule, status filter, localised reply, clean saved
      history (criterion 4)
- [x] 3. History view for Claude (criteria 1 and 2)
- [x] 4. Session gap for Claude: column, migration, gap check, tap flag
      (criterion 3) — after task 3, both edit the same block of `index.ts`
- [x] 5. Stale recommendation prompt test (own commit)
- [x] 6. Documentation, changelog `4.48.0`, index status — after 1–4
- [x] 7. Whole suite and `check:bot-parse` green

Not done here: deploying. The bot runs from a bundle and only the deploy script
ships code; nothing in this change is live until that is run.
