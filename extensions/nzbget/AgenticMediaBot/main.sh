#!/usr/bin/env bash
#
# Agentic Media Bot notifier for NZBGet.
#
# NZBGet has no native webhook support, so this extension supplies it. It is
# registered as both a queue script and a post-processing script, and decides
# which role it is playing from the variables NZBGet sets:
#
#   NZBNA_EVENT set  -> queue script            (NZB_ADDED  -> "added")
#   NZBPP_*     set  -> post-processing script  (SUCCESS    -> "success")
#
# Configured through the manifest options, which NZBGet exposes as NZBPO_*.
#
# Note: `set -e` is deliberately NOT used. A webhook failure must never fail a
# download, so every failure path falls through to a success exit code.

set -uo pipefail

WEBHOOK_URL="${NZBPO_WEBHOOKURL:-http://localhost:3001/nzbget-webhook}"
TIMEOUT="${NZBPO_TIMEOUT:-10}"

# NZBGet post-processing exit codes.
readonly POSTPROCESS_SUCCESS=93
readonly POSTPROCESS_SKIP=95

# Escapes a string for embedding in a JSON string literal: backslashes and
# double quotes are escaped, control characters are dropped. Titles are attacker-
# adjacent (they come from NZB filenames) and routinely non-ASCII in this
# library, so they are never interpolated raw.
json_escape() {
	local s=$1
	s=${s//\\/\\\\}
	s=${s//\"/\\\"}
	printf '%s' "$s" | tr -d '\000-\037'
}

# POSTs one event. Logs and returns non-zero on failure; never exits.
post_event() {
	local event=$1
	local title=$2
	local body http_code

	body=$(printf '{"event":"%s","title":"%s"}' "$event" "$(json_escape "$title")")

	http_code=$(
		curl --silent --output /dev/null --write-out '%{http_code}' \
			--max-time "$TIMEOUT" \
			--header 'Content-Type: application/json' \
			--data "$body" \
			"$WEBHOOK_URL" 2>/dev/null
	)

	if [ "${http_code:-000}" -ge 200 ] 2>/dev/null && [ "${http_code:-000}" -lt 300 ] 2>/dev/null; then
		echo "[INFO] AgenticMediaBot: notified '$event' for '$title'"
		return 0
	fi

	# 000 means curl could not reach the endpoint at all.
	echo "[WARNING] AgenticMediaBot: webhook to $WEBHOOK_URL failed (HTTP ${http_code:-000}) for '$event' / '$title'"
	return 1
}

# --- Queue script role -------------------------------------------------------
if [ -n "${NZBNA_EVENT:-}" ]; then
	if [ "$NZBNA_EVENT" = "NZB_ADDED" ]; then
		post_event "added" "${NZBNA_NZBNAME:-Unknown NZB}"
	else
		echo "[DETAIL] AgenticMediaBot: ignoring queue event $NZBNA_EVENT"
	fi
	# Queue scripts use plain exit codes, not the post-processing 93/94/95 set.
	exit 0
fi

# --- Post-processing role ----------------------------------------------------
if [ -n "${NZBPP_TOTALSTATUS:-}" ]; then
	if [ "$NZBPP_TOTALSTATUS" = "SUCCESS" ]; then
		post_event "success" "${NZBPP_NZBNAME:-Unknown NZB}"
		# Always success: the download itself was fine regardless of the webhook.
		exit $POSTPROCESS_SUCCESS
	fi

	echo "[DETAIL] AgenticMediaBot: status $NZBPP_TOTALSTATUS is not reported, skipping"
	exit $POSTPROCESS_SKIP
fi

# Invoked with neither set — e.g. a manual run from the NZBGet UI.
echo "[INFO] AgenticMediaBot: no NZBGet event variables present, nothing to do"
exit $POSTPROCESS_SKIP
