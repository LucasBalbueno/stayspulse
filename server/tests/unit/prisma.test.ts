import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { isPrismaUnavailable } from '../../src/infrastructure/database/prisma-errors.js';

test('Prisma classifica indisponibilidade sem tratar erro de programação como falha de rede', () => {
  const error = (code: string, message?: string) =>
    new Prisma.PrismaClientKnownRequestError('internal-secret', {
      code,
      clientVersion: '6.19.3',
      meta: { message },
    });
  assert.equal(isPrismaUnavailable(error('P1001')), true);
  assert.equal(isPrismaUnavailable(error('P2010', 'Server selection timeout')), true);
  assert.equal(isPrismaUnavailable(error('P2010', 'Invalid query')), false);
  assert.equal(isPrismaUnavailable(error('P2002')), false);
});
