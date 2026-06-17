import type { FastifyInstance } from 'fastify';
import type { SearchIndex } from '../searchIndex.js';

export function registerHealth(app: FastifyInstance, index: SearchIndex): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    engine: index.engine,
    docs: await index.count(),
  }));
}
