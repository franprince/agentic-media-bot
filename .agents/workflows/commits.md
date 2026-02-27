---
description: Standardized rules for creating atomic, conventional commits in this project.
---

# Commit Workflow

Follow these steps to ensure high-quality, traceable changes in the repository.

1. **Stage Changes**: Group related modifications into a single logical "atomic" set. Avoid mixing refactors with feature additions.
2. **Review Diffs**: Run `git diff --cached` (or equivalent) to ensure no debug code, console logs, or sensitive data (secrets) are being committed.
3. **Format Message**: Use the Conventional Commits format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `refactor:` for code changes that neither fix a bug nor add a feature
   - `chore:` for updating builds, dependencies, or tools
   - `docs:` for documentation changes
4. **Commit**: 
   // turbo
   Execute the commit using `git commit -m "<type>(<scope>): <description>"`.
5. **Push/Deploy**: Only push after local verification or if explicitly permitted.
