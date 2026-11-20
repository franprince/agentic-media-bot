# Claude provider (`AI_PROVIDER=anthropic`, Claude Haiku 5.5)

Date: 2026-11-20 · Version: 4.47.0

## Goal

Run the bot on Claude through the official Anthropic SDK without changing the
agent loop, the tools, or the stored conversation history, on the Claude model
that serves the bot best — measured below: Claude Haiku 5.5, the only Claude
model the provider uses.

## Design

`src/agent/anthropic.ts` implements an AI SDK v1 `LanguageModel`
(`AnthropicChatModel`) over `@anthropic-ai/sdk` (beta Messages endpoint).
`provider.ts` returns it from `getFastModel` / `getCapableModel` when
`AI_PROVIDER=anthropic`, always on `claude-haiku-5-5` (`AI_MODEL`,
`AI_MODEL_FAST`, `AI_MODEL_CAPABLE` are ignored), so every `generateText` /
`generateObject` call site works unchanged and the CAPABLE synthesis request is
skipped (same model for both tiers). Managed Agents was not used: the bot hosts
its own loop and its tools run locally.

Haiku 5.5 request rules the adapter enforces:

| Rule | Handling |
|---|---|
| Non-default `temperature` / `top_p` / `top_k` are a 400 | Never sent (ai@3 sends `temperature: 0` by default). |
| Assistant prefill is a 400 | A trailing assistant turn gets a short user turn appended (the synthesis pass ends on the draft). |
| Thinking is adaptive and on by default, and spends `max_tokens` | `max_tokens` floor of 4,096 (the router classifier asks for 400). Depth via `AI_REASONING_EFFORT` → `output_config.effort` (default `medium`). |
| A forced `tool_choice` skips thinking | `required` / named tool → `auto` + a system-prompt instruction. |
| Tool ids `^[a-zA-Z0-9_-]+$`; each `tool_use` answered in the next user turn | Ids mapped per request (distinct originals stay distinct); history cut to start at the first real user message; orphaned calls/results dropped. |
| History-editing check on replayed thinking blocks | See below. |

Tool calls are executed only when `stop_reason` is `tool_use` — never after a
refusal or a `max_tokens` cut. A `refusal` maps to finish reason
`content-filter` and is logged with its category; Haiku 5.5 has no server-side
fallback, so no `fallbacks` parameter is sent.

**Thinking replay.** The AI SDK v1 prompt has no slot for thinking blocks. Each
assistant turn with tool calls is kept in an in-memory LRU
(`ThinkingReplayCache`, 500 entries) keyed by its `tool_use` ids and a
fingerprint of model, `system`, the name-sorted tool set and every earlier
message (thinking excluded). It is restored verbatim only when the fingerprint
matches and the turn is unchanged: same text, same ordered tool ids and names,
every input field Claude sent present and equal; an extra field only when it is
that property's schema default (Zod adds `confirm: false`). In practice that is
within one `generateText` tool loop. Otherwise the turn goes without thinking,
which the API accepts (history compacted by `historyBudget`, a new turn with a
rebuilt system prompt). `thinking.block_binding.prefix_mismatch_behavior:
"drop_block"` (beta `thinking-binding-controls-2026-08-01`) is sent as a safety
net.

**Latency.**
- Automatic prompt caching (`cache_control: {type: "ephemeral"}` on every
  request): later steps of a tool loop read the system prompt, tools and history
  from cache (measured: step 2 read 6,349 cached tokens).
- Per-call options through `experimental_providerMetadata: { anthropic: {
  effort, thinking: "off" } }`. The recommendation lists in `tmdb.ts`
  (`discoverMedia`, three parallel calls) use `{ effort: "low", thinking: "off" }`:
  Haiku otherwise thinks ~500–1,000 tokens before a ~150-token JSON list. Each
  call went from 4–6 s to ~1 s; `discoverMedia` from 9.0 s to 3.4 s; the whole
  "find me a nice comedy series" turn from ~19 s in production to 5.6 s.
  `thinking: "off"` caps effort at `high` (Haiku rejects `disabled` above it).

**Not applicable to this provider.** `AI_MODEL_FALLBACKS` and
`fetchWithRateLimitRetry` rewrite OpenAI-shaped request bodies; the Anthropic SDK
retries 429/5xx itself (3 times). Claude takes no audio, so voice notes need
`TRANSCRIPTION_URL` or `GOOGLE_GENERATIVE_AI_API_KEY`.

## Why Haiku 5.5 (measured 2026-11-20)

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

Haiku 5.5 at `medium` matched Sonnet 5.5 and Opus 5.5 on every case at about
1/19 and 1/40 of their cost, and was the fastest, so the provider was reduced to
Haiku only. Haiku `low` missed one classifier case (routing fails open to the
full tool set, so it costs tokens, not a feature).

Caveat: in an earlier run whose synthetic history lacked the profile ids, Haiku
guessed a `qualityProfileId`. With real history (the tool result carrying the
ids) it chose correctly, and `confirmGuard` plus the tools' own confirmation
step and buttons still gate adds.
