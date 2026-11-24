/** The time, as epoch milliseconds. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
