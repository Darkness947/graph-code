import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

/**
 * Gives every request an ID, exposed as `req.id` and the `X-Request-Id` response header.
 * It appears in server logs and in the error body so a user-reported error can be traced.
 * @type {import('express').RequestHandler}
 */
export function attachRequestId(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/**
 * Applies the security middleware from spec 7.1: trust proxy, request ID, helmet defaults,
 * CORS for the app origin with credentials, and a 100kb JSON body limit.
 * @param {import('express').Express} app
 * @param {{ TRUST_PROXY_HOPS: number, APP_ORIGIN: string }} config
 */
export function applySecurity(app, config) {
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(attachRequestId);
  app.use(helmet());
  app.use(cors({ origin: config.APP_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
}
