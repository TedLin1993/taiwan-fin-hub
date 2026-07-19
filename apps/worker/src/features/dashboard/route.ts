import type { Hono } from "hono";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { isDemoMode } from "../../platform/http";
import { getDashboardSummary } from "./service";

export const dashboardRoutes = honoFactory.createApp();
registerDashboardRoutes(dashboardRoutes);

function registerDashboardRoutes(api: Hono<AppBindings>) {
  api.get("/runtime", (c) => c.json({ demoMode: isDemoMode(c.env) }));
  api.get("/summary", async (c) => c.json(await getDashboardSummary(c.env.DB)));
}
