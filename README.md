# The Drop

Scarcity-based commerce. See `CLAUDE.md` for the invariants and `docs/` for the
PRD, data model, API contract, and build plan. The API under `/v1` is the
product; the web app is one client.

## Local development

Requirements: Node 22+, Docker Desktop (for the local Supabase stack).

```bash
npm install
npm run db:start          # start the local Supabase stack (Postgres, Auth, REST)
npm run dev               # Next.js dev server on http://127.0.0.1:3000
```

Environment: copy `.env.example` to `.env.local` and fill it in. For local dev,
`.env.development.local` (gitignored) points the app at the local Supabase stack
and outranks `.env.local`, so a cloud `.env.local` can stay in place. A missing
variable fails at boot with its name (`lib/env.ts`).

### Database

```bash
npm run db:reset          # re-apply all migrations + seeds to the local stack
npm run db:gate           # WP-2 invariant gate (needs DATABASE_URL to local Postgres)
```

**PostgREST caches the schema.** After `supabase db reset` (or any migration that
adds or changes a table), PostgREST keeps serving its old schema cache and the
API answers `PGRST205 "Could not find the table ... in the schema cache"` for
anything new. Reload it before hitting the API:

```bash
# reload the PostgREST schema cache against the local stack
node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:54322/postgres'});await c.connect();await c.query(\"notify pgrst, 'reload schema'\");await c.end()})()"
```

The same applies on deploy: after pushing migrations to a hosted Supabase
project, its PostgREST reloads on its own within a minute, or send the same
`NOTIFY pgrst, 'reload schema'` to make it immediate.

### Gates

```bash
npm run typecheck
npm run lint              # includes the three architectural-boundary rules
npm test
npm run openapi:check     # openapi.json must match the route definitions
npm run wp3:gate          # auth/registration end-to-end (needs the dev server running)
```
