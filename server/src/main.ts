import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './infrastructure/database/prisma-client.js';
import { startupErrorMessage, type StartupStage } from './shared/errors/startup-error.js';
import { pino } from 'pino';
import { readEnv } from './config/env.js';
import { compose } from './composition-root.js';
import { createApp } from './app.js';

async function main() {
  // Configuração incial
  const env = readEnv(process.env);
  const logger = pino({ level: env.LOG_LEVEL });

  // Cria o cliente do Prisma
  let prisma: PrismaClient | undefined;
  let stage: StartupStage = 'client';

  try {
    // Conecta ao banco de dados
    stage = 'connect';
    prisma = createPrismaClient(env.MONGODB_URI);
    await prisma.$connect();

    // Verifica se o banco de dados está respondendo
    stage = 'ping';
    await prisma.$runCommandRaw({ ping: 1 });

    // Monta as dependências da aplicação
    stage = 'listen';
    const connectedClient = prisma;
    const cases = compose(prisma);
    let working: Promise<void> | undefined;

    // Cria o servidor HTTP e inicia a escuta na porta configurada
    const server = createApp(cases, {
      apiKey: env.API_KEY,
      logger,
    }).listen(env.PORT, env.HOST);
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;

    // Espera até que o servidor esteja pronto para receber requisições ou ocorra algum erro (WEBHOOK)
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    // Inicia o processador de eventos em segundo plano (Ciclo a cada 250ms)
    const worker = setInterval(() => {
      if (working) return;

      working = cases.processEvents
        .execute()
        .then(() => undefined)
        .catch(() => {
          logger.error('Falha no processador');
        })
        .finally(() => {
          working = undefined;
        });
    }, 250);

    // Loga a mensagem de sucesso e aguarda sinais de encerramento do processo
    logger.info({ host: env.HOST, port: env.PORT }, 'API iniciada');
    let stopping = false;

    // Função para encerrar o servidor e desconectar do banco de dados
    const shutdown = () => {
      if (stopping) return;

      stopping = true;
      clearInterval(worker);
      logger.info('Encerrando API');

      const timer = setTimeout(() => {
        server.closeAllConnections();
        process.exit(1);
      }, 15_000);
      timer.unref();

      server.close(() => {
        void (async () => {
          await working;
          await connectedClient.$disconnect();
        })().then(
          () => {
            clearTimeout(timer);
          },
          () => {
            clearTimeout(timer);
            process.exitCode = 1;
          },
        );
      });
    };

    // Aguarda sinais para encerrar o processo
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    // Em caso de erro, desconecta do banco de dados e lança uma exceção com a mensagem de erro
    await prisma?.$disconnect().catch(() => undefined);
    throw new Error(startupErrorMessage(error, stage), { cause: error });
  }
}

// Inicia a aplicação e trata erros não tratados
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Falha ao iniciar API.',
  );
  process.exitCode = 1;
});
