# Testing Guide — @kortix/triggers

Tests live in `core/kortix-master/tests/unit/` and `tests/e2e/`.

## Run tests

```bash
# From core/kortix-master/
bun test tests/unit/trigger-store.test.ts
bun test tests/unit/trigger-yaml.test.ts
bun test tests/unit/trigger-actions.test.ts
bun test tests/e2e/triggers-api.test.ts

# All trigger tests
bun test tests/unit/trigger-store.test.ts tests/unit/trigger-yaml.test.ts tests/unit/trigger-actions.test.ts tests/e2e/triggers-api.test.ts
```

## Test suites

| Suite | Tests | What it covers |
|---|---|---|
| `trigger-store.test.ts` | 27 | SQLite CRUD, filtering, executions, runtime state helpers |
| `trigger-yaml.test.ts` | 15 | YAML read/write, sync, round-trip, self-trigger suppression |
| `trigger-actions.test.ts` | 11 | Prompt dispatch, command exec (stdout/stderr/exit), HTTP action, concurrency |
| `triggers-api.test.ts` | 17 | Full HTTP API lifecycle, filtering, validation, YAML sync, execution history |
