/**
 * Application policy: turns model assessments into a *proposed* next step.
 * The model decides nothing on its own, and nothing here executes a transfer.
 * Thresholds are demo values, not validated operating points.
 */
import { QUEUES, type Decision } from "./decision"

export const HUMAN_THRESHOLD = 0.6
export const FRUSTRATION_THRESHOLD = 0.5

const NEGATION = /\b(don'?t|do not|no need|not)\b[^.?!]{0,25}\b(agent|person|human|representative|connect)/i
const REQUEST =
  /\b(live|real)\s+(agent|person|human)\b|\b(speak|talk)\s+(to|with)\s+(a|an|someone|somebody)?\s*(person|human|agent|representative|someone)\b|\bconnect me\b[^.?!]{0,30}\b(agent|person|human|representative)\b/i

/** Explicit requests for a person are honored by policy, not gated by a probability. */
export function explicitHumanRequest(text: string): boolean {
  return REQUEST.test(text) && !NEGATION.test(text)
}

export interface NextStep {
  title: string
  note: string
  kind: "self-service" | "offer" | "handoff" | "requested"
}

export function topQueue(d: Decision) {
  return QUEUES[d.route.indexOf(Math.max(...d.route))]
}

export function nextStep(d: Decision, text: string): NextStep {
  const queue = topQueue(d).label
  const frustrated = d.tone[1] + d.tone[2] > FRUSTRATION_THRESHOLD

  if (explicitHumanRequest(text))
    return {
      kind: "requested",
      title: "Honor the request for a person",
      note: `The member asked for a person. Policy honors that directly and proposes ${queue}, independent of the model's probability.`,
    }
  if (d.human >= HUMAN_THRESHOLD && frustrated)
    return {
      kind: "handoff",
      title: `Prepare a contextual ${queue} handoff`,
      note: "Carry the reported issue and the steps already tried into the handoff so the member does not have to start again.",
    }
  if (d.human >= HUMAN_THRESHOLD)
    return {
      kind: "offer",
      title: `Offer ${queue} assistance`,
      note: "Human help looks warranted even though the member sounds calm. Need for help and frustration are assessed separately.",
    }
  return {
    kind: "self-service",
    title: "Continue with self-service",
    note: `Self-service can handle this for now. ${queue} remains the likely destination if a handoff is needed later.`,
  }
}
