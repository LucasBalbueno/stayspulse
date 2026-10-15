# StayPulse API

Express 5 + TypeScript + Zod + **Prisma ORM 6.19.3** + MongoDB Atlas. `prisma` e `@prisma/client` têm a mesma versão exata. Essa escolha segue o [guia oficial MongoDB](https://www.prisma.io/docs/v7/prisma-orm/quickstart/mongodb); não instalar `latest` sem revisar a compatibilidade.

## Configuração

Os comandos deste README são executados na pasta `server/`, salvo indicação contrária.

Use Node.js 24.21.0. Crie `.env` manualmente (não há `.env.example` no servidor) e configure `MONGODB_URI` com a connection string completa, incluindo o nome do banco, e `API_KEY` (mínimo 16 caracteres). No Atlas, autorize o IP e conceda ao usuário acesso ao banco e criação de índices. MongoDB local **precisa de replica set**, inclusive com apenas um nó.

Exemplo mínimo de `.env`:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/staypulse?replicaSet=rs0
API_KEY=<sua chave com pelo menos 16 caracteres>
```

Substitua a URI e a chave pela sua configuração. Para instalar e iniciar com um banco vazio:

```sh
npm ci
# Valida o schema, gera o Prisma Client e sincroniza coleções/índices.
# Banco da etapa 1: executar primeiro o procedimento de migração abaixo.
npm run db:reset
npm run dev
```

`db:reset` executa `prisma:validate`, `prisma:generate` e `prisma:push` em sequência, interrompendo se uma etapa falhar. Ele não apaga o database nem limpa os documentos existentes.

Produção: `npm run build && npm start`. `HOST` padrão `0.0.0.0`, `PORT` 3000, `LOG_LEVEL` info. `MONGODB_URI` é usada diretamente pela aplicação, pelo Prisma Client e pela CLI. Ela deve incluir o banco correto no caminho da connection string, por exemplo `mongodb+srv://usuario:senha@cluster.example.mongodb.net/staypulse?...`.

Um PrismaClient por processo é criado na inicialização. SIGINT/SIGTERM interrompem o worker, aguardam processamento/requisições e desconectam o cliente. Índices são provisionados por `db push`, não automaticamente no startup. Não usamos Prisma Migrate, reset automático ou nível `Serializable`.

## Recriar o banco após um drop

Se o database foi apagado no Atlas ou no MongoDB local, siga os passos abaixo para voltar a usar a aplicação com um banco vazio. O procedimento recria as coleções e os índices definidos no Prisma; os dados apagados só podem ser recuperados de um backup.

1. Pare todas as instâncias da API e seus workers antes de recriar a estrutura.
2. Abra o terminal na pasta `server/`. Confira no `.env` se `MONGODB_URI` aponta para o cluster e o **nome do banco** desejados. O usuário precisa de permissão para criar coleções e índices; no Atlas, o IP deve estar autorizado. Um MongoDB local precisa estar configurado como replica set.
3. Execute os comandos na ordem abaixo. Se as dependências ainda não estiverem instaladas, execute `npm ci` primeiro.

   ```sh
   # Valida o schema local.
   npm run prisma:validate

   # Regenera o Prisma Client usado pela aplicação.
   # Este comando não cria coleções nem índices no banco.
   npm run prisma:generate

   # Sincroniza o schema com o MongoDB, recriando coleções e índices,
   # inclusive os índices únicos necessários à idempotência.
   npm run prisma:push
   ```

   Para executar os três comandos acima em sequência, use `npm run db:reset` na pasta `server/`, ou `npm run db:reset --prefix server` na raiz do projeto. O script interrompe a sequência se uma etapa falhar. Ele sincroniza a estrutura após um drop; não executa o drop nem limpa os dados existentes.

4. Aguarde o `prisma:push` terminar com sucesso antes de iniciar a API. Para inspecionar as coleções, execute `npm run prisma:studio` ou use o Atlas/Compass. As coleções da aplicação são `events`, `webhook_deliveries`, `reservations`, `conflict_alerts` e `property_guards`.
5. Opcionalmente, execute `npm run db:seed` para inserir e processar uma reserva de demonstração. O seed não restaura os dados anteriores. Também é possível deixar o banco vazio e gerar novos dados pelos cenários do client.
6. Reinicie o servidor com `npm run dev`. Em produção, execute `npm run build` e depois `npm start`. Atualize os registros no client; os eventos, reservas e alertas anteriores ao drop não estarão disponíveis.

Para recriar a estrutura após o drop, o comando que acessa e sincroniza o banco é `npm run prisma:push`. Apenas gerar o Prisma Client ou reiniciar a API não provisiona os índices. Como este projeto usa MongoDB, utilize esse fluxo em vez de comandos do Prisma Migrate (`migrate dev`, `migrate deploy` ou `migrate reset`). O procedimento de **migração da etapa 1**, descrito abaixo, é destinado a documentos antigos existentes e não precisa ser executado em um banco vazio.

## Organização

- `prisma/schema.prisma`: modelos e índices; `prisma/seed.ts`: demonstração optativa (`npm run db:seed`).
- `scripts/data-migrations/`: transformação versionada de documentos.
- `src/infrastructure/database/`: cliente e unidade de trabalho Prisma.
- `src/modules/{events,reservations,alerts}`: domínio, aplicação, infraestrutura e HTTP.
- `src/modules/webhooks`: validação Zod e recebimento.
- `src/composition-root.ts`: composição das dependências.

Express → Zod → caso de uso → interfaces de repositórios → Prisma. Regras de ciclo de vida ficam em `reservations/domain/apply-event.ts`; o processador depende de `UnitOfWork`. Os repositórios transacionais compartilham exclusivamente o cliente recebido de `$transaction`.

## API

Todas as rotas exigem `X-API-Key`. JSON limitado a 64 KB. Campos desconhecidos são rejeitados.

```json
{
  "eventId": "evt-001",
  "source": "airbnb-demo",
  "sourceVersion": 1,
  "type": "reservation.created",
  "occurredAt": "2026-11-01T14:00:00Z",
  "reservation": {
    "reservationId": "res-101",
    "propertyId": "prop-17",
    "checkIn": "2026-11-10",
    "checkOut": "2026-11-15",
    "status": "confirmed"
  }
}
```

`POST /webhooks/reservations` recebe esse contrato. Atualização usa `reservation.updated` com snapshot completo. Cancelamento usa `reservation.cancelled` e `{ "reservationId": "res-101", "status": "cancelled" }`, com `propertyId` opcional. `sourceVersion` é inteiro entre 0 e 2147483647. Datas reais `YYYY-MM-DD`, checkout posterior ao check-in. `occurredAt` exige timestamp com fuso.

HTTP 201 confirma o recebimento: `{ "data": { "id": "...", "eventId": "evt-001", "status": "received" } }`. Reenvios retornam o mesmo evento e seu estado atual, sem reagendá-lo. Mesmo `source + eventId` com conteúdo diferente retorna **409 EVENT_CONTENT_CONFLICT** e registra entrega inconsistente. O hash usa JSON com chaves ordenadas, preservando diferenças nos valores; a ordem das chaves não altera o hash. O JSON original fica preservado separadamente do payload validado.

Erros de ciclo de vida são assíncronos, consultados em `/events` com estado `rejected` e motivo. HTTP também usa 401 (autenticação), 400 (JSON), 413 (tamanho), 415 (codificação não suportada), 422 (validação), 503 (indisponibilidade) e 500 (falha inesperada), sem mensagens internas de banco. Cada resposta inclui `X-Request-ID`.

| Consulta | Filtros |
|---|---|
| `GET /events` | `source`, `reservationId`, `propertyId`, `type` |
| `GET /events/:id/deliveries` | Entregas do ID interno do evento |
| `GET /reservations` | `source`, `propertyId`, `status` |
| `GET /alerts` | `propertyId`; até 100 alertas mais recentes |

Eventos, entregas e reservas aceitam `limit` (1–100, padrão 20) e `cursor`. Ordenação decrescente por data e ID; reutilize os filtros na próxima página. A timeline de uma reserva é `/events?source=...&reservationId=...`, com payload original, versões, motivos, tentativas, horários e histórico de processamento. Alertas preservam transições de abertura/resolução. As consultas não são snapshots transacionais entre páginas.

## Integração com os cenários do painel

O frontend oferece quatro cenários independentes, orquestrados em `../client/src/demo.ts`. Eles usam os mesmos endpoints dos envios manuais, sem rotas especiais de simulação no backend:

| Cenário | Comportamento confirmado pela API |
|---|---|
| Atualização atrasada | Criação v1, atualização v2 e atualização v0; a v0 fica `ignored` e a reserva mantém a v2. |
| Atualização antes da criação | Atualização v2 fica `pending_reference`; a criação v1 permite sua reavaliação e aplicação. |
| Conflito e resolução | Duas reservas sobrepostas abrem um alerta; cancelar a segunda resolve o alerta com histórico. |
| Mesmo evento novamente | O mesmo JSON reutiliza o evento e mantém uma reserva, com uma nova entrega registrada. |

Cada execução usa origem, propriedade e reservas próprias e mantém os registros para consulta. O proxy em `../client/server/api-proxy.ts` adiciona a chave antes de encaminhar as requisições. A seção técnica do painel explica snapshots, versões, autenticação, idempotência, índices, hash canônico, ciclo de vida, referência pendente, lease/token, PropertyGuard, retry com jitter e paginação.

## Regras e consistência

A identidade de uma reserva é `source + reservationId`; canais distintos podem reutilizar o ID externo. `propertyId` é interno, compartilhado pelos anúncios da mesma acomodação e imutável. Cada propriedade tem capacidade de uma unidade.

Criação gera apenas uma reserva. Atualizações aplicam snapshots completos. Versões menores são ignoradas; mesma versão equivalente não tem efeito; mesma versão incompatível é rejeitada. Uma segunda criação com versão maior é rejeitada. Alteração/cancelamento sem criação ficam em `pending_reference`, reavaliados após criação e periodicamente. Cancelamento é terminal e não exclui documentos.

Sobreposição é `a.checkIn < b.checkOut && b.checkIn < a.checkOut`, considerando apenas reservas confirmadas da mesma propriedade. Datas são persistidas em meia-noite UTC e retornam como datas de calendário. Checkout e check-in no mesmo dia são permitidos. Conflitos abrem alertas para revisão, sem rejeitar reservas. Par de IDs ordenado impede A/B e B/A duplicados; alertas são resolvidos e reabertos com histórico.

A transação altera o `PropertyGuard` antes de consultar sobreposições e escrever reservas. A leitura inicial usada para descobrir a propriedade é repetida depois do guard. Reserva, alertas e conclusão do evento são atômicos. Conflitos de escrita/unicidade repetem a transação inteira até cinco tentativas, com espera crescente e jitter.

Worker consulta a fila persistida a cada 250 ms. Aquisição usa `updateMany` condicional, verifica `count`, gera token e lease de 30 segundos. A conclusão exige token atual e lease válida; falhar nessa condição reverte toda a transação. Leases vencidas são recuperáveis. Falhas de processamento usam backoff exponencial até 60 segundos e estado `failed` após oito aquisições; `pending_reference` continua aguardando referência a cada cinco segundos. Falha de reagendamento deixa a lease expirar para recuperação. Ações externas não devem ser adicionadas dentro da transação/retry.

## Coleções e índices

| Modelo | Coleção | Unicidade |
|---|---|---|
| WebhookDelivery | webhook_deliveries | ID por entrega |
| ReservationEvent | events | source + eventId |
| Reservation | reservations | source + externalReservationId (campo BSON reservationId) |
| ConflictAlert | conflict_alerts | reservationA + reservationB |
| PropertyGuard | property_guards | propertyId |

IDs internos são ObjectId; identificadores externos são strings comuns. Schema inclui índices de fila, timeline, paginação e `[propertyId, status, checkIn]`. Medir a consulta de sobreposição com dados representativos: esse índice não otimiza sozinho ambas as desigualdades. Nenhuma exclusão física ocorre no cancelamento.

## Migração da etapa 1

Não executar `db push` sobre duplicatas existentes. Pare **todas** as APIs/workers, faça snapshot do banco e teste a restauração antes da janela de manutenção. O script usa Prisma, inclusive comandos raw para ler documentos anteriores ao schema.

```sh
npm run data:migrate                   # dry-run: leitura e relatório
npm run data:migrate -- --versions=/caminho/versions.json
npm run data:migrate -- --versions=/caminho/versions.json --apply
npm run prisma:push
```

`versions.json` mapeia ID interno antigo para versão explícita: `{ "507f1f77bcf86cd799439011": 1 }`. A versão não é inferida de `receivedAt`. Sem versões/contratos válidos, apply aborta antes de alterar documentos. Bancos mistos ou com reservas já existentes são recusados: exigem reconciliação específica das versões e conversão de datas; a etapa 1 não criava reservas.

Em uma transação, o script arquiva os documentos originais em `events_stage1_archive`, converte cada recebimento em entrega, mantém o menor ObjectId de cada chave lógica e remove somente as duplicatas já arquivadas. Conteúdo divergente vira entrega inconsistente. A projeção será reconstruída pelo worker. Não sobrescreve arquivo existente; erro reverte a transação. Uma execução concluída é reconhecida pelos hashes e não é reaplicada. O lote completo deve caber na memória e no timeout de 120 segundos; bases grandes exigem planejamento por lotes antes da execução. Rollback operacional é restaurar o snapshot completo com serviços parados, incluindo eventos, entregas e índices.

## Testes e verificação

```sh
# Todos os testes do backend: unitários e de integração.
npm test

# Executar apenas uma categoria.
npm run test:unit
npm run test:integration

# Verificação completa: TypeScript, lint, testes e build.
npm run check
```

Os testes unitários validam contratos, configuração, classificação de erros Prisma e diagnósticos de inicialização. Os testes de integração usam MongoDB real temporário (`mongodb-memory-server`, replica set de um nó), Prisma e índices criados por `db push`. Cobrem idempotência, validação, paginação, versões, referências pendentes, conflitos, rollback, lease vencida, migração e backoff de falhas.

As suítes de integração não leem `.env` nem usam Atlas. Precisam abrir portas locais e podem baixar o binário do MongoDB na primeira execução. Iniciam a API e o banco de teste automaticamente e descartam o banco ao terminar.

Para executar os testes do backend e do frontend, instale as dependências dos dois projetos e execute **na raiz**:

```sh
npm test --prefix server && npm test --prefix client
```

O frontend possui testes de integração próprios, que reutilizam dependências do backend. Consulte também as instruções de [testes do frontend](../client/README.md#testes-e-verificação) e a [visão geral do projeto](../readme.md).

## Limites operacionais

Autenticação por chave é para o MVP; assinatura de provedores, autorização por usuário e inventário multiunidade ficam fora do escopo. A primeira entrega e o evento são inseridos na mesma transação; duplicatas registram nova entrega sem alterar o evento. Requisições rejeitadas antes da validação não geram WebhookDelivery. `failed` requer diagnóstico e reagendamento operacional explícito. Monitorar fila, falhas e pending_reference sem criação.
