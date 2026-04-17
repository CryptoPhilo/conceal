import type { IncomingMessage, ServerResponse } from "http";
import { buildApp } from "../packages/api/src/app.js";

const app = buildApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await app.ready();
  app.server.emit("request", req, res);
}
