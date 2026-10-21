# Snowflake Decision Fast - HCLS Member Decision Demo

*Every member message, routed to the right care.*

A Snowflake App Runtime (Next.js) demo. As a member types a synthetic message,
`snowflake-decision-fast` answers three questions in one call to the Cortex AI Gateway
System One endpoint (`POST /api/v2/aigateways/snowflake/v1/systemone`):

| Question | Type | Output |
|---|---|---|
| Route to the right team | choice | billing / claims / benefits / account / general |
| Does this need a live agent? | noul | probability of human assistance |
| Read the room | score | Calm / Frustrated / Very frustrated |

The model only decides; it writes no replies. `lib/policy.ts` turns the scores into a
**preview-only** next step (demo thresholds: human ≥ 0.6, frustration > 0.5; explicit
requests for a person are always honored). Nothing is transferred or executed.

**Synthetic text only.** Drafts go to Snowflake Cortex, and AI Gateway payload logging
may be enabled in the target account. Do not enter PHI.

## Prerequisites

### Feature status (as of Oct 2026)

| Feature | Status | What you need |
|---|---|---|
| `snowflake-decision-fast` model | **Private preview** | Account must be enabled by Snowflake. Request in `#feat-ai-functions`. Without it, calls fail with a model-not-available error. |
| Cortex AI Gateway | Public preview (open) | Nothing to enable. `USAGE` on `AI GATEWAY SNOWFLAKE` is granted to `PUBLIC` by default. |
| Snowflake App Runtime (`snow app`) | Available | Paid commercial account (not trial or gov regions), Snowflake CLI recent enough for `snow app` (`snow helpers check-version`), Node.js 22+ for local runs. |

Check the [preview features list](https://docs.snowflake.com/en/release-notes/preview-features)
for changes before relying on this table.

### Privileges

The deployed app calls the gateway with its service token, so the **owner role of the
Application Service** (the role you deploy with) needs:

```sql
-- Model access (default for PUBLIC unless an admin revoked it)
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE <deploy_role>;
-- Gateway access (default for PUBLIC unless revoked)
GRANT USAGE ON AI GATEWAY SNOWFLAKE TO ROLE <deploy_role>;
-- If the account restricts models with CORTEX_MODELS_ALLOWLIST, include the model
ALTER ACCOUNT SET CORTEX_MODELS_ALLOWLIST = '<existing list>,snowflake-decision-fast';
```

Plus the usual SAR deploy rights on the target database and schema (`USAGE`, `CREATE SERVICE`,
and `CREATE ARTIFACT REPOSITORY` on first deploy). See
[Account administrator setup](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/account-admin-setup).

Quick check that the model works in your account before deploying:

```sql
DESCRIBE AI GATEWAY SNOWFLAKE;   -- confirms gateway + endpoint
SHOW CORTEX BASE MODELS LIKE 'snowflake-decision%';
```

## Deploy to any account

`app.yml` has three targets; `shared` is the default.

| Target | Deploys to | Shareable |
|---|---|---|
| `shared` | `SNOWFLAKE_APPS.PUBLIC` (SAR admin-setup defaults) | Yes |
| `dev` | Your personal database `USER$<you>` | No |
| `snowhouse` | `TEMP.JRAG` (original SE demo) | Yes |

If your account doesn't use the admin-setup defaults, edit `database`, `schema` and
`query_warehouse` at the top of `app.yml` (or add your own target). No SQL in the app
references a database, so nothing else needs changing.

```bash
snow app validate --target shared -c <connection>
snow app deploy   --target shared -c <connection>
snow app open     --target shared -c <connection>
```

Share with other roles:

```sql
GRANT USAGE ON DATABASE <db> TO ROLE <role>;
GRANT USAGE ON SCHEMA <db>.<schema> TO ROLE <role>;
GRANT USAGE ON APPLICATION SERVICE <db>.<schema>.MEMBER_DECISION_LAB TO ROLE <role>;
```

Viewers only need `USAGE` to open the app. Model calls run as the service owner.

## Run locally

```bash
npm ci
SNOWFLAKE_CONNECTION_NAME=<connection> npm run dev
npm test
```

Locally, auth comes from either:
- `SNOWFLAKE_PAT=<programmatic access token>`, or
- an OAuth connection in `~/.snowflake/connections.toml`.

To point at a specific gateway host (for example, private connectivity), set
`AI_GATEWAY_URL` to the endpoint from `DESCRIBE AI GATEWAY SNOWFLAKE`.

## Layout
- `app/api/decide/route.ts` — POST `{ text }` → AI Gateway `/v1/systemone`; client aborts cancel the upstream call.
- `lib/decision.ts` — model ID, question definitions, response parsing, input validation.
- `lib/policy.ts` — next-step policy.
- `components/decision-lab.tsx` — UI: debounced live scoring, stale-response handling, Load sample typing simulation, timings.

## Credit
Inspired by the Snowflake Decision Fast [launch blog](https://www.snowflake.com/en/blog/snowflake-decision-fast-low-latency-ai-decisions/)
by Jessie Felix, Ali Taha, Hana Jeddy, Darek Kleczek and Stan Rudenko.
PrPr docs: [Snowflake Decision with AI_COMPLETE](https://docs.snowflake.com/en/LIMITEDACCESS/snowflake-cortex/ai-complete-snowflake-decision).
