---
description: Ensure the bot remains compliant with project specifications and updates the changelog on every commit/restart.
---

// turbo-all
1. **Audit Specifications**: Before finishing any feature, read `FUNCTIONAL_SPEC.md` and `TECHNICAL_SPEC.md` to ensure your implementation matches the documented requirements.
2. **Update Specs**: If you add a new feature or change existing behavior, update the corresponding markdown spec file IMMEDIATELY.
3. **Update Bot Changelog**: Whenever you modify the bot's features, update `CHANGELOG.md` following semantic versioning. The bot automatically parses this file on startup.
4. **Verify Verification Logic**: Ensure `src/verify-config.ts` includes checks for any new environment variables or service dependencies you've added.
5. **Atomic Commit**: Follow `commits.md` — run `bunx chowa commit` for clustering/message drafts, then commit each cluster with the conventional commit format.
6. **Restart Bot**: Never — see `AGENTS.md`; the bot is never run or restarted locally, only in production.
7. **Restart Proxy**: If the changes involve the proxy or local services, use `run_command` with `bun run src/proxy.ts` or the supervisor command to restart the proxy.

Chowa is installed as a devDependency (`bunx chowa`). It handles commit
clustering/messages (see `commits.md`) and can suggest model routing
(`bunx chowa route --kind <k> --complexity <c>`), but it has no notion of
steps 1–4 above — those remain mandatory regardless of what Chowa reports.
Its `check-update` defaults to comparing against `main`; this repo's default
branch is `master`, so pass `--base master` explicitly or verify manually.
