import type { FastifyInstance } from 'fastify';
import type { SearchIndex } from '../searchIndex.js';

export function registerHealth(app: FastifyInstance, index: SearchIndex): void {
  app.get('/api/health', async (req, reply) => {
    // count() hits the backend (a network call for Meili). A dependency outage
    // should report a structured degraded status, not crash the probe with a 500.
    try {
      const docs = await index.count();
      return { status: 'ok', engine: index.engine, docs };
    } catch (err) {
      req.log.error(err);
      reply.code(503);
      return { status: 'degraded', engine: index.engine, error: 'dependency_unavailable' };
    }
  });
}
