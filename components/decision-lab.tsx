"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { QUEUES, TONES, MAX_DRAFT_CHARS, type Decision } from "@/lib/decision"
import { HUMAN_THRESHOLD, topQueue } from "@/lib/policy"

const USE_CASES = [
  { title: "Prior Auth", side: "Provider · Payer", line: "Completeness and urgency checked live as request forms are filled." },
  { title: "Appeals Intake", side: "Payer", line: "Grievance, appeal or inquiry classified at first contact." },
  { title: "Denial Triage", side: "Provider", line: "Root cause and recovery likelihood scored on every denial." },
  { title: "Inbox Routing", side: "Provider", line: "Portal messages routed, with urgent symptoms flagged." },
  { title: "Call Compliance", side: "Payer", line: "Required disclosures checked on every agent utterance." },
  { title: "CDI Queries", side: "Provider", line: "Physician query opportunities flagged as notes are signed." },
]

const STORY = [
  { label: "Bill question", addition: "Where can I see my monthly premium bill?", insight: "Start simple: finding a bill should not need a person." },
  { label: "Payment mismatch", addition: " It says I owe $240, but my bank shows I paid that amount last week.", insight: "A new fact changes the next step: this is no longer just bill navigation." },
  { label: "Calm, but stuck", addition: " I already tried the payment-status steps twice. I am not upset, but I need someone to look into this.", insight: "Need for a person jumps once self-service has failed. Compare it with the tone card: the two are assessed separately." },
  { label: "Frustration rises", addition: " Now I am getting frustrated. This is my third contact and I keep getting sent back to the same page.", insight: "Explicit frustration pushes the tone score up; the live-agent need was already high." },
  { label: "Person requested", addition: " Please connect me to a live agent.", insight: "A direct request for a person is honored by policy, not by a probability threshold." },
].map((m, i, all) => ({ ...m, text: all.slice(0, i + 1).map(x => x.addition).join("") }))

const FULL = STORY[STORY.length - 1].text
/** Max decision calls in flight; extra keystrokes coalesce into one pending send of the latest draft. */
const SAMPLE = "I got a bill for $380. This is related to an MRI that I had done, and the claim was rejected. I was under the understanding that my benefits cover this. I am reaching out to get a copy of my covered benefits so that I can evaluate this better. Or else, can you route me to someone I can speak to regarding my benefits? This has been going on for some time and it is getting ridiculous. My patience has fully run out."
const MAX_IN_FLIGHT = 4
/** Round trips kept for the sparkline and median. */
const RTT_WINDOW = 20

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

