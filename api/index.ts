import type { IncomingMessage, ServerResponse } from "http";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { maskingAddressRoutes } from "../packages/api/src/routes/masking-addresses";
import { filterRulesRoutes } from "../packages/api/src/routes/filter-rules";
import { internalRoutes } from "../packages/api/src/routes/internal";
import { deliveryDestinationsRoutes } from "../packages/api/src/routes/delivery-destinations";
import { emailLogRoutes } from "../packages/api/src/routes/email-log";
import { digestRoutes } from "../packages/api/src/routes/digest";

const app = Fastify({ logger: true });

app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });

app.decorate("authenticate", async function (
  req: Parameters<typeof app.authenticate>[0],
  reply: Parameters<typeof app.authenticate>[1]
) {
  try {
    await req.jwtVerify();
  } catch {
    reply.status(401).send({ error: "unauthorized" });
  }
});

app.register(maskingAddressRoutes, { prefix: "/v1" });
app.register(filterRulesRoutes, { prefix: "/v1" });
app.register(internalRoutes, { prefix: "/v1" });
app.register(deliveryDestinationsRoutes, { prefix: "/v1" });
app.register(emailLogRoutes, { prefix: "/v1" });
app.register(digestRoutes, { prefix: "/v1" });

app.get("/health", async () => ({ ok: true }));

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await app.ready();
  app.server.emit("request", req, res);
}
