/**
 * Server entry point (M7-C).
 *
 * Boots in a fixed order: validate configuration → connect the datastore →
 * optionally seed → bind the port. A failure at any step exits non-zero with a
 * single actionable line rather than serving a half-configured API.
 */
import { createApp } from './http/app';
import { config, describeConfig } from './config/env';
import { connectDatabase, disconnectDatabase } from './db/connection';
import { createContext } from './app-context';
import { runSeed } from './seed/seed';

async function main(): Promise<void> {
  const repos = await connectDatabase();
  const context = createContext(repos);

  if (config.seedOnStart) {
    const summary = await runSeed(context.repos);
    console.log(`[seed] ${summary.sellers} sellers, ${summary.products} products, ${summary.orders} orders`);
  }

  const app = createApp(context);
  const server = app.listen(config.port, () => {
    console.log(`[http] vanta-api listening on http://127.0.0.1:${config.port}${config.apiBasePath}`);
    console.log(`[http] ${JSON.stringify(describeConfig())}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[http] ${signal} received, closing`);
    server.close(() => {
      void disconnectDatabase().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[boot] failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
