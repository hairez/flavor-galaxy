import type { FastifyInstance } from 'fastify';
import type { SearchIndex } from '../searchIndex.js';

interface SearchQuery {
  q?: string;
  limit?: string;
  offset?: string;
}

export function registerSearch(app: FastifyInstance, index: SearchIndex): void {
  app.get<{ Querystring: SearchQuery }>('/api/recipes/search', async (req, reply) => {
    const q = (req.query.q ?? '').toString();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    if (!q.trim()) {
      return { query: q, total: 0, limit, offset, took_ms: 0, hits: [] };
    }
    try {
      return await index.search(q, limit, offset);
    } catch (err) {
      req.log.error(err);
      return reply.code(502).send({ error: 'search_failed' });
    }
  });
}
