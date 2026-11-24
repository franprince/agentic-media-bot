# Claude context: fuller history, session gap, no dead ends

Date: 2026-11-24 · Version: 4.48.0 · Status: Done (approved 2026-11-24)

## Problem

The token budget of `4.46.0` (tool routing, modular prompt, compacted history
view) was built for a hosted free tier capped at 8,000 tokens per minute. Since
`4.47.0` the bot runs on Claude Haiku 5.5, where that cap does not exist, and
the same machinery now causes wrong answers.

Evidence, from production logs and from replaying a stored conversation through
`prepareHistoryForModel`:

- **Dead end.** Asked for something no tool does (change the quality of a
  movie already in the library), the model answered `NEED_MORE_TOOLS`. The loop
  widened to all 39 tools, the model answered the marker again (the instruction
  is in the prompt even when nothing is left to widen to), the marker was
  stripped and the user got "I had trouble formulating a response". The marker
  also reached the user as a status update.
- **The bot contradicted itself.** On the third message of a conversation the
  view held 2 of 4 turns, and the previous search result had lost `overview`
  and `posterUrl`. The model retracted a synopsis it had given correctly and
  denied a request made two turns earlier.
- **A stale turn was treated as current.** A request about one movie ran
  `removeMovie` on another: the only title in view came from a turn two days
  old, kept by the always-keep-the-previous-turn rule. Nothing records when a
  conversation was last active.
- **Cache hits are invisible.** The adapter adds cache reads and writes into
  `promptTokens`, so the log cannot show whether prompt caching works or where
  a turn's time goes.

Sizes (logged or estimated from characters): one model call carries about
5,000 prompt tokens; the system prompt plus all 39 tools is about 8,000; a
user's whole stored history is about 3,000. At Haiku's price a 5,000-token call
costs about $0.0005. Two calls with the same input took 1.4 s for 176 output
tokens and 5.8 s for 1,083: the wait follows what the model writes, not what it
reads.

## Goals

1. With the Claude provider, the model sees the recent conversation as it
   happened.
2. A conversation that has gone quiet does not leak into a new request.
3. A request no tool covers gets a plain answer, never an internal marker or a
   generic error.
4. Each Claude call logs enough to measure caching and latency.

## Non-goals

- Changing anything the other providers send. Routing, the modular prompt and
  the history budget stay as they are for `ollama` and Google.
- A fixed tool set and prompt for Claude (phase 2, below).
- Handling button taps without the model, message threads, a lower reasoning
  effort, a trim on turn boundaries (it changes nothing the model sees).

## Approaches

| Approach | Trade-off | Decision |
|---|---|---|
| Each step writes a handoff for the next | Saves input that costs $0.10 per million tokens by adding output that costs five times as much and is the slow part; drops the IDs later steps need | Rejected |
| The API keeps the conversation (message threads beta) | Same price; needs an append-only history and a fixed tool set, which the bot does not have; gain too small to measure at this size | Not now |
| Send Claude the context it is missing, keep the budget for the capped providers | Slightly larger requests on Claude only; fixes the observed failures | **Chosen** (2026-11-24: keep both paths, change Claude only) |

## Design

### 1. Per-call usage log (Claude adapter)

`AnthropicChatModel.doGenerate` logs one line per request: uncached input
tokens, cache-read tokens, cache-write tokens, output tokens, elapsed
milliseconds and the stop reason. No message content. The summed `promptTokens`
returned to the AI SDK is unchanged.

### 2. No dead end (shared loop, every provider)

These are fixes to the loop all providers share, not provider wiring.

- A status update never contains `NEED_MORE_TOOLS`.
- When every tool is offered (routing did not narrow, or the loop widened to
  everything) the prompt replaces the marker rule with: if no tool covers the
  request, say so plainly in the user's language and say what you can do.
- If the reply is still empty once the marker is removed, the user gets a
  localised "I can't do that yet" message (es/en) instead of the generic error.
  An empty reply that never held the marker keeps today's generic text.
