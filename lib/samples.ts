/**
 * Welcome page, narrative templates, and the worked incident sample.
 * Every template and the welcome page must fit the Terminal page (80 × 60)
 * with no overflow and no wrapped lines; see samples.test.ts.
 */

export interface PageTemplate {
  id: string;
  name: string;
  blurb: string;
  text: string;
}

export const WELCOME = `A4 · ONE PAGE OF CONTEXT

This sheet is A4, quantized into a grid of 80 columns and 60 rows. Every
character takes exactly one cell, so the page is something you can see and
something you can count: 4,800 cells, roughly a thousand tokens of prose.

Why a page? Context windows are now so large that nothing stops us from
pouring whole JSON payloads, logs, and schemas into an agent. Tokens are
invisible, so the bloat is invisible too. Paper is not. You already know what
a busy page looks like, and you know when a memo should have been half as
long. A4 borrows that instinct and points it at agent context.

How to use it:

1. Write or paste the context you plan to hand an agent, right on the sheet.
2. Watch the right margin: each bar shows how much ink that row carries. The
   sidebar tracks fill, syntax, repetition, narrative share, and tokens.
3. Switch lenses to see where the cells go. Syntax shows scaffolding,
   Repetition shows what you keep restating, Structure shows sentences versus
   fields, and Tokens shows roughly how a model will chunk the text.
4. If the page overflows or reads as noisy, rewrite it as narrative. Say what
   the page is for, connect facts with “because” and “so”, state shared values
   once, and end with the next action.
5. Use Compare to put two versions side by side, then keep the one that
   carries more meaning per cell.

Rule of thumb: if it does not fit on one page, it is not one idea. Split it
into pages that each serve a single purpose, and give the agent the stack.

Every page saves itself as a .md file in this browser. Use New to start one.
`;

export const TEMPLATES: PageTemplate[] = [
  {
    id: "situation-brief",
    name: "Situation Brief",
    blurb: "Everything an agent needs before it acts on a live situation",
    text: `SITUATION BRIEF · <title>

Purpose: brief an agent that is about to act on <situation>. Read it fully,
then act on Next.

Goal. What outcome are we after, and how will we know it happened? One or two
sentences, with the measurable bar if there is one.

Context. What is true right now that the agent cannot see? Name the systems,
people, and constraints involved and how they relate. Prefer “A depends on B
because C” to a list of names.

What we know. The facts that matter, stated once. If many items share a
value, say the shared value, then list only the exceptions.

What we don’t know. The open questions, and what would answer each one.

Constraints. What the agent must not do, and why. Budgets, deadlines,
permissions, and things that look tempting but are off limits.

Decisions so far. What was already decided, by whom, and for what reason, so
the agent does not reopen it.

Next. The single next action, who it is for, and what “done” looks like.
`,
  },
  {
    id: "entity-card",
    name: "Entity Card",
    blurb: "A person, system, customer, or thing, described so an agent can reason about it",
    text: `ENTITY CARD · <name>

Purpose: tell an agent who or what <name> is, in enough depth to reason about
it, not just look it up.

Identity. What it is in one sentence, in the words its owners would use.

Why it matters. What depends on it, and what breaks or changes when it does.

How it behaves. The normal pattern first, then the known exceptions. Use
numbers where they decide things: limits, volumes, timings.

Relationships. Who owns it, who uses it, what it calls, and what calls it.
Say how each relationship works, not only that it exists.

History. The two or three past events that explain its current shape.

Handling. How an agent should treat it: what is safe, what needs a human, and
what to check before touching it.
`,
  },
  {
    id: "handoff",
    name: "Handoff",
    blurb: "Let the next agent or engineer continue without asking you anything",
    text: `HANDOFF · <workstream> · <date>

Purpose: let the next agent or engineer continue this work without asking me
anything.

Where it stands. One paragraph: what the goal was, what is done, and what is
still in flight. Be honest about what has not been verified.

What I changed. The changes that matter, each with where it lives and why it
was needed. Name the exact files, branches, or tickets.

In flight. Anything half done, running, or waiting on someone, with the state
it is in and how to check on it.

Gotchas. The things that cost me time: misleading names, flaky steps, hidden
dependencies. One sentence each, with the workaround.

Next steps. In order, and for each one, what done looks like.

Who to ask. Names, and what each of them knows that is not written down.
`,
  },
  {
    id: "decision-record",
    name: "Decision Record",
    blurb: "The reasoning behind a decision, so an agent can apply the same judgment",
    text: `DECISION RECORD · <decision>

Purpose: give an agent the reasoning behind a decision so it can apply the
same judgment to cases the decision did not anticipate.

Decision. What we decided, in one sentence, and when.

Problem. What forced a choice. Describe the pressure, not the solution.

Options considered. Each option in a sentence or two, with its main cost and
its main benefit. Include the option of doing nothing.

Why this one. The deciding factors, in order of weight. This is the part the
agent will reuse, so make the trade-offs explicit.

Consequences. What gets easier, what gets harder, and what we must now avoid.

Revisit when. The conditions under which this decision should be reopened.
`,
  },
  {
    id: "agent-charter",
    name: "Agent Charter",
    blurb: "A one-page system prompt: role, mission, boundaries, and style",
    text: `AGENT CHARTER · <agent name>

Purpose: define who this agent is, what it is for, and how it should behave.
This page is the agent’s standing context, so keep it to one page.

Role. One sentence: who the agent works for and what it is responsible for.

Mission. The outcome it optimizes for, and how success is judged. If two goals
conflict, say which one wins.

Users. Who talks to it, what they usually need, and what they already know.

Knowledge. What the agent can rely on, where its facts come from, and which
source wins when two of them disagree.

Boundaries. What it must never do, what it must ask a human about first, and
why each boundary exists.

Style. How it should sound and how long its answers should be. Give one short
example of a good answer.

When stuck. What to do when information is missing or the request is unclear.
`,
  },
];

