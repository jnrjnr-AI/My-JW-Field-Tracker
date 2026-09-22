import type { Visit } from "@/lib/field-service-types";

export type BackupPayload = {
  format: "field-service-manager-backup";
  version: 1;
  exportedAt: string;
  visits: Visit[];
  elapsedSeconds: number;
};

export function createBackupPayload(visits: Visit[], elapsedSeconds: number): BackupPayload {
  return {
    format: "field-service-manager-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    visits,
    elapsedSeconds: Math.max(0, Math.floor(elapsedSeconds)),
  };
}

export function parseBackupPayload(value: unknown): BackupPayload {
  if (!value || typeof value !== "object") throw new Error("This file is not a valid Field Service Manager backup.");
  const payload = value as Partial<BackupPayload>;
  if (payload.format !== "field-service-manager-backup" || payload.version !== 1 || !Array.isArray(payload.visits)) {
    throw new Error("This backup was not created by Field Service Manager or uses an unsupported version.");
  }
  const visits = payload.visits.filter((visit): visit is Visit => {
    if (!visit || typeof visit !== "object") return false;
    const candidate = visit as Visit;
    return typeof candidate.id === "string" && typeof candidate.person === "string" && typeof candidate.territory === "string" && typeof candidate.notes === "string" && typeof candidate.needsFollowUp === "boolean" && typeof candidate.createdAt === "string";
  });
  return {
    format: "field-service-manager-backup",
    version: 1,
    exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : new Date().toISOString(),
    visits,
    elapsedSeconds: typeof payload.elapsedSeconds === "number" ? Math.max(0, Math.floor(payload.elapsedSeconds)) : 0,
  };
}
