# Claude provider (`AI_PROVIDER=anthropic`)

Date: 2026-11-20 · Version: 4.47.0

## Goal

Run the bot on Claude through the official Anthropic SDK without changing the
agent loop, the tools, or the stored conversation history, and pick the Claude
model that serves the bot best.

## Design

`src/agent/anthropic.ts` implements an AI SDK v1 `LanguageModel`
(`AnthropicChatModel`) over `@anthropic-ai/sdk` (beta Messages endpoint).
`provider.ts` returns it from `getFastModel` / `getCapableModel` when
`AI_PROVIDER=anthropic`, so every `generateText` / `generateObject` call site
works unchanged. Managed Agents was not used: the bot hosts its own loop and its
tools run behind the proxy.

The adapter enforces the request rules of the current models (Opus 5.5,
Sonnet 5.5, Haiku 5.5), each of which is a 400 otherwise:

| Rule | Handling |
|---|---|
| No `temperature` / `top_p` / `top_k` | Never sent (ai@3 sends `temperature: 0` by default). |
| No forced `tool_choice` on Opus/Sonnet 5.5 | `required` / named tool → `auto` + a system-prompt instruction. |
| No trailing assistant turn (prefill) | A short user turn is appended (the CAPABLE synthesis pass ends on the draft). |
| Thinking is adaptive and always on, and spends `max_tokens` | `max_tokens` floor of 4,096 (the router classifier asks for 400). Depth via `AI_REASONING_EFFORT` → `output_config.effort`. |
| Tool ids `^[a-zA-Z0-9_-]+$`; each `tool_use` answered in the next user turn | Ids are mapped per request (distinct originals stay distinct); history is cut to start at the first real user message; orphaned calls/results are dropped. |
| History-editing check on replayed thinking blocks | See below. |

Tool calls are executed only when `stop_reason` is `tool_use`, and only those
after the last server-side `fallback` boundary: never after a refusal or a
`max_tokens` cut, and never twice when a declined model and its fallback both
asked for the same tool.

**Thinking replay.** The AI SDK v1 prompt has no slot for thinking blocks. Each
assistant turn with tool calls is kept in an in-memory LRU
(`ThinkingReplayCache`, 500 entries) keyed by its `tool_use` ids and a
fingerprint of model, `system`, the name-sorted tool set and every earlier
message (thinking excluded). It is restored verbatim only when the fingerprint
matches and the turn is unchanged: same text, same ordered tool ids and names,
every input field Claude sent present and equal; an extra field only when it is
that property's schema default (Zod adds `confirm: false`). In practice that is
within one `generateText` tool loop. Otherwise the turn goes without thinking,
which the API accepts: history compacted by `historyBudget`, a new turn with a
rebuilt system prompt, the CAPABLE synthesis pass, or a turn a fallback model
wrote (`fallback` block or `usage.iterations[].type === "fallback_message"`).
`thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (beta
`thinking-binding-controls-2026-08-01`) is sent as a safety net.

**Refusals.** Opus 5.5 / Sonnet 5.5 requests carry `fallbacks: "default"` (beta
`server-side-fallback-2026-07-01`); Haiku 5.5 has no server-side fallback. A
`refusal` stop maps to finish reason `content-filter` and is logged with its
category.

**Not applicable to this provider.** `AI_MODEL_FALLBACKS` and
`fetchWithRateLimitRetry` rewrite OpenAI-shaped request bodies; the Anthropic SDK
retries 429/5xx itself (3 times). Claude takes no audio, so voice notes still
need `TRANSCRIPTION_URL` or `GOOGLE_GENERATIVE_AI_API_KEY`.

## Model choice (measured 2026-11-20)

Harness: the bot's real system-prompt builder, tool schemas and
`AnthropicChatModel`, with tool executes stubbed by canned results. 14 agent
cases (Spanish and English: small talk, capabilities, add movie / series with the
two-step confirmation, confirmation follow-up with the correct profile id and
folder, pause one torrent by hash, remove without confirming, health, disk,
Plex by genre / country / recent, recommendations) plus 4 router-classifier
cases. Pass = expected tool called, no forbidden call (e.g. `confirm: true`
before the user confirmed), a non-empty reply in the conversation's language.

| Model | Effort | Agent | Classifier | Avg s / turn | $ / turn |
|---|---|---|---|---|---|
| claude-haiku-5-5 | low | 14/14 | 3/4 | 2.6 | 0.0008 |
| **claude-haiku-5-5** | **medium** | **14/14** | **4/4** | **2.8** | **0.0008** |
| claude-sonnet-5-5 | low | 14/14 | 4/4 | 4.3 | 0.0157 |
| claude-sonnet-5-5 | medium | 14/14 | 4/4 | 4.2 | 0.0159 |
| claude-opus-5-5 | low | 14/14 | 4/4 | 4.7 | 0.0329 |
| claude-opus-5-5 | medium | 14/14 | 4/4 | 5.0 | 0.0335 |

**Recommendation:** `AI_MODEL_FAST=AI_MODEL_CAPABLE=claude-haiku-5-5`, effort
`medium` (its default). Same pass rate as Sonnet and Opus, about 19× cheaper
than Sonnet and 40× cheaper than Opus, and the fastest. One model for both tiers
also skips the CAPABLE synthesis request. Haiku `low` missed one classifier
case (routing fails open to the full tool set, so it costs tokens, not a
feature).

Caveat: in an earlier run whose synthetic history lacked the profile ids, Haiku
guessed a `qualityProfileId` where Sonnet asked again. With real history (the
tool result carrying the ids) it chose correctly, and `confirmGuard` plus the
tools' own confirmation step still gate adds. If wrong adds show up in
production, move both tiers to `claude-sonnet-5-5`. The code default with no
model set stays `claude-opus-5-5`.
