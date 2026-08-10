export type Timestamp = string;

export function timestampNow(now = new Date()): Timestamp {
  return now.toISOString();
}

/** The expiry arithmetic every token family shares. */
export function addSeconds(date: Date, seconds: number): Timestamp {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

export function isTimestamp(value: string): boolean {
  const parsed = Date.parse(value);

  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
