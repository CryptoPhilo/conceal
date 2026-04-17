import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { maskingAddressRoutes } from "./routes/masking-addresses.js";
import { filterRulesRoutes } from "./routes/filter-rules.js";
import { internalRoutes } from "./routes/internal.js";

const app = Fastify({ logger: true });

app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });

app.decorate("authenticate", async function (req: Parameters<typeof app.authenticate>[0], reply: Parameters<typeof app.authenticate>[1]) {
  try {
    await req.jwtVerify();
  } catch {
    reply.status(401).send({ error: "unauthorized" });
  }
});

app.register(maskingAddressRoutes, { prefix: "/v1" });
app.register(filterRulesRoutes, { prefix: "/v1" });
app.register(internalRoutes, { prefix: "/v1" });

app.get("/health", async () => ({ ok: true }));

const PORT = parseInt(process.env.PORT ?? "3000", 10);
app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
