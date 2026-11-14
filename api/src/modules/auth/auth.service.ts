import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { AppError, PG_UNIQUE_VIOLATION, getPgError } from '../../shared/errors.js';
import type { LoginBody, RegisterBody } from './auth.schemas.js';

// Hash fixo para comparar quando o e-mail não existe — evita diferença de tempo
// que revelaria quais e-mails estão cadastrados.
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

export class AuthService {
  constructor(private readonly db: Database) {}

  async register(input: RegisterBody) {
    const passwordHash = await hashPassword(input.password);
    try {
      const [user] = await this.db
        .insert(users)
        .values({ name: input.name, email: input.email, passwordHash })
        .returning();
      return user!;
    } catch (err) {
      if (getPgError(err)?.code === PG_UNIQUE_VIOLATION) {
        throw new AppError(409, 'CONFLICT', 'E-mail já cadastrado');
      }
      throw err;
    }
  }

  async login(input: LoginBody) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email))
      .limit(1);

    const valid = await verifyPassword(input.password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !valid) {
      throw new AppError(401, 'UNAUTHORIZED', 'E-mail ou senha inválidos');
    }
    return user;
  }

  async getById(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Usuário não existe mais');
    return user;
  }
}
