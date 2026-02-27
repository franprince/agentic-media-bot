---
name: workflow-executor
description: Finds and executes agentic workflows from the .agents/workflows directory.
---

# Workflow Executor Skill

This skill provides a structured way to discover and run specialized workflows defined within the codebase.

## Purpose

Workflows are codified processes (usually in Markdown) that define recurring tasks like auditing, committing, or deploying. This skill enables the agent to act on those workflows systematically.

## Instructions

### 1. Discovery
Always check the following directories for relevant workflows at the start of a multi-step task:
- `/home/fran/Documentos/agentic-media-bot/.agents/workflows`
- `/home/fran/Documentos/agentic-media-bot/.agent/workflows`

### 2. Execution Protocol
When a workflow is identified as relevant to the current user request (or if explicitly triggered via a slash command):

1. **Read**: Load the workflow file completely using `view_file`.
2. **Plan**: Incorporate the workflow steps into your current `task.md`.
3. **Run**: Execute steps sequentially.
   - **Turbo Mode**: If the workflow contains `// turbo` (applies to the next command) or `// turbo-all` (applies to all commands), set `SafeToAutoRun: true` for the corresponding `run_command` calls.
4. **Verification**: After completing all steps, perform any verification mandated by the workflow.

### 3. Creating Workflows
If you identify a new recurring pattern that should be codified:
1. Create a new `.md` file in `.agents/workflows/`.
2. Add a `description` in the YAML frontmatter.
3. Use clear, numbered steps.
4. Use `// turbo` annotations for safe, automated steps.
