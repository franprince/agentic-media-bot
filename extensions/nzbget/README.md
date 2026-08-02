# NZBGet extension — AgenticMediaBot

NZBGet has **no native webhook support**. It only makes outbound HTTP calls from
extension scripts, which is why `/nzbget-webhook` existed in the bot for a long
time without ever being called. This extension supplies the missing half.

## What it sends

| when | condition | body |
|---|---|---|
| NZB added to the queue | `NZBNA_EVENT=NZB_ADDED` | `{"event":"added","title":"…"}` |
| download finished | `NZBPP_TOTALSTATUS=SUCCESS` | `{"event":"success","title":"…"}` |

`WARNING`, `FAILURE` and `DELETED` outcomes are not reported — the bot's handler
only formats `added` and `success`, so anything else would produce no message.

By default it POSTs to the **proxy** (`http://localhost:3001/nzbget-webhook`),
which relays to the bot. That is the same path Radarr, Sonarr and Plex use. The
NZBGet container runs with `--network=host`, so `localhost` is the host.

A webhook failure never fails a download: errors are logged and post-processing
still exits `93`.

## Install

```bash
bash scripts/install-nzbget-extension.sh [SCRIPT_DIR]
```

`SCRIPT_DIR` defaults to `/home/fran/Documentos/media-stack/nzbget/config/scripts`,
the host path backing the container's `/config/scripts`.

The installer copies files only. **Enabling is manual and required** — NZBGet
runs an extension only when it is listed in `Extensions`:

1. NZBGet → **Settings**, reload the page so the extension is detected.
2. Add `AgenticMediaBot` to **Settings → EXTENSION SCRIPTS → Extensions**
   (or to a specific category's `Extensions`).
3. Check **WebhookUrl** points at the bot proxy.
4. Save and reload NZBGet.

`nzbget.conf` is runtime state owned by the media-stack, so this repo does not
edit it.

## Options

| option | default | purpose |
|---|---|---|
| `WebhookUrl` | `http://localhost:3001/nzbget-webhook` | target endpoint |
| `Timeout` | `10` | curl timeout in seconds; bounds how long a hung endpoint can hold the queue |

## Verify

Confirm NZBGet detected the extension:

```bash
curl -s -u "$NZBGET_USERNAME:$NZBGET_PASSWORD" \
  -d '{"version":"1.1","method":"config","params":[],"id":1}' \
  "$NZBGET_URL/jsonrpc" | grep -i AgenticMediaBot
```

Exercise the script directly without waiting for a download:

```bash
NZBPO_WEBHOOKURL=http://localhost:3001/nzbget-webhook \
NZBNA_EVENT=NZB_ADDED NZBNA_NZBNAME="Test.Release" \
  bash extensions/nzbget/AgenticMediaBot/main.sh
```

Automated coverage lives in `src/services/__tests__/nzbget_extension.test.ts`,
which executes `main.sh` against a stub endpoint.

## Requirements

`bash` and `curl`, both present in the LinuxServer NZBGet image. Requires NZBGet
**v23+** for the `manifest.json` extension format (verified against 26.2).
