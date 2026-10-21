import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { POST } from "../../app/api/decide/route"

vi.mock("../../lib/snowflake", () => ({
  getSnowflakeBaseUrl: () => "https://acct.snowflakecomputing.com",
  getRestApiAuthHeader: () => "Bearer svc-token",
}))

const RAW = {
  model: "snowflake-decision-fast",
  answers: {
    team: { type: "choice", choice: "billing", probabilities: { billing: 0.9, claims: 0.04, benefits: 0.03, account: 0.02, general: 0.01 } },
    human_assistance: { type: "noul", noul: 0.2 },
    frustration: { type: "score", score: 0.1, probabilities: { "0": 0.9, "1": 0.08, "2": 0.02 } },
  },
  usage: { input_tokens: 300, output_tokens: 0 },
}

const req = (body: unknown) =>
  new Request("http://localhost/api/decide", { method: "POST", body: JSON.stringify(body) })

const fetchMock = vi.fn()

describe("POST /api/decide (AI Gateway REST)", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("calls /v1/systemone with the decision-fast model and parses answers", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(RAW), { status: 200 }))
    const res = await POST(req({ text: "Where is my bill?" }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.path).toBe("rest")
    expect(json.decision.human).toBe(0.2)
    expect(json.decision.route[0]).toBe(0.9)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://acct.snowflakecomputing.com/api/v2/aigateways/snowflake/v1/systemone")
    expect(init.headers.Authorization).toBe("Bearer svc-token")
    const sent = JSON.parse(init.body)
    expect(sent.model).toBe("snowflake-decision-fast")
    expect(sent.questions.human_assistance.type).toBe("noul")
    expect(sent.state).toContain("Where is my bill?")
  })

  it("rejects empty drafts without calling the gateway", async () => {
    const res = await POST(req({ text: "  " }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON", async () => {
    const res = await POST(new Request("http://localhost/api/decide", { method: "POST", body: "{" }))
    expect(res.status).toBe(400)
  })

  it("returns 502 when the gateway errors (no SQL fallback)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response("model unavailable", { status: 503 }))
    const res = await POST(req({ text: "hello" }))
    expect(res.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
