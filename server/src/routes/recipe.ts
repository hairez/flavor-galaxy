import type { FastifyInstance } from 'fastify';
import type { SearchIndex } from '../searchIndex.js';

export function registerRecipe(app: FastifyInstance, index: SearchIndex): void {
  app.get<{ Params: { id: string } }>('/api/recipes/:id', async (req, reply) => {
    try {
      const doc = await index.get(req.params.id);
      if (!doc) return reply.code(404).send({ error: 'not_found' });
      return doc;
    } catch (err) {
      // get() only resolves null for a genuine not-found; a thrown error means the
      // backend is unreachable/misconfigured, which must not look like a 404.
      req.log.error(err);
      return reply.code(502).send({ error: 'lookup_failed' });
    }
  });
}
