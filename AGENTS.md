# AGENTS.md

## Commands

- `npm test` — run the full test suite
- `npm run build` — build the project
- `npm run dev` — run the development task

## Code Map

- `src` — application source
- `test` — automated tests
- `docs` — project documentation

## Conventions

- Write source files as ESM using `import` and `export`.
- Import shared modules through the `@engine/*`, `@cards/*`, `@net/*`, `@ui/*`, and `@sim/*` path aliases.
- Name test files with the `*.test.ts` suffix.