// ---------------------------------------------------------------------------
// Worked sample: one incident, two representations, the same facts.

const incident = {
  incident: {
    id: "INC-2291",
    title: "Checkout latency spike",
    severity: "SEV2",
    status: "mitigated",
    region: "eu-west-1",
    started_at: "2026-11-20T14:02:00Z",
    mitigated_at: "2026-11-20T15:47:00Z",
    on_call: "dana.ortiz",
    impact: {
      p99_latency_ms_baseline: 300,
      p99_latency_ms_peak: 4100,
      error_rate_peak: 0.023,
      orders_slowed: 1840,
      orders_failed: 41,
      data_loss: false,
    },
    services: [
      { name: "checkout-api", status: "degraded", owner: "payments" },
      { name: "pricing-cache", status: "degraded", owner: "platform" },
      { name: "pricing-db", status: "degraded", owner: "platform" },
      { name: "cart-service", status: "healthy", owner: "payments" },
    ],
    timeline: [
      {
        time: "13:55",
        actor: "autoscaler",
        event: "pricing-cache resized from 6 to 3 nodes",
        change_id: "CHG-8812",
      },
      { time: "14:02", actor: "pagerduty", event: "p99 latency alert fired" },
      { time: "14:09", actor: "dana.ortiz", event: "acknowledged" },
      { time: "14:31", actor: "dana.ortiz", event: "pricing-db cpu 98%, cache hit rate 4%" },
      { time: "15:12", actor: "dana.ortiz", event: "pricing-cache resized to 6 nodes, warm-up started" },
      { time: "15:47", actor: "dana.ortiz", event: "p99 below 400ms, status set to mitigated" },
    ],
    root_cause: {
      summary: "autoscaler policy has no minimum node count; scaled down on stale traffic signal",
      confidence: "medium",
      confidence_note: "autoscaler logs 13:50-13:55 missing",
    },
    action_items: [
      {
        id: "AI-1",
        title: "set 6-node minimum on pricing-cache autoscaler",
        owner: "platform",
        status: "open",
        priority: "P1",
      },
      {
        id: "AI-2",
        title: "warm cache before removing nodes",
        owner: "platform",
        status: "open",
        priority: "P2",
      },
      {
        id: "AI-3",
        title: "restore autoscaler log retention",
        owner: "sre",
        status: "open",
        priority: "P2",
      },
      {
        id: "AI-4",
        title: "checkout falls back to stale prices",
        owner: "payments",
        status: "proposed",
        priority: "P3",
      },
    ],
    next_steps: ["confirm root cause with autoscaler vendor", "merge AI-1 before friday peak"],
  },
};

/** The incident as an engineer would paste it: `jq .` output. */
export const INCIDENT_JSON = `${JSON.stringify(incident, null, 2)}\n`;

/** The same facts, written as a one-page narrative brief. */
export const INCIDENT_NARRATIVE = `INCIDENT INC-2291 · CHECKOUT LATENCY SPIKE · SEV2 · MITIGATED

Purpose: brief the agent picking up follow-up work on this incident. Read it
fully, then act on Next.

What happened. On 20 Nov at 13:55 UTC the autoscaler shrank the pricing-cache
cluster in eu-west-1 from 6 nodes to 3 (change CHG-8812), just as the
afternoon peak began. The cache came back cold, with a hit rate near 4%, so
almost every checkout fell through to pricing-db, which hit 98% CPU. Checkout
p99 latency climbed from 300 ms to 4.1 s. The alert fired at 14:02 and Dana
Ortiz, on call, acknowledged it at 14:09.

Recovery. Dana resized the cache back to 6 nodes at 15:12 and let it warm up.
Latency was under 400 ms by 15:47, when the incident was marked mitigated.
Checkout-api, pricing-cache, and pricing-db were degraded throughout; the
cart service was never affected.

Impact. About 1,840 orders were slowed and 41 failed, with a peak error rate
of 2.3%. No data was lost.

Root cause, medium confidence. The autoscaler policy has no minimum node
count, so it scaled down on a stale traffic signal. Confidence is only medium
because the autoscaler logs for 13:50 to 13:55 are missing.

Open actions. Platform owns AI-1 (a 6-node minimum on the cache autoscaler)
and AI-2 (warm the cache before removing nodes). SRE owns AI-3 (restore log
retention). Payments proposed AI-4 (let checkout fall back to stale prices
rather than wait on pricing-db).

Next. Confirm the root cause with the autoscaler vendor, and get AI-1 merged
before Friday’s peak. It is the only item that prevents a repeat on its own.
`;

export interface SamplePair {
  id: string;
  name: string;
  blurb: string;
  a: string;
  b: string;
}

export const SAMPLE_PAIRS: SamplePair[] = [
  {
    id: "incident",
    name: "Incident: JSON vs narrative",
    blurb: "Same facts, two representations. Opens Compare.",
    a: INCIDENT_JSON,
    b: INCIDENT_NARRATIVE,
  },
];
