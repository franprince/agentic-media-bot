# Claude all tools: every tool and the full prompt on every request

Date: 2026-11-24 · Version: 4.49.0 (proposed) · Status: Draft (proposal, not approved)

This is phase 2 of [`2026-11-24-claude-context`](../2026-11-24-claude-context/spec.md).

## Problem

Since `4.46.0` each request carries only the tool groups that keywords, the
previous turn or a classifier request pick for the message. That routing was
built for a hosted free tier capped at 8,000 tokens per minute. The bot now
runs on Claude Haiku 5.5, which has no such cap, and the routing is a source
of failures:

- **Missing tools.** On 2026-11-24 two requests got the wrong tools. A request
  for a synopsis matched "resum…" (resume torrents) and "resumen" (the summary
  report) and got only download and report tools; the model called the series
  search and the AI SDK ended the turn with an error. A question about
  finished downloads went to the queue tools only. `4.48.1` and `4.48.4`
  patched both with keyword changes and a retry.
- **More cases of the same kind.** Single words decide the whole tool set:
  "diarios" sends a message to reports, "guide" to ErsatzTV, "estado" to the
  service check. Five groups (downloads, system, reports, watchlist, ErsatzTV)
  cannot look up a title.
- **Extra requests.** A message without keywords costs a classifier request
  first; a narrowed model that needs more tools costs a second full request.
- **The prompt cache rarely helps.** The tool set changes from one message to
  the next, and tools come first in a request, so a new set starts the cache
  over. Of the turns logged on 2026-11-24 that came less than five minutes
  after the previous one (the cache lifetime), 4 of 5 wrote the whole prompt
  again; the one that read from cache reused the previous turn's groups.

### What this fixes and what it does not

It removes the failures caused by narrowing: a missing tool, the classifier
request, the second request after `NEED_MORE_TOOLS`. It does **not** touch
today's other faults, which were not routing: the library check by title
(`4.48.2`), the English reply to Spanish written without accents and the year
added to recommendation queries (`4.48.3`), or old tool results in the stored
conversation.

### "Before" is not a known-good state

Before `4.46.0` the bot sent every tool, but on another model and with a
prompt that listed half the tools by hand, repeated rules and hardcoded the
year. How well Haiku 5.5 chooses among 39 tools has not been measured. Step 0
below measures it before anything is built.

## Measurements

Token counts from Anthropic's token-counting endpoint for the requests the bot
builds today (no request was sent to the model):

| Request | Tools | Tools + prompt | With a stored 19-message conversation |
|---|---:|---:|---:|
| Small talk ("hola") | 0 | 1,162 | — |
| Download queue | 8 | 1,956 | — |
| Add a movie | 7 | 4,219 | — |
| Recommendations | 16 | 6,586 | 13,504 |
| Every tool and the full prompt | 39 | 11,027 | 17,953 |

The conversation itself adds about 6,900 tokens either way. At Haiku 5.5's
$0.10 per million input tokens, the 4,500 extra tokens of a full request cost
under a twentieth of a cent uncached; a cache read is billed at about a tenth
of that. In today's log the first request of a turn took 1.2–2.7 s whatever
its size; the wait follows the length of the answer, not of the prompt
(measured in the claude-context spec).

## Goals

1. With Claude, the model always has every tool: no request fails or is
   repeated because a tool was left out.
2. One request less on turns that today need the classifier or a widening.
3. The tools and the fixed part of the prompt are read from cache on a turn
   that comes within five minutes of the previous one.

## Non-goals

- Changing the other providers. Ollama and Google keep routing, the modular
  prompt and the history budget: a full request (11,000 tokens before the
  conversation) does not fit the 8,000-tokens-per-minute cap that routing was
  built for. Their keys are still configured, though `AI_PROVIDER` is
  `anthropic`.
- Bringing back the pre-`4.46.0` prompt text or the two legacy tool aliases
  (`browsePlexByGenre`, `findPlexByCountry`).
- Fixed tools across users, message threads, or the one-hour cache lifetime.

## Approaches

| Approach | Trade-off | Recommendation |
|---|---|---|
| A. Claude only: every tool and the full modular prompt on every request; routing stays for the other providers | Two paths stay in the code; the Claude path loses the routing code it does not need | **Recommended** (matches the 2026-11-24 decision "keep both paths, change Claude only") |
| B. Every provider gets every tool | One path, least code; Groq's free tier rejects an 11,000-token request, so those providers stop working | Not recommended unless the other providers are dropped |
| C. Revert `4.46.0` as it was | Brings back the hardcoded year, the incomplete tool list and duplicated rules, and drops every prompt rule added since | Rejected |
| D. Keep routing and keep fixing keywords | No new design; each new phrasing can fail again, and the cache keeps missing | Status quo |

