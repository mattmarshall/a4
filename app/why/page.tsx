import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Why A4: one page of context",
  description:
    "The problem A4 addresses, how a quantized page addresses it, and how to write narrative context for agents.",
};

const FIGURE_LINES = [
  "80 columns × 60 rows = 4,800 cells · 1 character = 1 cell",
  "≈1,200-token ceiling · ≈1,000 tokens of well-formed prose",
  "cell 2.225 × 4.45 mm · ≈10.5 pt mono on 12.6 pt leading",
];

export default function WhyPage() {
  return (
    <main className="prose-page">
      <Link className="back" href="/">
        ← Back to the sheet
      </Link>

      <header>
        <p className="kicker">Why A4</p>
        <h1>One page of context.</h1>
        <p className="lede">
          A4 is a drafting table for agent context. It quantizes an A4 sheet into monospace cells so you can write
          the context you plan to give an agent, see what it costs, and tell whether it is clear or merely busy.
        </p>
      </header>

      <section>
        <h2>The problem</h2>
        <div className="callout">
          <p>
            Engineers have no visible, intuitive unit for agent context, so context grows until it is expensive,
            diluted, and impossible to review.
          </p>
        </div>
        <ol>
          <li>
            <strong>Abundance removed the pressure to be concise.</strong> Context windows hold hundreds of thousands
            of tokens, so nothing pushes back when a whole JSON payload, log, or schema goes in “just in case.”
          </li>
          <li>
            <strong>Tokens are invisible.</strong> Nobody has an intuition for “1,200 tokens.” The cost, and the
            dilution, never shows up where the context is written.
          </li>
          <li>
            <strong>Structured dumps feel rigorous but are mostly scaffolding.</strong> Quotes, braces, repeated keys,
            and indentation cost cells and attention. They also leave out what the agent most needs: why the values
            are what they are, and what to do about them.
          </li>
          <li>
            <strong>Context quality has no feedback loop.</strong> We lint code and review diffs, but the context that
            steers an agent is rarely measured. At 40,000 tokens, it can’t be reviewed at all.
          </li>
        </ol>
        <p>
          The results are familiar. Agents miss the one fact that mattered among many that didn’t. Behavior drifts as
          context grows. Cost and latency climb, and people stop reading what their agents are told.
        </p>
      </section>

      <section>
        <h2>How A4 addresses it</h2>
        <h3>A page as the unit</h3>
        <p>
          The canonical page is A4, quantized into a grid where one character fills exactly one cell, so the area you
          see is the quantity you spend.
        </p>
        <figure className="figure" aria-label="The Terminal page: 80 columns by 60 rows">
          <figcaption>A4 · 210 × 297 mm</figcaption>
          {FIGURE_LINES.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </figure>
        <p>
          The page is <strong>A4</strong> because almost everyone has held one and knows what a crowded one looks
          like. It is <strong>80 columns</strong> because terminals, punch cards, and style guides already think in
          80, and <strong>monospace</strong> because it makes the page countable. Pica, Elite, and Dense presets exist
          for comparison.
        </p>

        <h3>Constraint as an instrument</h3>
        <p>
          A hard edge turns “be concise” into “make it fit,” the same move as the one-page memo or the index card.
          Text that runs past row 60 visibly falls off the sheet into a red overflow zone.
        </p>

        <h3>Make the invisible visible</h3>
        <p>
          A gauge in the right margin shows the ink on each row. Lenses recolor the sheet without touching the text:
          <strong> Syntax</strong> shows scaffolding, <strong>Repetition</strong> heats restated terms,{" "}
          <strong>Structure</strong> separates sentences from fields, and <strong>Tokens</strong> shows roughly how a
          model will chunk the text.
        </p>

        <h3>Measure it</h3>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>What it tells you</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Fill / overflow</td>
              <td>Whether it fits: rows used through the last inked row</td>
            </tr>
            <tr>
              <td>Syntax overhead</td>
              <td>Share of ink that is scaffolding (Noisy at 20% or more)</td>
            </tr>
            <tr>
              <td>Repetition</td>
              <td>Word ink spent restating terms (Noisy at 40% or more)</td>
            </tr>
            <tr>
              <td>Narrative share</td>
              <td>Sentence lines versus field lines: the why versus the what</td>
            </tr>
            <tr>
              <td>Crowding, indentation</td>
              <td>Walls of text and nesting pyramids (Busy at 65% / 12%)</td>
            </tr>
            <tr>
              <td>Tokens ≈, compressibility</td>
              <td>Relative cost and redundancy, both computed on your device</td>
            </tr>
          </tbody>
        </table>
        <p>
          These roll up into a verdict (Overflowing, Noisy, Light, Busy, or Balanced) with findings that say what to
          change. <strong>Compare</strong> puts two versions side by side and marks the better value for each
          metric.
        </p>
      </section>

      <section>
        <h2>Narrative data for agents</h2>
        <p>
          <strong>Narrative data</strong> is context written as connected explanation: what is true, why it is
          true, how the parts relate, and what should happen next. Records give an agent values. Narrative gives it
          the relationships and intent it needs to act well in cases the author didn’t anticipate.
        </p>
        <p>
          Models learned to reason from explanatory prose, and words like “because,” “so,” and “unless” carry logic
          that a record leaves implicit. Narrative also states shared values once, and a person can review a page in
          two minutes. Structure still has a place: use a table when the agent must look values up, and keep IDs,
          numbers, and code exact. <em>Tables for lookup, narrative for understanding.</em>
        </p>

        <h3>The A4 method</h3>
        <ol>
          <li>
            <strong>One page, one purpose.</strong> The first lines say who the page is for and what they will do
            with it.
          </li>
          <li>
            <strong>Situation first, next action last.</strong>
          </li>
          <li>
            <strong>Connect the facts:</strong> “X happened because Y, so Z,” not three fields.
          </li>
          <li>
            <strong>State shared values once,</strong> then list only the exceptions.
          </li>
          <li>
            <strong>Keep exact values exact.</strong> Narrative is not vague.
          </li>
          <li>
            <strong>Flat over nested:</strong> express relationships in words, not in indentation.
          </li>
          <li>
            <strong>Cut what doesn’t change behavior.</strong> Would the agent act differently without this sentence?
          </li>
          <li>
            <strong>Split by purpose, not by length.</strong> An overflowing page is usually two pages. Give the agent
            the stack.
          </li>
          <li>
            <strong>Compare before you ship.</strong> Keep every fact while lowering syntax, repetition, and tokens.
          </li>
        </ol>

        <h3>Worked example</h3>
        <table>
          <thead>
            <tr>
              <th />
              <th>Incident as JSON</th>
              <th>Same incident, narrative</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Rows</td>
              <td>115 (55 over)</td>
              <td>31</td>
            </tr>
            <tr>
              <td>Tokens ≈</td>
              <td>1,015</td>
              <td>410</td>
            </tr>
            <tr>
              <td>Syntax overhead</td>
              <td>24%</td>
              <td>1%</td>
            </tr>
            <tr>
              <td>Narrative share</td>
              <td>4%</td>
              <td>100%</td>
            </tr>
            <tr>
              <td>Verdict</td>
              <td>Overflowing</td>
              <td>Balanced</td>
            </tr>
          </tbody>
        </table>
        <p>
          The narrative isn’t just shorter. It says what the JSON can’t: the cold cache <em>caused</em> the database
          overload, confidence is medium <em>because</em> logs are missing, and one action item matters most{" "}
          <em>because</em> it alone prevents a repeat.
        </p>

        <h3>Page types</h3>
        <table>
          <thead>
            <tr>
              <th>Template</th>
              <th>Use it when</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Situation Brief</td>
              <td>An agent is about to act on something live</td>
            </tr>
            <tr>
              <td>Entity Card</td>
              <td>An agent must reason about a person, system, or customer</td>
            </tr>
            <tr>
              <td>Handoff</td>
              <td>Work moves between agents, sessions, or people</td>
            </tr>
            <tr>
              <td>Decision Record</td>
              <td>An agent must apply a past decision’s judgment to new cases</td>
            </tr>
            <tr>
              <td>Agent Charter</td>
              <td>Defining an agent’s standing context, as a one-page system prompt</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Where it fits</h2>
        <ul>
          <li>Keep system prompts and agent charters to one page.</li>
          <li>Have long-running agents hand off by compacting into a page, not a log.</li>
          <li>
            Budget context files like <code>AGENTS.md</code> at “fits on one A4” and review them like code.
          </li>
          <li>Shape tool outputs so a typical response fits a page.</li>
          <li>Teach narrative context with a before-and-after comparison.</li>
        </ul>
        <p>
          A4 is not a tokenizer, a prompt optimizer, or an AI rewriter. The thinking stays with you; A4 makes its cost
          and shape visible. Everything runs in your browser, and nothing you write leaves it.
        </p>
        <Link className="cta" href="/">
          Open the sheet
        </Link>
      </section>
    </main>
  );
}
