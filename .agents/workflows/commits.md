---
description: Standardized rules for creating atomic, conventional commits in this project.
---

# Commit Workflow

Chowa is installed as a devDependency (`bunx chowa`) and does the clustering
and message-drafting steps below. It does not run `git commit` itself and
knows nothing about this project's spec/changelog requirements — those stay
manual.

1. **Cluster & Draft**: Run `bunx chowa commit` to split the working diff
   into logical clusters and get a suggested Conventional Commit message per
   cluster. Treat the suggestions as a draft, not gospel — adjust wording or
   re-cluster by hand if they mix unrelated changes.
2. **Review Diffs**: Run `git diff --cached` (or equivalent) to ensure no
   debug code, console logs, or sensitive data (secrets) are being
   committed.
3. **Format Message**: Use the Conventional Commits format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `refactor:` for code changes that neither fix a bug nor add a feature
   - `chore:` for updating builds, dependencies, or tools
   - `docs:` for documentation changes
4. **Commit**: 
   // turbo
   Stage each cluster separately and commit with
   `git commit -m "<type>(<scope>): <description>"`, using Chowa's
   suggestion (edited as needed) as the description.
5. **Push/Deploy**: Only push after local verification or if explicitly
   permitted.
