import { isConnectorId } from "@taiwan-fin-hub/core";
import { honoFactory } from "../platform/hono";

export const connectorContextMiddleware = honoFactory.createMiddleware(
  async (c, next) => {
    const connectorId = c.req.param("connectorId");
    if (!connectorId || !isConnectorId(connectorId)) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONNECTOR_NOT_FOUND",
            message: "Connector id is not supported.",
          },
        },
        404,
      );
    }

    c.set("connectorId", connectorId);
    await next();
  },
);
