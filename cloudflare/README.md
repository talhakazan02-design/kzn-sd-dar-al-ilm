# MENBA Workers AI

The browser can use the optional Worker after a member explicitly opts in for an individual question. The Worker receives the question, a short follow-up context when present, and up to three excerpts from the selected, currently accessible sources. The Worker uses a Supabase session only to check membership and owner permissions. It does not keep questions, answers, excerpts or session tokens in the quota store.

## Deployment order

1. Apply `MENBA-ADMIN.sql` to the existing Supabase project after validating the migration on that project's schema.
2. Deploy the Worker in this directory to the Cloudflare Workers Free account. Set `SUPABASE_PUBLISHABLE_KEY` to the existing public project key. The Worker uses its AI and SQLite Durable Object bindings. It does not need a Supabase service-role key.
3. Verify the deployed Worker with synthetic material and an owner account. Verify that a test member cannot change their limit and is blocked at a limit of zero. Confirm the selected plan and privacy settings before permitting real library excerpts.
4. Set `data-endpoint` on `#menbaCloudPilot` in the website to the HTTPS Worker URL with path `/menba/answer`. An empty endpoint keeps the connection disabled.

## Limits

The Worker reserves Neurons before either model call, uses reported token counts to settle the estimate when available, then discards the reservation. The ledger stores only the usage day, estimated Neurons, configured limits and opaque account IDs. The owner can set a daily limit of 0–10,000 for approved members. A zero limit disables model requests. Local search and learning activities use no Neurons.

The admin page displays MENBA's estimate. Cloudflare provides the official account-wide figure in its dashboard. Other Workers on the same account can consume part of the free allocation. The budget resets at midnight UTC.

## Local tests

- `node tests/check-menba-admin.mjs`
- `node tests/check-menba-admin-db.cjs` with `@electric-sql/pglite` available
- `node tests/check-menba-sources.cjs`
