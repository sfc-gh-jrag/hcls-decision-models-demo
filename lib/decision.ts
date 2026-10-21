/**
 * Question definitions for snowflake-decision-fast and parsing of its structured
 * response. The model returns bounded assessments only; it never writes a reply.
 */

export const MODEL = "snowflake-decision-fast"
export const MAX_DRAFT_CHARS = 4000

export const QUEUES = [
  { key: "billing", label: "Billing support", criteria: "Premium bills, payments and payment allocation" },
  { key: "claims", label: "Claims support", criteria: "Processing of claims for care received" },
  { key: "benefits", label: "Benefits support", criteria: "Plan benefits and coverage explanations" },
  { key: "account", label: "Account support", criteria: "Login and member account access" },
  { key: "general", label: "General / clarify", criteria: "Unclear, unsupported or mixed destination" },
] as const

export const TONES = ["Calm", "Frustrated", "Very frustrated"]

const POLICY_CONTEXT =
  "Health plan member chat. Self-service can explain where to find bills, ID cards and benefits, " +
  "but cannot investigate or correct payment allocations, claims decisions or account lockouts. " +
  "Payment claims in the message are member-reported and unverified."

export interface Decision {
  /** Probabilities in QUEUES order. */
  route: number[]
  /** Probability that human assistance is required (noul). */
  human: number
  /** Probabilities in TONES order. */
  tone: number[]
  /** Model's expected rubric score, 0–2, when returned. */
  score: number | null
}

export function buildPrompt(draft: string) {
  return {
    state: `${POLICY_CONTEXT}\n\nMember message (unsent draft, still being typed):\n${draft}`,
    questions: {
      team: {
        type: "choice",
        instructions: "Which supported queue is appropriate if a handoff occurs? Use the member draft and support policy.",
        criteria: Object.fromEntries(QUEUES.map(q => [q.key, q.criteria])),
      },
      human_assistance: {
        type: "noul",
        instructions:
          "Given the member draft, support policy and self-service capabilities, does this interaction require human assistance?",
      },
      frustration: {
        type: "score",
        instructions: "Assess current expressed frustration, not clinical severity or entitlement to human help.",
        criteria: TONES,
      },
    },
  }
}

export function validateDraft(text: unknown): string | null {
  if (typeof text !== "string") return "Expected a text draft."
  if (!text.trim()) return "Draft is empty."
  if (text.length > MAX_DRAFT_CHARS) return `Draft exceeds ${MAX_DRAFT_CHARS} characters.`
  return null
}

function num(value: unknown, what: string): number {
  const n = typeof value === "string" ? Number(value) : value
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`Model response missing ${what}`)
  return n
}

export function parseDecision(raw: unknown): Decision {
  const result = (typeof raw === "string" ? JSON.parse(raw) : raw) as any
  if (result?.error) throw new Error(`Model error: ${typeof result.error === "string" ? result.error : JSON.stringify(result.error)}`)
  // REST (/v1/systemone) returns answers at the top level; AI_COMPLETE nests them under value.
  const answers = result?.answers ?? result?.value?.answers
  if (!answers) throw new Error("Model response missing answers")

  const team = answers.team?.probabilities
  const tone = answers.frustration?.probabilities
  if (!team || !tone) throw new Error("Model response missing probabilities")

  return {
    route: QUEUES.map(q => num(team[q.key] ?? 0, `team.${q.key}`)),
    human: num(answers.human_assistance?.noul, "human_assistance.noul"),
    tone: TONES.map((_, i) => num(tone[String(i)] ?? 0, `frustration.${i}`)),
    score: answers.frustration?.score == null ? null : num(answers.frustration.score, "frustration.score"),
  }
}
