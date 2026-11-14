# Token budget: tool routing, modular prompt, history view

Date: 2026-11-14 · Version: 4.46.0

## Problem

Ollama Cloud became pay-per-token (HTTP 402 from 2026-11-10), so the bot moved to
Groq's free tier, which caps each model at **8,000 tokens per minute**. Every
request carried the full system prompt (~3,600 tokens), all 41 tool schemas
(~4,400) and up to 20 stored messages (~2,000): about **10,100 tokens**, rejected
outright with HTTP 413. A tool-using turn sends that payload two or three times.

## Goal

Fit the free tier without removing any feature or tool.

## Design

1. **Tool routing** (`src/agent/toolRouter.ts`). Tools belong to nine groups. A
   message gets the groups it needs, decided by, in order: keywords (es/en),
   context for short replies and button callbacks (groups of the tools used in
   the previous turn), a ~300-token classifier request, then the full set.
   Small talk gets no tools.
2. **Modular system prompt** (`src/agent/prompts.ts`). A core that always
   applies plus sections per active group. The tool list was dropped (schemas
   are the source of truth) and duplicated rules merged.
3. **Safety net**. A narrowed model answers `NEED_MORE_TOOLS` when it lacks a
   tool; the loop widens once (classifier groups, else everything). The marker
   is never shown to the user.
4. **History view** (`src/agent/historyBudget.ts`). Old tool results are
   compacted (synopses and image URLs dropped; IDs, titles, counts kept), old
   turns are dropped oldest-first to a character budget, and the view starts at
   a user message. The latest turn is never touched; the database keeps
   everything.
5. **Provider** (`src/agent/provider.ts`). One place builds the models, sends
   `OLLAMA_API_KEY`, optionally adds `reasoning_effort`, and waits out 429s per
   HTTP request so already-executed tools are not repeated.

## Measured (Groq, `openai/gpt-oss-120b`, prompt tokens before history)

| Request | Before | After |
|---|---|---|
| Small talk ("hola") | ~8,100 | ~710 |
| Downloads queue | ~8,100 | ~890 |
| Add a movie | ~8,100 | ~2,000 |
| Library question (movies + library) | ~8,100 | ~2,860 |
| Recommendations (movies + library + discovery) | ~8,100 | ~3,100 |
| Full fallback (all 39 tools) | ~8,100 | ~5,110 |

History adds up to ~1,000 tokens (was ~2,000).

## Limits that remain

- 8,000 tokens per minute is roughly one tool-using reply per minute. Faster
  conversations still work but pause for the provider's `Retry-After`
  (typically 5–45 seconds).
- Tool results of the current turn are sent in full on the next step; a very
  large result can still dominate a turn.
- Keyword routing can over-include groups (costs tokens, not correctness).
  Under-inclusion is covered by `NEED_MORE_TOOLS`.

## Tests

`tool_router.test.ts`, `history_budget.test.ts`, `prompts.test.ts`,
`provider.test.ts`, `step0_narrowing.test.ts` (rewritten for the new Step 0),
`status.test.ts` (conversation language), `tmdb.test.ts` (discover fallback).
