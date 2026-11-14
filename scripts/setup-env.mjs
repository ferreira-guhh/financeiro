// Cria api/.env a partir do exemplo (se ainda não existir), com um JWT_SECRET aleatório.
// Funciona em Windows, macOS e Linux.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = 'api/.env';
if (existsSync(target)) {
  console.log('api/.env já existe — mantido como está.');
} else {
  const secret = randomBytes(48).toString('base64url');
  const content = readFileSync('api/.env.example', 'utf8').replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`);
  writeFileSync(target, content);
  console.log('api/.env criado com um JWT_SECRET aleatório. Confira o DATABASE_URL.');
}
