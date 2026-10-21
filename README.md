# Snowflake Decision Fast - HCLS Member Decision Demo

*Every member message, routed to the right care.*

A Snowflake App Runtime (Next.js) demo. As a member types a synthetic billing
message, `snowflake-decision-fast` answers three questions in one `AI_COMPLETE` call:

| Question | Type | Output |
|---|---|---|
| Route to the right team | choice | billing / claims / benefits / account / general |
| Does this need a live agent? | noul | probability of human assistance |
| Read the room | score | Calm / Frustrated / Very frustrated |

The model only decides; it writes no replies. `lib/policy.ts` turns the scores into a
**preview-only** next step (demo thresholds: human ≥ 0.6, frustration > 0.5; explicit
requests for a person are always honored). Nothing is transferred or executed.

**Synthetic text only.** Drafts go to Snowflake Cortex and AI gateway payload logging
may be enabled. Do not enter PHI.

## Layout
- `app/api/decide/route.ts` — POST `{ text }`, runs AI_COMPLETE with the prompt as a bind parameter (owner's rights).
- `lib/decision.ts` — question definitions, response parsing, input validation.
- `lib/policy.ts` — next-step policy.
- `components/decision-lab.tsx` — UI: debounced live scoring, stale-response handling, Load sample typing simulation, timings.

## Run locally
```bash
npm ci
SNOWFLAKE_CONNECTION_NAME=snowhouse npm run dev
npm test     # unset SNOWFLAKE_DEFAULT_CONNECTION_NAME if a template SDK test fails
```

## Deploy
`app.yml` (v2) targets `TEMP.JRAG.MEMBER_DECISION_LAB`, warehouse `SNOWADHOC` — edit `database`, `schema`, `query_warehouse` for your account.
```bash
snow app deploy --verbose
```
The service role needs access to `AI_COMPLETE` and the `snowflake-decision-fast` model.

## Credit
Inspired by the Snowflake Decision Fast [launch blog](https://www.snowflake.com/en/blog/snowflake-decision-fast-low-latency-ai-decisions/). PrPr docs: [AI_COMPLETE with snowflake-decision](https://docs.snowflake.com/en/LIMITEDACCESS/snowflake-cortex/ai-complete-snowflake-decision).
