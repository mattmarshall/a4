/** Prompts for Fit to page, and cleanup of the model's reply. Pure. */

export interface PageShape {
  cols: number;
  rows: number;
}

export function systemPrompt(shape: PageShape): string {
  return [
    "You rewrite one page of context that an engineer will hand to an AI agent.",
    "",
    `The page is a sheet of paper quantized into a grid of ${shape.cols} columns and ${shape.rows} rows of monospace cells. Every character takes one cell. A line longer than ${shape.cols} characters wraps onto the next row, every newline starts a new row, and a blank line uses a row. The rewrite must fit in ${shape.rows} rows.`,
    "",
    "Keep every fact the agent needs to act: identifiers, numbers, times, names, commands, and instructions stay exact. Write it as narrative data:",
    "- Open with who the page is for and what they will do with it.",
    "- Put the situation first and the next action last.",
    '- Connect facts with words like "because", "so", and "unless" instead of listing fields.',
    "- State shared values once, then list only the exceptions. Use a small table only where the agent needs to look values up.",
    "- Cut what would not change how the agent acts.",
    "",
    "Reply with only the page text: no preamble, no commentary, and no Markdown code fences.",
  ].join("\n");
}

export function firstRequest(text: string, rowsUsed: number, shape: PageShape): string {
  const status =
    rowsUsed > shape.rows
      ? `It currently lays out to ${rowsUsed} rows, ${rowsUsed - shape.rows} more than the page holds.`
      : `It currently lays out to ${rowsUsed} of ${shape.rows} rows.`;
  return `Rewrite this page so it fits in ${shape.rows} rows of ${shape.cols} columns and reads as narrative. ${status}\n\n<page>\n${text}\n</page>`;
}

export function repairRequest(rowsUsed: number, rowsAllowed: number): string {
  return `That version lays out to ${rowsUsed} rows, ${rowsUsed - rowsAllowed} more than the ${rowsAllowed} the page holds. Shorten it to fit without dropping facts. Reply with only the page text.`;
}

/** Remove one code fence wrapping the whole reply, if the model added one. */
export function stripWrappingFence(reply: string): string {
  const m = reply.match(/^\s*```[^\n`]*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : reply.replace(/^\n+|\s+$/g, "");
}
