/**
 * Express application factory (M7-F).
 *
 * `createApp` takes a fully-built `AppContext` and returns a configured app; the
 * production entry point additionally binds a port. Security headers, CORS
 * allow-listing, a body-size cap and JSON parsing are applied here, and the
 * router is mounted under the versioned base path.
 */
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from '../config/env';
import { createApiRouter } from './api-router';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import type { AppContext } from '../app-context';

export function createApp(context: AppContext): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.isProduction ? 1 : false);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin(origin, callback) {
        // Native clients (Expo) send no Origin header; browsers always do.
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization', 'x-request-id', 'idempotency-key'],
      exposedHeaders: ['x-request-id', 'retry-after'],
      maxAge: 600,
    }),
  );
  app.use(requestId);
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.bodyLimit }));

  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      data: { service: 'vanta-api', apiBasePath: config.apiBasePath, docs: 'backend/README.md' },
      meta: { requestId: res.locals.requestId },
    });
  });

  app.use(config.apiBasePath, createApiRouter(context));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
