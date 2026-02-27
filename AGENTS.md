Read and follow the workflow in `.agents/workflows/specs-audit.md` on every run.
Before sending the final response, if tracked files changed, run tests and create a conventional commit.
Before committing changes that touch `src/bot.ts`, run `bun run check:bot-parse`.
Update the changelog and version number using semantic versioning.