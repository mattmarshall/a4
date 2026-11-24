/**
 * The Welcome page: what A4 is, written as one page. A new library starts
 * with it. It must fit the Terminal page (80 × 60) with no overflow and no
 * wrapped lines; see samples.test.ts.
 */

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
   inspector tracks fill, syntax, repetition, narrative share, and tokens.
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

Every page saves itself as a .md file in this browser. Page → New starts one.
`;
