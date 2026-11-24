# Claude context — implementation plan

**Goal:** With the Claude provider, send the recent conversation uncompacted,
start a new conversation after a 12-hour gap and log cache and timing per call;
for every provider, answer plainly when no tool covers a request.

**Architecture:** Four small changes at existing seams. The provider decision is
made once in `src/agent/index.ts` (`isAnthropicProvider()`); `historyBudget.ts`
and `database.ts` stay provider-neutral and take options or expose data. No new
environment variable.

**Tech stack:** Bun, TypeScript, `ai` 3.4, `@anthropic-ai/sdk`, `bun:sqlite`,
`bun test`.

**Spec:** [`spec.md`](./spec.md)

## Global constraints

- Other providers send exactly what they send today (history view, routing,
  budget). Only the shared-loop fixes of task 2 reach them.
- Session gap: **12 hours**, "more than" (exactly 12 hours is still the same
  conversation). Claude history ceiling: **60,000** characters.
- No test makes an API call or reads the production database.
- No Telegram IDs, handles or real conversation text in tests, docs or commit
  messages; fixtures use generic titles.
- The bot is never run, restarted or deployed from this work.
- No code comments beyond a non-obvious correctness constraint.

## Review focus

Failure modes the spec implies; each has a test in the task that owns the code.

1. **A database created before this change.** The column must be added on the
   first start and the second start must not fail — task 4, migration test on
   an in-memory database with the old schema.
2. **The trim writes before the gap is checked.** `trimHistory` saves (and now
   stamps `updated_at`) when the history exceeds 20 messages — task 4, loop
   test with 24 stored messages.
3. **The marker with punctuation or nothing else** (`NEED_MORE_TOOLS.`) must
   not leave "." as the reply — task 2.
4. **The marker saved into history** and read back by the model next turn —
   task 2, assertion on the saved messages.
5. **One oversized old turn on Claude** must still be dropped past the ceiling
   while the previous turn is kept — task 3.

## File map

| File | Change |
|---|---|
| `src/agent/anthropic.ts` | `formatUsageLog`, timing and one log line in `doGenerate` |
| `src/agent/prompts.ts` | marker rule vs. plain "no tool" rule, by group count |
| `src/agent/response.ts` | `noToolReply`, `scrubMarker`, `scrubMarkerFromMessages` |
| `src/agent/historyBudget.ts` | `CLAUDE_HISTORY_CHAR_BUDGET`, `compactOlderTurns` option |
| `src/agent/session.ts` (new) | `SESSION_GAP_MS`, `isSessionExpired` |
| `src/services/database.ts` | `updated_at` column, migration, `getConversationUpdatedAt` |
| `src/agent/index.ts` | wiring of all four parts |
| `src/bot/messages.ts` | button taps pass `{ fromButton: true }` |

---

## Task 1 — Per-call usage log

**Files:** `src/agent/anthropic.ts`, `src/agent/__tests__/anthropic.test.ts`

**Produces:** `formatUsageLog(usage: any, elapsedMs: number, stopReason: string | null): string`
returning
`📊 Claude call: input <n> · cache read <n> · cache write <n> · output <n> · <ms> ms · stop <reason>`
(missing counts print as 0, a missing stop reason as `unknown`).

- Test: a fake response with `input_tokens: 12, cache_read_input_tokens: 6349,
  cache_creation_input_tokens: 512, output_tokens: 176` logs one line holding
  `input 12`, `cache read 6349`, `cache write 512`, `output 176`,
  `stop end_turn` and `/\d+ ms/`; `usage.promptTokens` is still 6873.
- `doGenerate` measures the time around `client.beta.messages.create` and logs
  the line once per request. The returned `usage` is unchanged.

## Task 2 — No dead end

**Files:** `src/agent/prompts.ts`, `src/agent/response.ts`, `src/agent/index.ts`,
`src/agent/__tests__/prompts.test.ts`, `src/agent/__tests__/no_dead_end.test.ts` (new)

**Produces:**
- `buildSystemPromptTemplate(groups)`: with `groups.length === ALL_GROUPS.length`
  the marker rule is replaced by a rule to say plainly, in the user's language,
  that the request is not supported and what the bot can do. Other group sets
  keep the marker rule.
- `noToolReply(lang: StatusLanguage): string` — fixed es/en copy.
- `scrubMarker(text: string): string` — removes every marker; returns `""` when
  no letter or digit is left.
- `scrubMarkerFromMessages(messages: CoreMessage[], fallback: string): CoreMessage[]`
  — assistant text (string or text parts) is scrubbed; a part left empty takes
  `fallback`, or is dropped when `fallback` is empty. Tool calls and results are
  untouched; the input is not mutated.

**Loop changes (`index.ts`):**
- `onStepFinish` does not send a thought that contains the marker.
- After the widening block: if the marker was in `firstPass.text`, set the text
  to `scrubMarker(text)`, or to `noToolReply(statusLang)` when that is empty, and
  save `scrubMarkerFromMessages(...)` instead of the raw response messages.
- An empty reply that never held the marker keeps `"I had trouble formulating a
  response."`.

