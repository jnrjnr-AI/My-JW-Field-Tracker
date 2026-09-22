import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { z } from "zod";

const syncedVisitSchema = z.object({
  clientId: z.string().min(1).max(64),
  person: z.string().min(1).max(255),
  territory: z.string().min(1).max(120),
  notes: z.string().max(5000).nullable(),
  needsFollowUp: z.boolean(),
  latitude: z.number().finite().nullable(),
  longitude: z.number().finite().nullable(),
  createdAt: z.coerce.date(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  visits: router({
    list: protectedProcedure.query(({ ctx }) => db.getUserFieldVisits(ctx.user.id)),
    sync: protectedProcedure
      .input(z.object({ visits: z.array(syncedVisitSchema).max(1000) }))
      .mutation(({ ctx, input }) => db.upsertUserFieldVisits(ctx.user.id, input.visits)),
    remove: protectedProcedure
      .input(z.object({ clientId: z.string().min(1).max(64) }))
      .mutation(({ ctx, input }) => db.deleteUserFieldVisit(ctx.user.id, input.clientId)),
  }),
});

export type AppRouter = typeof appRouter;
