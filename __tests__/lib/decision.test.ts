import { describe, it, expect } from "vitest"
import { buildPrompt, parseDecision, validateDraft, QUEUES, TONES } from "../../lib/decision"

// Shape mirrors a real snowflake-decision-fast AI_COMPLETE response observed on Snowhouse.
const RAW = {
  error: null,
  value: {
    answers: {
      team: {
        type: "choice",
        choice: "billing",
        confidence: 0.98,
        probabilities: { billing: 0.91, claims: 0.03, benefits: 0.02, account: 0.01, general: 0.03 },
      },
      human_assistance: { type: "noul", noul: 0.74 },
      frustration: {
        type: "score",
        score: 0.16,
        confidence: 0.7,
        legend: { "0": "Calm", "1": "Frustrated", "2": "Very frustrated" },
        probabilities: { "0": 0.86, "1": 0.12, "2": 0.02 },
      },
    },
  },
}

describe("buildPrompt", () => {
  it("asks all three question types over the member draft", () => {
    const prompt = buildPrompt("Where is my bill?")
    expect(prompt.state).toContain("Where is my bill?")
    expect(prompt.questions.team.type).toBe("choice")
    expect(Object.keys(prompt.questions.team.criteria)).toEqual(QUEUES.map(q => q.key))
    expect(prompt.questions.human_assistance.type).toBe("noul")
    expect(prompt.questions.frustration.type).toBe("score")
    expect(prompt.questions.frustration.criteria).toEqual(TONES)
  })
})

describe("parseDecision", () => {
  it("maps model probabilities into ordered display values", () => {
    const d = parseDecision(RAW)
    expect(d.route).toEqual([0.91, 0.03, 0.02, 0.01, 0.03])
    expect(d.human).toBe(0.74)
    expect(d.tone).toEqual([0.86, 0.12, 0.02])
    expect(d.score).toBe(0.16)
  })

  it("accepts the TO_JSON string form returned by SQL", () => {
    expect(parseDecision(JSON.stringify(RAW)).human).toBe(0.74)
  })

  it("throws on a model error instead of inventing values", () => {
    expect(() => parseDecision({ error: "boom", value: null })).toThrow(/boom/)
  })

  it("throws when an answer is missing", () => {
    expect(() => parseDecision({ error: null, value: { answers: {} } })).toThrow()
  })
})

describe("validateDraft", () => {
  it("rejects empty and oversized drafts", () => {
    expect(validateDraft("   ")).toMatch(/empty/i)
    expect(validateDraft("x".repeat(4001))).toMatch(/4000/)
    expect(validateDraft(42)).toMatch(/text/i)
    expect(validateDraft("Where is my bill?")).toBeNull()
  })
})
