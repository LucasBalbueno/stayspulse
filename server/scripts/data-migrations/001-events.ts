import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { createPrismaClient } from '../../src/infrastructure/database/prisma-client.js';
import { webhookSchema } from '../../src/modules/webhooks/presentation/http/schema.js';
import { hash } from '../../src/modules/events/domain/hash.js';

// Offline migration: stop API/workers and snapshot the database first.
// Versions cannot be inferred from receivedAt. Supply an explicit reviewed map.
const prisma = createPrismaClient(process.env.MONGODB_URI!);
const apply = process.argv.includes('--apply');
const mapPath = process.argv.find(arg => arg.startsWith('--versions='))?.slice(11);
const versions: Record<string, number> = mapPath ? JSON.parse(readFileSync(mapPath, 'utf8')) : {};
type Legacy = { _id: { $oid: string }; payload: Record<string, unknown>; receivedAt: { $date: string }; requestId: string; payloadHash?: string };
try {
 const rows: Legacy[] = [];
 let after: string | undefined;
 for (;;) {
  const result = await prisma.$runCommandRaw({ find: 'events', filter: after ? { _id: { $gt: { $oid: after } } } : {}, sort: { _id: 1 }, limit: 100, batchSize: 100, singleBatch: true }) as unknown as { cursor: { firstBatch: Legacy[] } };
  rows.push(...result.cursor.firstBatch);
  if (result.cursor.firstBatch.length < 100) break;
  after = result.cursor.firstBatch.at(-1)!._id.$oid;
 }
 const legacy = rows.filter(row => !row.payloadHash);
 console.log(JSON.stringify({ total: rows.length, legacy: legacy.length, mode: apply ? 'apply' : 'dry-run' }));
 if (legacy.length) {
  if (legacy.length !== rows.length) throw new Error('Estado misto: revisar manualmente antes de migrar.');
  if (await prisma.reservation.count()) throw new Error('Há reservas existentes: reconciliar versões e converter datas em uma migração específica antes desta execução.');
  const prepared = legacy.map(row => {
   const parsed = webhookSchema.safeParse({ ...row.payload, sourceVersion: row.payload.sourceVersion ?? versions[row._id.$oid] });
   return { row, parsed };
  });
  const invalid = prepared.filter(item => !item.parsed.success).map(item => item.row._id.$oid);
  if (invalid.length) {
   console.log(JSON.stringify({ requiresVersionOrCorrection: invalid }));
   if (apply) throw new Error('Forneça versões e corrija contratos antes de aplicar. Nenhum documento alterado.');
  } else if (apply) {
   // Create archive outside transaction; never replace or delete its documents.
   const collections = await prisma.$runCommandRaw({ listCollections: 1, filter: { name: 'events_stage1_archive' } }) as unknown as { cursor: { firstBatch: unknown[] } };
   if (!collections.cursor.firstBatch.length) await prisma.$runCommandRaw({ create: 'events_stage1_archive' });
   await prisma.$transaction(async tx => {
    const groups = new Map<string, { id: string; hash: string }>();
    for (const { row, parsed } of prepared) {
     if (!parsed.success) throw new Error('Contrato inválido.');
     const payload = parsed.data;
     const payloadHash = hash(payload);
     const key = JSON.stringify([payload.source, payload.eventId]);
     const existing = groups.get(key);
     const id = existing?.id ?? row._id.$oid;
     const archive = await tx.$runCommandRaw({ insert: 'events_stage1_archive', documents: [row as unknown as Prisma.InputJsonObject] });
     if (archive.writeErrors) throw new Error('Falha ao arquivar; transação abortada.');
     await tx.webhookDelivery.create({ data: { id: row._id.$oid, eventId: id, requestId: row.requestId, receivedAt: new Date(row.receivedAt.$date), payload: row.payload as Prisma.InputJsonValue, payloadHash, outcome: existing && existing.hash !== payloadHash ? 'inconsistent' : 'accepted' } });
     if (!existing) {
      groups.set(key, { id, hash: payloadHash });
      await tx.reservationEvent.update({ where: { id }, data: { originalPayload: row.payload as Prisma.InputJsonValue, history: [], payload: payload as unknown as Prisma.InputJsonValue, payloadHash, sourceVersion: payload.sourceVersion, status: 'received', nextAttemptAt: new Date(), leaseUntil: null, leaseToken: null, attempts: 0, reason: null, processedAt: null } });
     } else {
      await tx.reservationEvent.deleteMany({ where: { id: row._id.$oid } });
     }
    }
   }, { timeout: 120000 });
   console.log('Migração concluída. Execute prisma:push antes de reiniciar a API.');
  }
 }
} finally { await prisma.$disconnect(); }
