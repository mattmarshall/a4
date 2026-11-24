/**
 * Narrative templates for new pages. Each must fit the Terminal page
 * (80 × 60) with no overflow and no wrapped lines; see samples.test.ts.
 */

export interface PageTemplate {
  id: string;
  name: string;
  blurb: string;
  text: string;
}

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
