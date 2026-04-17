import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCors from "@fastify/cors";
import { maskingAddressRoutes } from "./routes/masking-addresses.js";
import { filterRulesRoutes } from "./routes/filter-rules.js";
import { internalRoutes } from "./routes/internal.js";
import { deliveryDestinationsRoutes } from "./routes/delivery-destinations.js";
import { emailLogRoutes } from "./routes/email-log.js";
import { digestRoutes } from "./routes/digest.js";
import { oauthRoutes } from "./routes/oauth.js";
import { connectedAccountsRoutes } from "./routes/connected-accounts.js";
import { onboardingRoutes } from "./routes/onboarding.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
  });

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
  app.register(deliveryDestinationsRoutes, { prefix: "/v1" });
  app.register(emailLogRoutes, { prefix: "/v1" });
  app.register(digestRoutes, { prefix: "/v1" });
  app.register(oauthRoutes, { prefix: "/v1" });
  app.register(connectedAccountsRoutes, { prefix: "/v1" });
  app.register(onboardingRoutes, { prefix: "/v1" });

  app.get("/health", async () => ({ ok: true }));

  return app;
}
