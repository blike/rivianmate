import type { FastifyInstance } from "fastify";
import type { NotificationSettingsDto, NotificationTestResult } from "../api-types.js";
import type { AppContext } from "../context.js";
import { NotificationSettingsError, settingsUpdateSchema } from "../services/notifications.js";

export async function notificationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/settings/notifications", async (): Promise<NotificationSettingsDto> =>
    ctx.notifications.getSettings(),
  );

  app.put("/api/settings/notifications", async (request, reply) => {
    const update = settingsUpdateSchema.parse(request.body);
    try {
      return await ctx.notifications.saveSettings(update);
    } catch (err) {
      if (err instanceof NotificationSettingsError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post("/api/settings/notifications/test", async (): Promise<NotificationTestResult[]> =>
    ctx.notifications.test(),
  );
}