## Design (approach A)

### 1. Every tool, every request

With `AI_PROVIDER=anthropic`, `processUserMessage` sends all 39 tools and
`buildSystemPromptTemplate(ALL_GROUPS)` on every request of the turn,
including small talk. Small talk keeps no shortcut: a request without tools
would start the cache over for the next turn.

### 2. A tool set that does not change

- `shouldDisableAddActions` removes `addMovie` and `addSeries` from a request
  that asks for details. On Claude the tools stay; the prompt rule "Info only:
  … NEVER add automatically" and the confirmation guard (an add without an
  earlier confirmation only returns the confirmation step) already prevent an
  unrequested add. Step 0 has a case for this.
- The tool list is built in a fixed order.

### 3. Cache layout

Requests render tools, then system, then messages, and a change in the system
prompt starts the cache over from that point. The system prompt ends with
three lines that change: the user's name, today's date and the conversation
language (which can change per message).

- The system prompt is sent in two blocks: the fixed rules first, then the
  user, date and language lines.
- An explicit cache breakpoint goes on the fixed block, so tools and fixed
  rules (about 11,000 tokens) have a read point that survives a change of
  language or date.
- The automatic breakpoint (the request-level `cache_control` sent today)
  keeps caching the conversation.
- The five-minute lifetime stays: in today's log, turns in one conversation
  came 16–67 seconds apart.

### 4. What stops running on Claude

| Part | On Claude | Other providers |
|---|---|---|
| Keyword, context and classifier routing (`selectToolGroups`) | Not called | Unchanged |
| `NEED_MORE_TOOLS` rule and widening | Not used: the full prompt already has the "say it is not supported" rule | Unchanged |
| Retry after a call to a tool that was not offered | Cannot fire; code kept | Unchanged |
| History budget | Already off since `4.48.0` | Unchanged |

The routing code stays for the other providers; nothing is deleted.

### 5. What stays from 4.46.0 and later

The confirmation guard, the 429 handling, the conversation-language logic,
the uncompacted history and 12-hour session gap, the per-call usage log and
the library check by id.

## Step 0: evaluation, before building (needs approval)

The claude-context spec makes this the entry condition for phase 2.

- **Cases:** about 40 invented messages modelled on real requests (Spanish and
  English, with and without accents, bare titles, follow-ups after a list,
  details without asking to add, synopsis requests, service questions), plus
  one multi-turn case shaped like the conversation that failed on
  2026-11-24 (recommendation, "I already have it", a search under another
  name).
- **Arms:** today's routing and every tool, same model and settings.
- **Recorded per case:** the tools called in order, whether an action tool
  (add, remove, pause, subscribe) was called without the user confirming, the
  number of requests, first-request latency and cache use.
- **Safety:** read-only tools run against the real services; action tools are
  replaced by stubs that return what a confirmation step returns.
- **Size and cost:** about 80 turns of 2–3 requests of 12,000–18,000 tokens,
  about 3–4 million input tokens: under $1 at Haiku 5.5 prices, less with
  cache reads.

## Edge cases

- **First turn after a long gap:** cold whatever the tool set; it writes
  4,000–9,000 tokens more to the cache than a routed request (about a tenth of
  a cent at the cache-write price, 1.25 times the input price).
- **Language changes mid-conversation:** only the block after the breakpoint
  changes; tools and fixed rules are still read from cache.
- **Date changes at midnight:** same as above.
- **Details request:** the add tools are now offered. If the model calls one,
  the guard returns the confirmation step instead of adding; the reply would
  then offer to add something the user only asked about. Step 0 measures how
  often.
- **Another provider selected later:** it gets today's routing, unchanged.

## Acceptance criteria

1. **Step 0:** with every tool, the expected first tool is called at least as
   often as with routing, and no action tool runs without a confirmation.
2. **Fixed prefix:** two requests in a row on Claude send the same 39 tools
   and the same fixed system block, byte for byte, including a details
   request and a change of language (test, no API call).
3. **No routing on Claude:** no classifier request and no widening request;
   the other providers' requests are unchanged (tests).
4. **Cache:** after deploying, a second turn within five minutes logs a cache
   read of at least the fixed prefix (about 11,000 tokens) in the
   `📊 Claude call` line.
5. **Latency:** over a day of use, the median first-request time is no more
   than 0.5 s above today's (1.2–2.7 s on 2026-11-24).

## Decisions for the user

1. Approve the proposal, and approach A over B.
2. Approve Step 0 (billed, under $1) before any build.
