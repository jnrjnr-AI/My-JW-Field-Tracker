import { describe, expect, it } from "vitest";
import { createBackupPayload, parseBackupPayload } from "../lib/field-service-backup";

const visit = {
  id: "visit-1",
  person: "Sample household",
  territory: "Riara",
  notes: "Return with brochure",
  needsFollowUp: true,
  createdAt: "2026-09-22T07:00:00.000Z",
  location: { latitude: -1.29, longitude: 36.82 },
};

describe("field service backups", () => {
  it("round-trips visits, timer data, and pin coordinates", () => {
    const payload = createBackupPayload([visit], 125);
    const restored = parseBackupPayload(JSON.parse(JSON.stringify(payload)));
    expect(restored.visits[0]).toMatchObject(visit);
    expect(restored.elapsedSeconds).toBe(125);
  });

  it("rejects unrelated JSON files", () => {
    expect(() => parseBackupPayload({ format: "other-app", version: 1, visits: [] })).toThrow(/not created by Field Service Manager/);
  });
});
