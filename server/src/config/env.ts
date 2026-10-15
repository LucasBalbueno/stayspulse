import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\/\S+$/),
  API_KEY: z.string().min(16).refine(value => value.trim() === value),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export function readEnv(input: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(input);

  if (!result.success)
    throw new Error(`Configuração inválida: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);

  return result.data;
}
