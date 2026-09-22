import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, fieldVisits, InsertFieldVisit } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserFieldVisits(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(fieldVisits).where(eq(fieldVisits.userId, userId)).orderBy(desc(fieldVisits.createdAt));
}

export async function upsertUserFieldVisits(userId: number, visits: Omit<InsertFieldVisit, "userId" | "id">[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (const visit of visits) {
    await db.insert(fieldVisits).values({ ...visit, userId }).onDuplicateKeyUpdate({
      set: {
        person: visit.person,
        territory: visit.territory,
        notes: visit.notes,
        needsFollowUp: visit.needsFollowUp,
        latitude: visit.latitude,
        longitude: visit.longitude,
        createdAt: visit.createdAt,
        updatedAt: new Date(),
      },
    });
  }
  return getUserFieldVisits(userId);
}

export async function deleteUserFieldVisit(userId: number, clientId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(fieldVisits).where(and(eq(fieldVisits.userId, userId), eq(fieldVisits.clientId, clientId)));
}
