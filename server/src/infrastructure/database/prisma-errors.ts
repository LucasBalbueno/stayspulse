import { Prisma } from '@prisma/client';

export function isPrismaUnavailable(error: unknown): boolean {
  // Erro de inicialização do Prisma
  if (error instanceof Prisma.PrismaClientInitializationError) return true;

  // Se o erro não for um erro de request
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  // Erros comuns de conectividade com o Prisma
  if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'].includes(error.code)) return true;

  // Detalha o motivo da falha sem vazar o log do Prisma
  return error.code === 'P2010' && /server selection timeout|connection (?:closed|refused|reset)|network|timed out|dns/i.test(String(error.meta?.message ?? ''));
}
