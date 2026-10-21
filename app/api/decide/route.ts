/**
 * POST /api/decide  { text }  →  { decision, serverMs, model, path: "rest" }
 *
 * REST only: Cortex AI Gateway `POST {gateway}/v1/systemone` — the call the
 * typesafe_sdk `system_one` makes. No warehouse, no SQL. Node's fetch keeps the
 * TLS connection to the gateway alive across calls, and a client abort (newer
 * keystroke) cancels the upstream request.
 */
import { getRestApiAuthHeader, getSnowflakeBaseUrl } from "@/lib/snowflake"
import { MODEL, buildPrompt, parseDecision, validateDraft } from "@/lib/decision"

export const dynamic = "force-dynamic"

const UPSTREAM_TIMEOUT_MS = 8_000

/** Gateway base from DESCRIBE AI GATEWAY SNOWFLAKE; override with AI_GATEWAY_URL. Resolved once. */
let endpoint: string | null | undefined
function systemOneUrl(): string | null {
  if (endpoint === undefined) {
    const base = process.env.AI_GATEWAY_URL?.replace(/\/$/, "")
      ?? (getSnowflakeBaseUrl() ? `${getSnowflakeBaseUrl()}/api/v2/aigateways/snowflake` : null)
    endpoint = base ? `${base}/v1/systemone` : null
  }
  return endpoint
}

function authHeaders(): Record<string, string> {
  const pat = process.env.SNOWFLAKE_PAT
  return pat
    ? { Authorization: `Bearer ${pat}`, "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN" }
    : { Authorization: getRestApiAuthHeader(), "X-Snowflake-Authorization-Token-Type": "OAUTH" }
}

export async function POST(req: Request) {
  const t0 = performance.now()
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const invalid = validateDraft(body?.text)
  if (invalid) return Response.json({ error: invalid }, { status: 400 })

  const url = systemOneUrl()
  if (!url) return Response.json({ error: "AI Gateway URL not configured." }, { status: 500 })

  const started = performance.now()
  const parseMs = Math.round(started - t0)
  const upstreamBody = { model: MODEL, ...buildPrompt(body.text) }
  let raw: unknown
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`AI Gateway ${res.status}: ${text.slice(0, 300)}`)
    raw = JSON.parse(text)
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 })
    console.error(new Date().toISOString(), "[decide] AI Gateway call failed", e)
    return Response.json({ error: e instanceof Error ? e.message : "AI Gateway call failed" }, { status: 502 })
  }
  const serverMs = Math.round(performance.now() - started)
  let decision
  try {
    decision = parseDecision(raw)
  } catch (e) {
    console.error(new Date().toISOString(), "[decide] Unusable model response", e)
    return Response.json({ error: e instanceof Error ? e.message : "Unusable model response" }, { status: 502 })
  }
  const totalMs = Math.round(performance.now() - t0)
  console.log(`[decide] parse=${parseMs}ms gateway=${serverMs}ms total=${totalMs}ms`)
  return Response.json(
    { decision, serverMs, totalMs, parseMs, model: MODEL, path: "rest", trace: { url: "POST /api/v2/aigateways/snowflake/v1/systemone", request: upstreamBody, response: raw } },
    { headers: { "Server-Timing": `parse;dur=${parseMs}, gateway;dur=${serverMs}, total;dur=${totalMs}`, "Cache-Control": "no-store" } },
  )
}
