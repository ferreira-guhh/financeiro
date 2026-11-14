import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { errorResponseSchema } from '../../shared/schemas.js';
import {
  authResponseSchema,
  loginBodySchema,
  registerBodySchema,
  toUserResponse,
  userResponseSchema,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';

export const authRoutes: FastifyPluginAsyncZod<{ rateLimitPerMinute: number }> = async (
  app,
  { rateLimitPerMinute },
) => {
  const service = new AuthService(app.db);
  const rateLimit = { config: { rateLimit: { max: rateLimitPerMinute, timeWindow: '1 minute' } } };

  app.post(
    '/register',
    {
      ...rateLimit,
      schema: {
        tags: ['auth'],
        body: registerBodySchema,
        response: { 201: authResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await service.register(request.body);
      const token = app.jwt.sign({ sub: user.id, email: user.email });
      return reply.status(201).send({ token, user: toUserResponse(user) });
    },
  );

  app.post(
    '/login',
    {
      ...rateLimit,
      schema: {
        tags: ['auth'],
        body: loginBodySchema,
        response: { 200: authResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      const user = await service.login(request.body);
      const token = app.jwt.sign({ sub: user.id, email: user.email });
      return { token, user: toUserResponse(user) };
    },
  );

  app.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: { tags: ['auth'], response: { 200: userResponseSchema } },
    },
    async (request) => toUserResponse(await service.getById(request.userId)),
  );
};
