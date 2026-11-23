/**
 * Fixture pairs for calibrating the Semantic repetition thresholds, written in
 * the register of agent context: incidents, deploys, configuration, tasks.
 *
 * - paraphrase: the same fact in different words (should reach 0.85).
 * - related: same topic, different fact (should stay below 0.85).
 * - unrelated: different topics (should stay below 0.70).
 */

export type PairKind = "paraphrase" | "related" | "unrelated";

export const CALIBRATION_PAIRS: { kind: PairKind; a: string; b: string }[] = [
  { kind: "paraphrase", a: "The deploy failed because the token expired.", b: "An expired token is why the deployment failed." },
  { kind: "paraphrase", a: "Restart the worker pool before running the migration.", b: "Before the migration runs, restart the pool of workers." },
  { kind: "paraphrase", a: "The API returns a 429 when the client exceeds its rate limit.", b: "Clients that go over the rate limit get HTTP 429 back from the API." },
  { kind: "paraphrase", a: "Do not delete the production database.", b: "Never drop the prod database." },
  { kind: "paraphrase", a: "The incident started at 14:05 UTC when checkout latency spiked.", b: "Checkout latency spiked at 14:05 UTC, which is when the incident began." },
  { kind: "paraphrase", a: "Customers on the enterprise plan get priority support.", b: "Priority support is included for enterprise-plan customers." },
  { kind: "paraphrase", a: "The cache is cleared every night at midnight.", b: "Every night at 12 a.m. the cache gets flushed." },
  { kind: "paraphrase", a: "Owner: the platform team is responsible for this service.", b: "This service is owned by the platform team." },
  { kind: "paraphrase", a: "Ask the user before sending any email on their behalf.", b: "Get the user's approval before you send email for them." },
  { kind: "paraphrase", a: "The build is slow because dependencies are not cached in CI.", b: "CI builds take long since the dependency cache is missing." },

  { kind: "related", a: "The deploy failed because the token expired.", b: "The deploy succeeded after we rotated the token." },
  { kind: "related", a: "Restart the worker pool before running the migration.", b: "The migration adds an index to the orders table." },
  { kind: "related", a: "The API returns a 429 when the client exceeds its rate limit.", b: "The API returns a 404 when the order does not exist." },
  { kind: "related", a: "Do not delete the production database.", b: "Back up the production database every six hours." },
  { kind: "related", a: "The incident started at 14:05 UTC when checkout latency spiked.", b: "The incident was resolved at 15:40 UTC after a rollback." },
  { kind: "related", a: "Customers on the enterprise plan get priority support.", b: "Customers on the free plan are limited to three projects." },
  { kind: "related", a: "The cache is cleared every night at midnight.", b: "The cache holds session data for up to an hour." },
  { kind: "related", a: "Owner: the platform team is responsible for this service.", b: "On-call: page the payments team for refund failures." },
  { kind: "related", a: "Ask the user before sending any email on their behalf.", b: "Summarize the user's unread email each morning." },
  { kind: "related", a: "The build is slow because dependencies are not cached in CI.", b: "The build fails when the lockfile is out of date." },

  { kind: "unrelated", a: "The deploy failed because the token expired.", b: "Lunch orders are due by eleven on Fridays." },
  { kind: "unrelated", a: "Restart the worker pool before running the migration.", b: "The quarterly roadmap review moved to Thursday." },
  { kind: "unrelated", a: "The API returns a 429 when the client exceeds its rate limit.", b: "Our office plants need watering twice a week." },
  { kind: "unrelated", a: "Do not delete the production database.", b: "The design team prefers serif headings in reports." },
  { kind: "unrelated", a: "The incident started at 14:05 UTC when checkout latency spiked.", b: "New hires get a laptop on their first day." },
  { kind: "unrelated", a: "Customers on the enterprise plan get priority support.", b: "The parking garage closes at nine in the evening." },
  { kind: "unrelated", a: "The cache is cleared every night at midnight.", b: "Translate the onboarding guide into Spanish." },
  { kind: "unrelated", a: "Owner: the platform team is responsible for this service.", b: "The coffee machine on floor three is broken." },
  { kind: "unrelated", a: "Ask the user before sending any email on their behalf.", b: "Quarterly revenue grew eight percent." },
  { kind: "unrelated", a: "The build is slow because dependencies are not cached in CI.", b: "The team offsite is in Lisbon this year." },
];