function Sparkline({ values }: { values: number[] }) {
  const W = 120, H = 32, P = 3
  if (values.length < 2) return <svg className="rtt-spark" width={W} height={H} aria-hidden="true" />
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1
  const pts = values.map((v, i) => [P + (i * (W - 2 * P)) / (values.length - 1), H - P - ((v - lo) * (H - 2 * P)) / span])
  const zone = (W - 2 * P) / (values.length - 1)
  return (
    <svg className="rtt-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Recent round trips">
      <polyline points={pts.map(p => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.4" fill="currentColor" />
      {pts.map(([x], i) => (
        <rect key={i} x={x - zone / 2} y={0} width={zone} height={H} fill="transparent">
          <title>{`Response ${i + 1} of last ${values.length}: ${values[i]} ms`}</title>
        </rect>
      ))}
    </svg>
  )
}

type Status = "idle" | "loading" | "ready" | "error"

interface Timing { roundTripMs: number; serverMs: number; path: string }

function Bars({ labels, values, tone }: { labels: readonly string[]; values: number[] | null; tone: string }) {
  const max = values ? Math.max(...values) : -1
  return (
    <div className="bars">
      {labels.map((label, i) => {
        const v = values ? values[i] : null
        return (
          <div key={label} className={`bar ${tone} ${v !== null && v === max ? "winner" : ""}`}>
            <span>{label}</span>
            <div className="track"><div className="fill" style={{ width: `${(v ?? 0) * 100}%` }} /></div>
            <span className="value">{v === null ? "—" : `${(v * 100).toFixed(1)}%`}</span>
          </div>
        )
      })}
    </div>
  )
}

export function DecisionLab() {
  const [text, setText] = useState("")
  const [decision, setDecision] = useState<Decision | null>(null)
  const [scoredText, setScoredText] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState("")
  const [timing, setTiming] = useState<Timing | null>(null)
  const [calls, setCalls] = useState(0)
  const [rtts, setRtts] = useState<number[]>([])
  const [responses, setResponses] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [trace, setTrace] = useState<{ url: string; request: unknown; response: unknown; ms?: number } | null>(null)
  const [traceTab, setTraceTab] = useState<"request" | "response">("request")

  const seq = useRef(0)
  const applied = useRef(0)
  const inFlight = useRef(0)
  const pending = useRef<string | null>(null)

  // Fire on every keystroke (as in the Snowflake Decision Fast demo). Earlier calls are not
  // aborted; whichever newest response arrives is shown, and older ones that land later are dropped.
  const evaluate = useCallback(async (draft: string) => {
    if (!draft.trim()) {
      ++seq.current; applied.current = seq.current; pending.current = null
      setDecision(null); setScoredText(""); setStatus("idle"); setError("")
      return
    }
    if (inFlight.current >= MAX_IN_FLIGHT) { pending.current = draft; return }
    const id = ++seq.current
    inFlight.current++
    setStatus("loading")
    setCalls(c => c + 1)
    const started = performance.now()
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft }),
      })
      const raw = await res.text()
      let json: any
      try { json = JSON.parse(raw) } catch { json = { error: res.ok ? "Unexpected response from the app" : `Endpoint unavailable (${res.status}), the service may be restarting. Keep typing to retry.` } }
      const rtt = Math.round(performance.now() - started)
      if (res.ok) { setRtts(r => [...r, rtt].slice(-RTT_WINDOW)); setResponses(n => n + 1) }
      if (id <= applied.current) return // a newer draft's answer is already on screen
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
      applied.current = id
      setDecision(json.decision)
      if (json.trace) setTrace({ ...json.trace, ms: json.serverMs })
      setScoredText(draft)
      setTiming({ roundTripMs: Math.round(performance.now() - started), serverMs: json.serverMs, path: json.path })
      setStatus(id === seq.current ? "ready" : "loading"); setError("")
    } catch (e) {
      if (id < seq.current) return
      setStatus("error")
      setError(e instanceof Error ? e.message : "Decision request failed")
    } finally {
      inFlight.current--
      const next = pending.current
      if (next !== null) { pending.current = null; evaluate(next) }
    }
  }, [])

  // Live evaluation on every keystroke.
  useEffect(() => { evaluate(text) }, [text, evaluate])

  const [typeTarget, setTypeTarget] = useState<string | null>(null)
  const stop = useCallback(() => { setPlaying(false); setTypeTarget(null) }, [])

  // Demo-script beats: type toward the target a couple of characters at a time.
  useEffect(() => {
    if (typeTarget === null) return
    if (text === typeTarget) { setTypeTarget(null); return }
    const base = typeTarget.startsWith(text) ? text : ""
    const handle = setTimeout(() => setText(typeTarget.slice(0, base.length + 2)), base ? 106 : 0)
    return () => clearTimeout(handle)
  }, [typeTarget, text])

  // Walkthrough typing: advance a few characters at a time, pausing at each
  // story checkpoint long enough for the debounced live call to return.
  useEffect(() => {
    if (!playing) return
    if (text.length >= FULL.length) { setPlaying(false); return }
    const atCheckpoint = text.length > 0 && STORY.some(m => m.text.length === text.length)
    const handle = setTimeout(() => {
      const boundary = STORY.find(m => m.text.length > text.length)?.text.length ?? FULL.length
      setText(FULL.slice(0, Math.min(text.length + 3, boundary)))
    }, atCheckpoint ? 2600 : 28)
    return () => clearTimeout(handle)
  }, [playing, text])

  useEffect(() => {
    const onHide = () => document.hidden && stop()
    document.addEventListener("visibilitychange", onHide)
    return () => document.removeEventListener("visibilitychange", onHide)
  }, [stop])

  const momentIndex = STORY.findIndex(m => m.text === text.trim())
  const select = (i: number) => { stop(); setText(STORY[Math.max(0, Math.min(STORY.length - 1, i))].text) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea,input,button,a,summary")) return
      if (e.key === "ArrowRight") { e.preventDefault(); select((momentIndex < 0 ? -1 : momentIndex) + 1) }
      if (e.key === "ArrowLeft") { e.preventDefault(); select((momentIndex < 0 ? 1 : momentIndex) - 1) }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  })

  const togglePlay = () => {
    if (playing) { stop(); return }
    if (!FULL.startsWith(text) || text === FULL) setText("")
    setPlaying(true)
  }

  const stale = decision !== null && scoredText !== text.trim()
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const moment = momentIndex >= 0 ? STORY[momentIndex] : null

  const freshness =
    status === "error" ? "Decision request failed"
      : !text.trim() ? "Waiting for text"
      : status === "loading" || stale ? (decision ? "Previous draft · re-evaluating…" : "Evaluating…")
      : "Live · current draft"

  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => { setSlot(document.getElementById("header-slot")) }, [])

  return (
    <main className="shell">
      {slot && createPortal(
        <div className="rtt-bar" aria-label="Decision Endpoint Round Trip">
          <span className="eyebrow" title="Browser → app → Cortex AI Gateway /v1/systemone → browser, per successful response">Round trip ⓘ</span>
          <span className="rtt-bar-val">{rtts.length ? rtts[rtts.length - 1] : "—"}<small> ms</small></span>
          <Sparkline values={rtts} />
          <span className="eyebrow">Median · last {RTT_WINDOW}</span>
          <span className="rtt-bar-val">{median(rtts) ?? "—"}<small> ms</small></span>
          <span className="eyebrow">Responses</span>
          <span className="rtt-bar-val">{responses}</span>
        </div>, slot)}
      <header className="hero">
        <div>
          <div className="eyebrow kicker"><span className="dot" />Health plan member support / live demo</div>
          <p className="subtitle">As a member types, <strong>snowflake-decision-fast</strong> identifies the right team, assesses the need for a live agent and tracks the member’s tone—in real time.</p>
        </div>
        <div className="model">
          <div className="eyebrow">System One model / private preview</div>
          <strong>snowflake-decision-fast</strong>
        </div>
      </header>

      <div className="disclosure">
        <span className="badge live">LIVE DECISIONS</span>
      </div>

      <div className="workspace">
        <div className="left">
          <section className="card composer" aria-labelledby="composer-title">
            <div className="card-head">
              <h2 id="composer-title"><span className="arrow" aria-hidden>↳</span>Incoming member chat</h2>
            </div>
            <label className="sr" htmlFor="message">Member message draft</label>
            <textarea
              id="message"
              value={text}
              maxLength={MAX_DRAFT_CHARS}
              spellCheck={false}
              placeholder="Type a synthetic member message, or click Load sample to see it in action"
              onChange={e => { stop(); setText(e.target.value) }}
            />
            <div className="editor-meta">
              <span>{words} words / {text.length} characters</span>
              <span style={{ display: "flex", gap: 16 }}>
              <button className="text-button" onClick={() => { setPlaying(false); setText(""); setTypeTarget(SAMPLE) }}>Load sample ▸</button>
              <button className="text-button" onClick={() => { stop(); setText(""); setRtts([]); setResponses(0); setCalls(0); setTiming(null); setTrace(null); setTraceTab("request") }}>Reset ↺</button>
              </span>
            </div>
            <div className="editor-status">
              <span>{playing || typeTarget !== null ? "Typing the walkthrough…" : status === "loading" ? "Scoring the current draft…" : "Scored as you pause typing"}</span>
              <span>Never submitted to the member</span>
            </div>
          </section>


          <details className="card trace">
            <summary className="trace-head">
              <span className="eyebrow">API drill-through {trace ? `· ${trace.ms} ms` : ""}</span>
              <span className="trace-hint">Click to see what is sent and returned ▾</span>
            </summary>
            <div className="trace-tabs" role="tablist">
              {(["request", "response"] as const).map(t => (
                <button key={t} role="tab" aria-selected={traceTab === t} className={traceTab === t ? "on" : ""} onClick={() => setTraceTab(t)}>{t === "request" ? "Sent →" : "← Returned"}</button>
              ))}
              {trace && <code className="trace-url">{trace.url}</code>}
            </div>
            <pre>{trace ? JSON.stringify(traceTab === "request" ? trace.request : trace.response, null, 2) : "Start typing to see the live request and response."}</pre>
          </details>
        </div>

        <section className={`right ${stale || status === "loading" ? "is-stale" : ""}`} aria-label="Live structured decisions" aria-busy={status === "loading"}>
          <div className="decision-top">
            <span className="eyebrow">Multiple decisions / one model</span>
            <span className="freshness">{freshness}</span>
          </div>

          {status === "error" && <div className="error-box" role="alert">{error}</div>}

          <article className="card signal">
            <div className="signal-head">
              <span className="number">01</span>
              <h2>Route to the right team <span className="type">CHOICE</span></h2>
              <span className="result">{decision ? topQueue(decision).label : "Awaiting text"}</span>
            </div>
            <Bars labels={QUEUES.map(q => q.label)} values={decision?.route ?? null} tone="green" />
          </article>

          <article className="card signal">
            <div className="signal-head">
              <span className="number">02</span>
              <h2>Does this need a live agent? <span className="type">NOUL</span></h2>
              <span className="result">{decision ? (decision.human >= HUMAN_THRESHOLD ? "Human recommended" : "Self-service fits") : "Awaiting text"}</span>
            </div>
            <p className="signal-note">Need for human assistance, not clinical urgency.</p>
            <Bars labels={["Live agent", "Self-service"]} values={decision ? [decision.human, 1 - decision.human] : null} tone="purple" />
          </article>

          <article className="card signal">
            <div className="signal-head">
              <span className="number">03</span>
              <h2>Read the room <span className="type">SCORE</span></h2>
              <span className="result">{decision ? TONES[decision.tone.indexOf(Math.max(...decision.tone))] : "Awaiting text"}</span>
            </div>
            <p className="signal-note">Expressed frustration, not issue severity or eligibility for help.</p>
            <Bars labels={TONES} values={decision?.tone ?? null} tone="amber" />
            <div className="rubric">
              <span>Rubric: 0 Calm · 1 Frustrated · 2 Very frustrated</span>
              <strong>{decision?.score != null ? `${decision.score.toFixed(2)} / 2` : "— / 2"}</strong>
            </div>
          </article>
        </section>
      </div>

      <section className="card usecases" aria-labelledby="usecases-title">
        <div className="eyebrow" id="usecases-title">Where else a live decision fits · healthcare</div>
        <ul>
          {USE_CASES.map((u) => (
            <li key={u.title}>
              <strong>{u.title}</strong>
              <span className="usecase-side">{u.side}</span>
              <p>{u.line}</p>
            </li>
          ))}
        </ul>
      </section>


      <p className="refs"><span className="eyebrow">Reference URLs</span> <a href="https://www.snowflake.com/en/blog/snowflake-decision-fast-low-latency-ai-decisions/" target="_blank" rel="noopener noreferrer">Decision Fast launch</a> · <a href="https://docs.snowflake.com/en/LIMITEDACCESS/snowflake-cortex/ai-complete-snowflake-decision" target="_blank" rel="noopener noreferrer">Model documentation (private preview)</a></p>
    </main>
  )
}
