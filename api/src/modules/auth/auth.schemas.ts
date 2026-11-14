import { z } from 'zod';

export const registerBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(128),
});

export const loginBodySchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(128),
});

export const userResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  createdAt: z.iso.datetime(),
});

export const authResponseSchema = z.object({
  token: z.string(),
  user: userResponseSchema,
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;

export function toUserResponse(row: {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}): UserResponse {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.createdAt.toISOString() };
}
