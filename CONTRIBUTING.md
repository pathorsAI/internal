# Contributing

Thanks for helping. Bug reports and feature requests go in
[GitHub Issues](https://github.com/pathorsAI/internal/issues). Security problems do not:
follow [`SECURITY.md`](SECURITY.md) instead.

## Setup

You need [Bun](https://bun.sh) and a Postgres database you can throw away.

```bash
bun install
cp .env.example .env.local   # fill in DATABASE_URL, BETTER_AUTH_SECRET, ...
bun dev
```

The [Quick start](README.md#quick-start) covers the minimum, and
[`docs/local-dev.md`](docs/local-dev.md) explains how the env files map to databases.
`bun scripts/seed-demo-org.ts` fills an organization with fictional data to click around in.

## Before you open a pull request

Run the same checks CI runs, and make sure they pass:

```bash
bun run lint
bunx tsc --noEmit
bun test
bun run build
```

Also:

- Keep a PR to one change. Explain what changed and why; add screenshots for UI changes.
- Add or update tests for logic you change.
- User-facing strings go through i18n with both `zh-TW` and `en`. See
  [Internationalization](README.md#internationalization).
- Every query must stay scoped by `organization_id`.

## Commit messages

Start the subject with a bracketed type:

- `[feature]` new features
- `[fix]` bug fixes
- `[chore]` maintenance, dependencies, tooling
- `[refactor]` code changes that do not change behavior
- `[docs]` documentation only

Example: `[fix] keep invoice totals in the original currency`.

## Database migrations

- Migrations are **plain SQL** files under [`migrations/`](migrations), numbered in order.
- They are **forward-only**: never edit or delete a migration that has been merged. To undo
  something, write a new migration.
- Use standard Postgres SQL with nothing vendor-specific.
- After applying a migration, refresh the introspected schema with `bun run db:pull` and
  commit the updated `src/db/schema.ts`. The app never pushes schema.

## Data and secrets

- **Never commit real data**: no real customer, employee, bank or invoice data in code, tests,
  fixtures, screenshots or issues. Use obviously fictional names and numbers.
- **Never commit secrets**: no API keys, tokens, passwords, private keys or `.env*` files
  with real values. CI runs [gitleaks](https://github.com/gitleaks/gitleaks) on every PR.
  If a fake value in a test trips it, add a narrowly scoped entry to
  [`.gitleaks.toml`](.gitleaks.toml) and explain why in the PR.
- If you commit a real secret by accident, rotate it right away. Removing it from git
  history is not enough.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
