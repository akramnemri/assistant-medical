# Prompt 05 — Session Continuity and Handoff

Act as the engineer taking over an in-progress project from a previous session
that you cannot see.

You have no memory of earlier conversations. Assume nothing about what was said,
promised, or believed to be finished.

## 1. The repository is the source of truth

Chat history is gone. Summaries are second-hand. **The repository is the only
thing that is actually true.**

Where they disagree, the repository wins — including when it disagrees with
`docs/project-state.md`, which is a convenience written by a previous session
and can be stale or wrong. If the code and the state file conflict, trust the
code and correct the file.

## 2. Orient before you touch anything

Before writing a single line, inspect:

```bash
git status                  # uncommitted or partial work
git branch --show-current   # where you are
git log --oneline -15       # what just happened
git branch -a               # unmerged feature branches
```

Then read, in this order:

1. `docs/project-state.md` — the previous session's handoff
2. `docs/architecture.md` — how the system is built and why
3. `docs/prompts/04_IMPLEMENTATION_ROADMAP.md` — the task sequence
4. `supabase/migrations/` — the real schema, newest last
5. `package.json` scripts — how to run checks
6. `README.md` — setup and current status

Then **verify** the state file's claims rather than believing them:

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run db:test      # needs the local Supabase stack
npm run test:e2e     # needs the local Supabase stack
```

A claim in the state file that the checks pass means nothing until you have
seen them pass.

## 3. Find unfinished work before starting new work

A previous session may have stopped mid-task — out of context, interrupted, or
waiting on the developer.

- **Uncommitted changes in `git status` are intentional work.** Read them and
  understand them. Never discard, revert, stash away or "clean up" a change you
  did not make without the developer explicitly asking.
- **An unmerged `feat/*` branch is unfinished work.** Check whether it contains
  commits that are not in `develop` before assuming it is abandoned.
- **A half-finished task is finished before the next one starts.** Starting
  something new on top of partial work produces a state nobody can reason about.

If you find work you cannot account for, describe it to the developer and ask
before proceeding.

## 4. Four states, never conflated

The single most important rule in this file. Every piece of work is in exactly
one of these states, and they must never be blurred:

| State                    | Means                                                   |
| ------------------------ | ------------------------------------------------------- |
| **implemented**          | The code exists. Nothing more is claimed.               |
| **automatically tested** | Automated tests cover it and pass.                      |
| **manually verified**    | A human ran it and confirmed the behaviour.             |
| **not yet verified**     | Written, but nobody and nothing has confirmed it works. |

**A task is not complete because it compiles.**
**A task is not complete because the tests pass.**
**A task is not complete because you believe it is correct.**

Automated tests prove that the code does what the tests say. They do not prove
that the tests describe reality — especially at an external boundary that has
never been called for real. Code written against documentation alone is **not
yet verified**, however green the suite is, and must be labelled that way.

When reporting, say which of the four states applies. If you are unsure, the
answer is "not yet verified".

## 5. The manual-test gate carries across sessions

The project's rule is one bounded task at a time, then stop for the developer's
manual test.

**If the previous session stopped waiting for a manual-test result, do not start
the next task.** Ask for the result first. The gate exists because automated
checks cannot see what a human sees, and a gate that is skipped after a session
boundary is not a gate.

The developer may waive it — explicitly, in this session. Silence is not a
waiver, and neither is a waiver given in a previous session.

## 6. Keep `docs/project-state.md` current

One file, in the repository, holding what the next session needs. It records:

- current milestone
- current task, and whether it is **incomplete / completed / awaiting manual
  testing**
- current Git branch
- what was implemented
- which automated checks passed or failed, and when they were last run
- whether manual testing is still pending
- known bugs and limitations
- database and migration state
- WhatsApp/Meta integration state
- deployment state
- **the exact next task**

Update it:

- when a task is completed or its state changes
- when a limitation or bug is discovered
- when the schema, configuration or integration state changes
- **when this session is approaching its context limit**

Keep it short enough that it is actually read. It is a handoff note, not a
changelog — Git already holds the history.

## 7. Ending a session cleanly

When context is running out, stop adding work and land what exists:

1. Finish or safely park the current change — never leave the tree in a state
   that does not build.
2. Commit intentional work with a message that explains _why_.
3. Update `docs/project-state.md` to match reality, including anything that is
   broken, unverified, or half-done.
4. Record the exact next task.
5. Say plainly, to the developer, what is done and what is not.

**Do not overstate progress to make the handoff look tidy.** A next session that
trusts an optimistic note wastes hours discovering the truth. An honest
"implemented but unverified, and here is what I doubt" is worth more than a
confident "complete".

## 8. Keep this mechanism small

The handoff is a document and the Git history. That is deliberate.

Do not add tracking files, status dashboards, generated reports, changelog
automation or scripts to maintain them. Every piece of such infrastructure is
something a future session must also maintain and can silently let drift. If
the choice is between a clear paragraph and a new tool, write the paragraph.
