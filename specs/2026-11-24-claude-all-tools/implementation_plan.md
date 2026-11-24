# Claude all tools — implementation plan

**Goal:** With `AI_PROVIDER=anthropic`, every request of a turn carries all 39
tools and the full prompt, with no routing, and the tools plus fixed rules sit
behind their own cache breakpoint.

**Spec:** [`spec.md`](./spec.md), approach A, approved 2026-11-24 ("Build,
Claude only").

## Global constraints

- Other providers send exactly what they send today (routing, prompt, add-tool
  removal, history budget).
- No test makes an API call or reads the production database.
- Invented phrasings and titles only in tests, docs and commit messages.
- The bot is not deployed from this work; a push deploys (pre-push hook), so
  nothing is pushed without the user's go-ahead.

## Review focus

1. **A change of language or date must not change the fixed block** — test
   with two turns, Spanish then English.
2. **A details request keeps the add tools on Claude** and still drops them on
   other providers.
3. **The context block must reach every request of the turn**, including the
   retry after an unoffered tool and the argument-repair retry.
4. **Single-system calls (classifier, recommendations, rewrite) keep a plain
   string `system`**; only a prompt with two system parts gets blocks.
5. **Thinking replay still works**: the fingerprint uses the joined system
   text, which is constant within a turn.

## Tasks

### 1. Prompt split (`src/agent/prompts.ts`)

`fillSystemPromptParts(template, context): { fixed: string; context: string }`
— `fixed` is the template without the `CONTEXT:` line; `context` is that line
filled in, plus the conversation-language sentence. `fillSystemPrompt` is
unchanged.

Tests (`prompts.test.ts`): `fixed` has no placeholder, name, date or language
sentence and is equal for two users, two dates and both languages; `context`
holds them.

### 2. System blocks (`src/agent/anthropic.ts`)

`convertPrompt` also returns `systemParts: string[]`. When the prompt has two
or more system parts, the request's `system` is an array of text blocks, the
first with `cache_control: { type: "ephemeral" }`; additions for a forced tool
or JSON mode go into the last block. With one part, `system` stays a string.
The thinking fingerprint keeps using the joined text.

Tests (`anthropic.test.ts`): two system messages → two blocks, breakpoint on
the first only; one → a string.

### 3. Every tool on Claude (`src/agent/index.ts`, `src/agent/toolRouter.ts`)

- `RoutingSource` gains `"all"`. On Claude, routing is
  `{ groups: ALL_GROUPS, source: "all", narrowed: false }` and
  `selectToolGroups` is not called.
- `shouldDisableAddActions` is not applied on Claude.
- On Claude, `systemPromptFor` returns the fixed part and every request's
  messages start with a system message holding the context part
  (`messagesFor(decision)`, used by the first pass, both retries, the widened
  pass and the synthesis pass).

Tests (`claude_all_tools.test.ts`, mocked `generateText`): one request for a
keyword-less message (no classifier), 39 tools, `system` without `User ID`,
first message the context with the language sentence; a details request keeps
`addMovie`; Spanish then English turns send the same `system` and tool names;
with `google`, a keyword-less message still costs a classifier request and a
download request still gets fewer than 39 tools and drops `addMovie` on a
details request. Update `claude_context.test.ts`, whose session-gap tests
read the router's arguments.

### 4. Docs and release

`TECHNICAL_SPEC.md` (Step 0 routing, cache layout), `FUNCTIONAL_SPEC.md`,
`CHANGELOG.md` `4.49.0`, `package.json`, spec status.

## Verification

- `bun test`, `bun run check:bot-parse`.
- Rerun the Step 0 harness's "every tool" arm through the real code path (no
  spies) on a few cases; a second turn within five minutes shows a cache read
  of at least the fixed prefix.
- Free token count of the fixed block.
