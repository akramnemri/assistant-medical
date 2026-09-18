# Features

Feature-scoped code lives here once a feature has real complexity. A feature
folder owns its own components, schemas, hooks and types:

```text
src/features/conversations/
├─ components/
├─ schemas/
├─ hooks/
├─ types.ts
└─ utils.ts
```

Folders are created when the responsibility becomes real, not upfront. At the
Phase 1 skeleton stage none of these exist yet.

| Feature         | Owns                                                         | Created in |
| --------------- | ------------------------------------------------------------ | ---------- |
| `auth`          | Sign-in/sign-up forms, session helpers, auth error mapping   | Task 2.2   |
| `conversations` | Conversation list and thread UI, message rendering, realtime | Task 4.1   |
| `whatsapp`      | Connection UI, onboarding entry point, connection status     | Task 5.2   |
| `admin`         | Account approval and review tools                            | post-MVP   |
| `settings`      | Workspace and account settings                               | post-MVP   |

## Rules

- A feature may import from `src/components`, `src/lib` and `src/types`.
- A feature must **not** import from another feature. Shared code moves to
  `src/components/shared` or `src/lib` instead.
- A feature must **not** call an external provider API directly. It goes through
  `src/server` — see [../server/README.md](../server/README.md).
