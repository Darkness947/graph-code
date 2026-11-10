import express from 'express';

/**
 * Builds the bare Express app. Routes, security middleware and the error
 * handler are added in T1.3.
 * @returns {import('express').Express}
 */
export function createServer() {
  return express();
}
