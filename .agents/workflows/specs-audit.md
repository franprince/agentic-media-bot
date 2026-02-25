---
description: Ensure the bot remains compliant with project specifications and updates the changelog on every commit/restart.
---

// turbo-all
1. **Audit Specifications**: Before finishing any feature, read `FUNCTIONAL_SPEC.md` and `TECHNICAL_SPEC.md` to ensure your implementation matches the documented requirements.
2. **Update Specs**: If you add a new feature or change existing behavior, update the corresponding markdown spec file IMMEDIATELY.
3. **Update Bot Changelog**: Whenever you modify the bot's features, update the `changelog` string in `src/bot.ts`.
4. **Verify Verification Logic**: Ensure `src/verify-config.ts` includes checks for any new environment variables or service dependencies you've added.
5. **Atomic Commit**: Commit your changes following the conventional commit format, referencing the feature addition.
6. **Restart Bot**: Use `run_command` with `bun run src/bot.ts` to restart the bot and verify the latest changes (including the startup audit and changelog).