- The stored conversation holds what the user saw: the marker is removed from
  the saved assistant message, and the localised message is saved when it was
  sent. Otherwise the model would read its own marker back on the next turn.

### 3. History view for Claude

`prepareHistoryForModel` gains a provider profile.

- **Claude:** whole turns, newest first, **not compacted**, up to 60,000
  characters (about 17,000 tokens). The latest turn and the one before it are
  always kept. `AI_HISTORY_CHAR_BUDGET` does not apply to Claude, like the
  `AI_MODEL*` variables.
- The stored history is still trimmed to its last 20 messages on each new
  message, so in practice Claude sees about five tool turns; the 60,000
  characters are a ceiling for unusually large tool results.
- **Other providers:** exactly today's behaviour (compaction, 4,000 characters,
  a third of that when routing did not narrow).

### 4. Session gap for Claude

- `conversations` gets an `updated_at` column (epoch milliseconds), added by an
  idempotent migration at startup and written by every `saveHistory`.
- In `processUserMessage`, before the first write of the turn: if the provider
  is Claude, the message was typed (not a button tap) and the conversation was
  last active more than 12 hours ago, the stored history is cleared and the
  message starts a new conversation. The model view, the router's context step
  and the confirmation guard all read that same history, so none of them sees
  the old turns.
- A button tap always continues its conversation, whatever its age: it answers
  a specific earlier message. The callback handler tells `processUserMessage`
  that the text is a tap.
- A row with no `updated_at` (every row at first deploy) counts as expired.
- The startup catch-up path (`processUserMessage` with no new message) never
  resets: the unanswered message is the conversation.

## Edge cases

- A typed "yes" 13 hours after a confirmation question starts a new
  conversation: the model asks what it refers to, and the guard would drop an
  unrequested `confirm: true` anyway.
- First typed message after the deploy loses its earlier context once per user.
- A turn larger than the budget on its own is still sent whole (latest and
  previous turns are always kept).
- Another provider selected later: the column is still written, the reset and
  the fuller view do not apply.
- Known limit, unchanged: the loop widens once. If the classifier adds some
  groups and the model answers the marker again, the user gets the "I can't do
  that yet" message although the remaining tools were never offered. A second
  widening to every tool would close this; it costs one more request and is
  not part of this change.
- A provider with a separate synthesis model: when a tool ran and the first
  model then wrote the marker, the marker is removed from what the synthesis
  model reads, and only the synthesis reply is saved.

## Acceptance criteria

All checked by tests that make no API call.

1. A synthetic four-turn history shaped like the failing conversation: the
   Claude view keeps the earlier turn and the `overview` / `posterUrl` of the
   previous search result; the default view is byte-identical to today's.
2. Existing `history_budget`, `tool_router`, `prompts` and `step0_narrowing`
   tests pass unchanged for the default profile, with one exception: the
   `prompts` assertion that the full prompt contains the marker rule, which
   criterion 4 reverses.
3. With Claude, a typed message after a 12-hour gap sees an empty prior
   history in the view, in routing and in the guard; a tap after the same gap
   keeps it; with another provider nothing is cleared.
4. With every tool offered, the prompt has no marker rule; a model that returns
   only the marker yields the localised message; no status callback receives
   the marker.
5. A Claude response with cache-read and cache-write usage produces a log line
   that shows the four token counts separately.

## Phase 2 (separate spec, not approved here)

Fixed prompt and all tools for Claude on every request. It removes the
classifier and widening requests and lets the prompt cache hold across turns,
but tool choice among 39 tools on Haiku is unmeasured. Entry condition: the
per-call log from this change over real use, or a billed evaluation run that
includes a multi-turn case shaped like the failing conversation.

## Spec refinement

declined (2026-11-24: "Continue to planning", which also approved the spec and
authorised the plan and the build)
