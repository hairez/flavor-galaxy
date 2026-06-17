import type { FastifyInstance } from 'fastify';
import type { SearchIndex } from '../searchIndex.js';

export function registerRecipe(app: FastifyInstance, index: SearchIndex): void {
  app.get<{ Params: { id: string } }>('/api/recipes/:id', async (req, reply) => {
    const doc = await index.get(req.params.id);
    if (!doc) return reply.code(404).send({ error: 'not_found' });
    return doc;
  });
}
