import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../shared/errors.js';

export interface JwtPayload {
  sub: string;
  email: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** ID do usuário autenticado (disponível após `authenticate`). */
    userId: string;
  }
}

export const authPlugin = fp<{ secret: string; expiresIn: string }>(
  async (app, { secret, expiresIn }) => {
    await app.register(fastifyJwt, { secret, sign: { expiresIn } });

    app.decorateRequest('userId', '');

    app.decorate('authenticate', async (request: FastifyRequest) => {
      try {
        await request.jwtVerify();
      } catch {
        throw new AppError(401, 'UNAUTHORIZED', 'Token ausente, inválido ou expirado');
      }
      request.userId = request.user.sub;
    });
  },
  { name: 'auth' },
);
