import { boolean, double, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const fieldVisits = mysqlTable(
  "fieldVisits",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    clientId: varchar("clientId", { length: 64 }).notNull(),
    person: varchar("person", { length: 255 }).notNull(),
    territory: varchar("territory", { length: 120 }).notNull(),
    notes: text("notes"),
    needsFollowUp: boolean("needsFollowUp").default(false).notNull(),
    latitude: double("latitude"),
    longitude: double("longitude"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userCreatedIdx: index("fieldVisits_user_created_idx").on(table.userId, table.createdAt),
    userClientUnique: uniqueIndex("fieldVisits_user_client_unique").on(table.userId, table.clientId),
  }),
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type FieldVisit = typeof fieldVisits.$inferSelect;
export type InsertFieldVisit = typeof fieldVisits.$inferInsert;