**Tests (provider `google`, mocked `generateText`):**
- Marker, then a classifier answer that adds nothing, then the marker again:
  the third request's `system` has no marker; the result text is
  `noToolReply(...)`; no saved message contains the marker; the last saved
  assistant text is the reply.
- `NEED_MORE_TOOLS.` alone yields `noToolReply(...)`, not ".".
- The mocked `generateText` calls `onStepFinish({ text: "NEED_MORE_TOOLS",
  toolCalls: [] })`: `onStep` never receives the marker. Control: a short
  ordinary thought does reach `onStep`.
- An empty reply without the marker keeps the generic text.
- `prompts.test.ts`: the marker assertion covers `[]` and `["downloads"]`; the
  full prompt asserts the opposite.

## Task 3 — History view for Claude

**Files:** `src/agent/historyBudget.ts`, `src/agent/index.ts`,
`src/agent/__tests__/history_budget.test.ts`, `src/agent/__tests__/claude_context.test.ts` (new)

**Produces:**
- `CLAUDE_HISTORY_CHAR_BUDGET = 60_000`
- `prepareHistoryForModel(history, charBudget?, options?: { compactOlderTurns?: boolean })`
  — `compactOlderTurns` defaults to `true`; the default path is unchanged.
- `index.ts`: one `historyViewFor(decision)` used by the first pass, the widened
  pass and the synthesis pass. Claude: `(history, CLAUDE_HISTORY_CHAR_BUDGET,
  { compactOlderTurns: false })`. Others: today's call.

**Tests:**
- Four-turn fixture (older search, search with `overview`/`posterUrl`, a
  follow-up, the new message): the Claude view equals the history; the default
  view at 4,000 equals a literal expected value (two turns, compacted).
- One oversized old turn is dropped at the Claude ceiling; the previous turn is
  kept whole.
- Loop: with `AI_PROVIDER=anthropic` the `messages` sent keep `overview`; with
  `google` they do not.

## Task 4 — Session gap for Claude

**Files:** `src/services/database.ts`, `src/agent/session.ts` (new),
`src/agent/index.ts`, `src/bot/messages.ts`,
`src/services/__tests__/history_management.test.ts`,
`src/agent/__tests__/session.test.ts` (new), `src/agent/__tests__/claude_context.test.ts`

**Produces:**
- `ensureConversationTimestampColumn(database: Database): void` — adds
  `updated_at INTEGER` when missing; called once at module load.
- `saveHistory` writes `updated_at = Date.now()`.
- `getConversationUpdatedAt(userId: number): number | null`.
- `SESSION_GAP_MS = 12 * 60 * 60 * 1000`;
  `isSessionExpired(lastActiveAt: number | null, now: number): boolean`
  (`null` → `true`; otherwise `now - lastActiveAt > SESSION_GAP_MS`).
- `processUserMessage(userId, userMessage?, onStep?, options?: { fromButton?: boolean })`.
- `handleUserText(ctx, userId, userText, username, options?: { fromButton?: boolean })`;
  the callback handler passes `{ fromButton: true }`.

**Order in `processUserMessage` (new message only):** read the timestamp
**before** `trimHistory`. If the provider is Claude, the message is not a tap,
the stored history is not empty and the session is expired: `clearHistory`,
start from `[]` and skip the trim. Otherwise trim as today. The catch-up call
(no message) never reaches this block.

**Tests:**
- Migration on `new Database(":memory:")` with the old two-column table and one
  row: column added, row kept with `updated_at` null, second call is a no-op.
- `saveHistory` then `getConversationUpdatedAt` returns a recent timestamp; an
  unknown user returns `null`.
- `isSessionExpired`: `null`, 1 hour, exactly 12 hours, 12 hours + 1 ms.
- Loop (spies on the database functions, `selectToolGroups` and
  `guardConfirmations`; `AI_PROVIDER` restored afterwards):
  - Claude, typed, 13 hours, 24 stored messages → cleared; `messages` is the new
    message only; both spies receive `[]` as prior history.
  - Claude, tap, 13 hours → not cleared, earlier turn in view.
  - Claude, typed, 1 hour → not cleared.
  - Claude, typed, `null` timestamp → cleared.
  - Claude, no message (catch-up), 13 hours → not cleared.
  - `google`, typed, 13 hours → not cleared.

## Task 5 — Stale recommendation prompt test

**Files:** `src/services/__tests__/tmdb.test.ts`

The two expected prompts gain the paragraph added to the recommendation prompt
in `4.47.0`. Own commit; unrelated to the tasks above.

## Task 6 — Documentation and release

`FUNCTIONAL_SPEC.md`, `TECHNICAL_SPEC.md`, `CHANGELOG.md` (`4.48.0`),
`package.json` version, `.env.example` (one line on `AI_HISTORY_CHAR_BUDGET`
and Claude), `specs/INDEX.md` status. `src/verify-config.ts` needs nothing: no
new variable or dependency.

## Verification

- `bun test` — whole suite green.
- `bun run check:bot-parse` — the bundle that includes `src/bot/messages.ts`
  still builds.
- Acceptance criteria 1–5 of the spec map to tasks 3, 3, 4, 2 and 1.
