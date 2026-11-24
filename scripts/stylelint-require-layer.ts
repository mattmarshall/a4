/**
 * A stylelint rule: every style rule sits in a cascade layer. An unlayered
 * rule beats every layered one whatever its specificity, so one stray rule
 * would silently override the tokens, components, layout, and print layers.
 *
 * Allowed outside a layer: `@import`, `@charset`, `@custom-media`, and
 * `@layer` itself. `@media`, `@supports`, and `@container` are checked
 * through the rules inside them.
 */

import stylelint from "stylelint";

const ruleName = "a4/require-layer";
const messages = stylelint.utils.ruleMessages(ruleName, {
  unlayered: (what: string) =>
    `Put ${what} in a cascade layer (tokens, base, components, layout, or print): an unlayered rule beats every layer.`,
});

const STATEMENTS = new Set(["import", "charset", "custom-media", "layer"]);
const CONDITIONS = new Set(["media", "supports", "container"]);

type Node = { type: string; name?: string; selector?: string; parent?: Node };

function inLayer(node: Node): boolean {
  for (let p = node.parent; p && p.type !== "root"; p = p.parent) {
    if (p.type === "atrule" && p.name?.toLowerCase() === "layer") return true;
  }
  return false;
}

const rule: stylelint.Rule = (enabled: unknown) => (root, result) => {
  if (!enabled) return;
  root.walk((node) => {
    if (node.type === "atrule") {
      const name = node.name.toLowerCase();
      if (STATEMENTS.has(name) || CONDITIONS.has(name)) return;
    } else if (node.type !== "rule") {
      return;
    }
    // Keyframe steps are reported through their @keyframes.
    const parent = node.parent as Node | undefined;
    if (parent?.type === "atrule" && parent.name?.toLowerCase().endsWith("keyframes")) return;
    if (inLayer(node as Node)) return;
    const what = node.type === "rule" ? `"${node.selector}"` : `@${node.name}`;
    stylelint.utils.report({ ruleName, result, node, message: messages.unlayered(what) });
  });
};

rule.ruleName = ruleName;
rule.messages = messages;

export default stylelint.createPlugin(ruleName, rule);
