/**
 * The worked sample: one incident, two representations (JSON and narrative),
 * the same facts. Compare opens them side by side.
 */

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
