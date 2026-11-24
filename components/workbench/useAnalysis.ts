"use client";

/**
 * A slot's analysis: the built-in measures (recomputed when the text or the
 * preset changes) and compressibility (computed off the typing path, 250 ms
 * after the text settles).
 */

import { useEffect, useMemo, useState } from "react";
import { analyze, compressibility, type Analysis } from "@/lib/analysis";
import type { PageSpec } from "@/lib/page";

const COMPRESS_DELAY_MS = 250;

export interface SlotAnalysis {
  readonly analysis: Analysis;
  /** Deflate size over UTF-8 size; null until measured, for short text, or without CompressionStream. */
  readonly compress: number | null;
}

function useCompressibility(text: string): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      compressibility(text)
        .then((v) => {
          if (!cancelled) setValue(v);
        })
        .catch(() => {
          if (!cancelled) setValue(null);
        });
    }, COMPRESS_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text]);
  return value;
}

export function useAnalysis(text: string, spec: PageSpec): SlotAnalysis {
  const analysis = useMemo(() => analyze(text, spec), [text, spec]);
  const compress = useCompressibility(text);
  return { analysis, compress };
}
