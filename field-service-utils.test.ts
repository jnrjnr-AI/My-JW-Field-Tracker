import { describe, expect, it } from "vitest";
import { filterByQuery, formatDuration, formatMinutes, isWithinDays } from "../lib/field-service-utils";

describe("field service core utilities", () => {
  it("formats an elapsed ministry session as padded time", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(3661)).toBe("01:01:01");
    expect(formatDuration(-20)).toBe("00:00:00");
  });

  it("formats minutes without overstating a partial minute", () => {
    expect(formatMinutes(59)).toBe("0 min");
    expect(formatMinutes(60)).toBe("1 min");
    expect(formatMinutes(179)).toBe("2 min");
  });

  it("accepts recent records and excludes future or expired records", () => {
    const now = Date.UTC(2026, 8, 22, 9, 0, 0);
    expect(isWithinDays("2026-09-20T09:00:01.000Z", 7, now)).toBe(true);
    expect(isWithinDays("2026-09-15T08:59:59.000Z", 7, now)).toBe(false);
    expect(isWithinDays("2026-09-23T09:00:00.000Z", 7, now)).toBe(false);
  });

  it("searches visit references across the intended record fields", () => {
    const records = [
      { person: "M. Wanjiku", territory: "Riara", notes: "Interested in hope" },
      { person: "Railway Flats", territory: "KHB", notes: "Not home" },
    ];
    expect(filterByQuery(records, "hope", ["person", "territory", "notes"])).toEqual([records[0]]);
    expect(filterByQuery(records, "khb", ["person", "territory", "notes"])).toEqual([records[1]]);
    expect(filterByQuery(records, "", ["person", "territory", "notes"])).toEqual(records);
  });
});
