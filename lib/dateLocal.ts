// lib/dateLocal.ts
const TZ = "America/Chicago";

/** Returns today's YYYY-MM-DD for America/Chicago. */
export function dateKeyChicago(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const day = parts.find(p => p.type === "day")!.value;
  return `${y}-${m}-${day}`;
}

/** Get current Chicago date key (primary function to use) */
export function getCurrentChicagoDateKey(): string {
  return dateKeyChicago();
}

/**
 * Returns YYYY-MM-DD string in the user's local timezone,
 * or in a specific IANA timezone if passed (e.g. "America/New_York").
 */
export function localDateKey(d: Date = new Date(), timeZone?: string): string {
  const tz = timeZone || TZ; // Default to Chicago
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

/** Milliseconds until the next Chicago midnight (accurate to < 60s). */
export function msUntilNextChicagoMidnight(now: Date = new Date()): number {
  const nowKey = dateKeyChicago(now);
  // Advance minute-by-minute until the date flips in Chicago
  let probe = new Date(now);
  while (dateKeyChicago(probe) === nowKey) {
    probe = new Date(probe.getTime() + 60 * 1000);
  }
  // Align to the top of the minute after the flip for a clean trigger
  const aligned = new Date(probe);
  aligned.setSeconds(0, 0);
  return aligned.getTime() - now.getTime();
}

/** "Morning" | "Afternoon" | "Evening" based on America/Chicago time. */
export function greetingForChicago(now: Date = new Date()): "Morning" | "Afternoon" | "Evening" {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour12: false,
      hour: "2-digit",
    }).format(now)
  );
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

/** Parse a YYYY-MM-DD "day key" as a LOCAL date (no UTC shift). */
export function parseDateKeyLocal(dateKey: string): Date {
  // dateKey is "YYYY-MM-DD"
  const [y, m, d] = dateKey.split("-").map(Number);
  // This creates a local Date at midnight local time (no TZ skew)
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}