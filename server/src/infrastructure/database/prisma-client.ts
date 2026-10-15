import { PrismaClient } from '@prisma/client';

export function createPrismaClient(uri: string) {
  return new PrismaClient({
    datasources: { db: { url: uri } },
    log: [],
  });
}
