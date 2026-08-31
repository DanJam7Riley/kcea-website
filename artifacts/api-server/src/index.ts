import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./seed";
import { loadSecondaryPassword, loadTertiaryPassword } from "./lib/admin-auth";
import { startScheduledInvoicing } from "./lib/scheduled-invoicing";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Warm the secondary- and third-admin password caches from the DB BEFORE
// accepting requests. Falls back to env/default on any error, so a
// transient DB issue can't keep the server from coming up — but in the
// common case auth uses the DB-backed value from the very first request.
void Promise.all([
  loadSecondaryPassword().catch((err) =>
    logger.warn({ err }, "Initial secondary admin password load failed; using fallback"),
  ),
  loadTertiaryPassword().catch((err) =>
    logger.warn({ err }, "Initial third admin password load failed; using fallback"),
  ),
])
  .finally(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
      void seedIfEmpty();
      startScheduledInvoicing();
    });
  });
