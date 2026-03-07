Read and follow the workflow in `.agents/workflows/rules.md` on every run.
Before sending the final response, if tracked files changed, run tests and create a conventional commit.
Before committing changes that touch `src/bot.ts`, run `bun run check:bot-parse`.
Update `CHANGELOG.md` as the single source of truth for versioning and bot updates using semantic versioning.