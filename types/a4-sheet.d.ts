import type { DetailedHTMLProps, HTMLAttributes, Ref } from "react";
import type { A4SheetElement } from "@/lib/element/a4-sheet";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "a4-sheet": DetailedHTMLProps<HTMLAttributes<A4SheetElement>, A4SheetElement> & {
        ref?: Ref<A4SheetElement>;
        class?: string | undefined;
      };
    }
  }
}
