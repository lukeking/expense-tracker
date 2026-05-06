# Spec Kit Workflow

Commands are Claude Code slash commands — type them in the Claude Code prompt.

## Standard order for a new feature

```
/speckit-specify   → creates specs/<feature>/spec.md from your description
/speckit-clarify   → asks up to 5 clarifying questions, writes answers into spec.md
/speckit-plan      → generates plan.md, data-model.md, contracts/, research.md, quickstart.md
/speckit-tasks     → generates tasks.md with phased, numbered task checklist
/speckit-implement → executes tasks, writes code, marks tasks [X] as they complete
```

Each command reads what the previous one produced.  
You can re-run any step if requirements change — e.g. `/speckit-clarify` then `/speckit-tasks` then `/speckit-implement` to pick up only new tasks.

## Scoping an implement run

```
/speckit-implement Execute only Phase P tasks (T053–T061)
```

Pass a plain-English filter after the command name; the skill uses it to limit which tasks it runs.

## Git extension hooks

Auto-commit after each command is controlled by `.specify/extensions/git/git-config.yml`:

```yaml
auto_commit:
  default: false
  after_implement:
    enabled: true
    message: "[Spec Kit] Implement feature"
```

Trigger manually any time with `/speckit-git-commit`.

## This project

| Artifact | Path |
|---|---|
| Original description | `proposal.md` |
| Feature spec (to generate) | `specs/001-expense-tracker/spec.md` |
| Implementation plan | `specs/001-expense-tracker/plan.md` |
| Data model | `specs/001-expense-tracker/data-model.md` |
| API contracts | `specs/001-expense-tracker/contracts/` |
| Task list | `specs/001-expense-tracker/tasks.md` |

`spec.md` was skipped during the initial build — run `/speckit-specify` with `proposal.md` content to back-fill it for completeness.

## Deployment checklist (one-time)

1. Run `backend/supabase/schema.sql` on Supabase (SQL Editor → paste → Run)
2. Set Cloudflare Worker secrets: `wrangler secret put SUPABASE_URL` etc. (see `plan.md` § Secrets)
3. Deploy backend: `cd backend && wrangler deploy`
4. Register Discord slash commands: `node scripts/register-commands.js`
5. Set Discord app's Interactions Endpoint URL to your Worker URL
6. Build and sideload Android APK; grant Notification Access in device settings
