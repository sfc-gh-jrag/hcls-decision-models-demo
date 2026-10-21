import { describe, it, expect } from "vitest"
import { explicitHumanRequest, nextStep } from "../../lib/policy"
import type { Decision } from "../../lib/decision"

const base: Decision = { route: [0.9, 0.03, 0.03, 0.02, 0.02], human: 0.1, tone: [0.9, 0.08, 0.02], score: 0.12 }

describe("explicitHumanRequest", () => {
  it("detects direct requests for a person", () => {
    expect(explicitHumanRequest("Please connect me to a live agent.")).toBe(true)
    expect(explicitHumanRequest("Can I speak to a representative?")).toBe(true)
  })
  it("ignores negations and unrelated text", () => {
    expect(explicitHumanRequest("I do not need a live agent.")).toBe(false)
    expect(explicitHumanRequest("Where can I see my bill?")).toBe(false)
  })
})

describe("nextStep", () => {
  it("keeps low-need questions in self-service", () => {
    expect(nextStep(base, "Where is my bill?").title).toBe("Continue with self-service")
  })
  it("offers the predicted queue when human need is high", () => {
    expect(nextStep({ ...base, human: 0.88 }, "I paid already").title).toBe("Offer Billing support assistance")
  })
  it("prepares a contextual handoff when the member is also frustrated", () => {
    const step = nextStep({ ...base, human: 0.9, tone: [0.1, 0.75, 0.15] }, "Third contact")
    expect(step.title).toBe("Prepare a contextual Billing support handoff")
  })
  it("honors explicit requests regardless of probability", () => {
    expect(nextStep(base, "Connect me to a live agent").title).toBe("Honor the request for a person")
  })
})
