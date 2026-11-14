import { z } from 'zod';
import { cashFlowTypeEnum } from '../../db/schema.js';
import { hexColorSchema, uuidSchema } from '../../shared/schemas.js';

const cashFlowType = z.enum(cashFlowTypeEnum.enumValues);

export const createCategoryBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: cashFlowType,
  parentId: uuidSchema.optional(),
  icon: z.string().trim().max(40).optional(),
  color: hexColorSchema.optional(),
  isEssential: z.boolean().default(false),
});

export const listCategoriesQuerySchema = z.object({ type: cashFlowType.optional() });

export const categoryResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: cashFlowType,
  parentId: z.uuid().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isEssential: z.boolean(),
  isSystem: z.boolean(),
});

export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;
export type CategoryResponse = z.infer<typeof categoryResponseSchema>;
