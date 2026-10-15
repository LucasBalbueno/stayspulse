# StayPulse

## Visão completa do projeto

Aplicação full-stack para operações e rastreabilidade de reservas. O projeto recebe eventos fictícios de canais, registra seu histórico, atualiza a visão atual das reservas e sinaliza possíveis conflitos de calendário.

O StayPulse é um protótipo operacional: não se conecta à API da Stays, Airbnb, Booking ou outros canais reais. Ainda assim, o fluxo principal é executado de ponta a ponta com persistência real em MongoDB, worker de processamento, API HTTP e painel React.

## Visão geral

```text
Painel React/Vite (cenários e envio manual)
  → Proxy local /api (adiciona X-API-Key)
  → API Express (valida com Zod)
  → MongoDB (eventos e entregas)
  → Worker (processamento assíncrono)
  → Reservas e alertas de conflito

O painel consulta a API para acompanhar o resultado.
```

O recebimento de um webhook confirma o registro do evento. O worker processa o evento de forma assíncrona e o frontend consulta a API para acompanhar o resultado.

## Estrutura

```text
Stays/
├── client/       painel React, cenários e proxy local
└── server/       API, worker, regras de negócio e persistência
```

### Backend

- Node.js 24.21.0 e TypeScript.
- Express 5.
- Zod para contratos HTTP.
- Prisma ORM 6.19.3 com MongoDB.
- Pino para logs.
- Worker persistente executado a cada 250 ms.
- Autenticação por `X-API-Key`.
- Paginação por cursor.
- Unidade de trabalho transacional para reserva, alertas e conclusão do evento.

### Frontend

- React 19, TypeScript e Vite.
- Abas de eventos, reservas e alertas.
- Filtros e carregamento paginado.
- Detalhes de evento, deliveries e histórico.
- Formulário para envio manual de eventos.
- Quatro cenários independentes, cada um com botão, etapas e resultado esperado.
- Explicações técnicas em 12 tópicos e favicon SVG com a identidade do StayPulse.
- Proxy local que mantém a API key fora do navegador e do bundle.

## Funcionalidades principais

### Eventos e idempotência

- `POST /webhooks/reservations` recebe criação, atualização e cancelamento.
- `source + eventId` identifica logicamente o evento.
- Reenvio do mesmo conteúdo reutiliza o evento e cria uma nova delivery.
- Reutilização do identificador com conteúdo diferente retorna `409 EVENT_CONTENT_CONFLICT`.
- O payload original é preservado para investigação.

### Reservas

- Reservas são identificadas por `source + reservationId`.
- `sourceVersion` controla a ordem das atualizações.
- Versões antigas são ignoradas.
- Versões iguais equivalentes são ignoradas.
- Versões iguais incompatíveis são rejeitadas.
- Cancelamento é terminal e preserva o histórico.
- Eventos que chegam antes da criação ficam em `pending_reference`.

### Conflitos e processamento

- Reservas confirmadas da mesma propriedade são comparadas por intervalo.
- A regra usa intervalos semiabertos `[check-in, check-out)`.
- Checkout e check-in no mesmo dia não geram conflito.
- Conflitos abrem alertas para revisão; nenhuma reserva é cancelada automaticamente.
- Leases e tokens impedem que workers concorrentes finalizem o mesmo evento.
- Falhas usam retry com backoff; leases vencidas podem ser recuperadas.

## API

Todas as rotas exigem o cabeçalho `X-API-Key`. O backend limita JSON a 64 KB e adiciona `X-Request-ID` às respostas.

| Método e rota | Descrição |
|---|---|
| `POST /webhooks/reservations` | Recebe eventos de reserva |
| `GET /events` | Lista eventos com filtros e cursor |
| `GET /events/:id/deliveries` | Lista entregas de um evento |
| `GET /reservations` | Lista reservas projetadas |
| `GET /alerts` | Lista alertas de conflito |

Filtros principais:

- eventos: `source`, `reservationId`, `propertyId`, `type`;
- reservas: `source`, `propertyId`, `status`;
- alertas: `propertyId`.

Exemplo de payload:

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

## Cenários do painel

O frontend executa cenários contra o backend real:

1. **Atualização atrasada:** uma versão antiga é ignorada e a versão mais nova permanece.
2. **Atualização antes da criação:** o evento fica pendente e é reavaliado depois da criação.
3. **Conflito e resolução:** duas reservas sobrepostas abrem um alerta; o cancelamento de uma resolve o alerta.
4. **Evento duplicado:** o mesmo JSON gera um único evento e uma única reserva, mas registra duas entregas.

Também é possível enviar eventos manualmente e acompanhar o processamento por polling.

## Configuração e execução

Use Node.js 24.21.0. Na raiz do projeto, instale as dependências:

```sh
npm ci --prefix server
npm ci --prefix client
```

### Banco e API

Crie `server/.env` manualmente (o servidor não possui `.env.example`) e configure:

- `MONGODB_URI`, incluindo o nome do banco;
- `API_KEY` com pelo menos 16 caracteres;
- opcionalmente `HOST`, `PORT` e `LOG_LEVEL`.

MongoDB local precisa de replica set. No MongoDB Atlas, autorize o IP e permita criação de coleções e índices.

Exemplo mínimo de `server/.env` (substitua os valores pela sua configuração):

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/staypulse?replicaSet=rs0
API_KEY=<sua chave com pelo menos 16 caracteres>
```

Para um banco vazio, prepare a estrutura com o script que valida o schema, gera o Prisma Client e sincroniza coleções e índices:

```sh
npm run db:reset --prefix server
```

Se houver documentos da etapa 1, siga primeiro a migração descrita no [README do servidor](server/README.md#migração-da-etapa-1).

Inicie a API:

```sh
npm run dev --prefix server
```

### Painel

Crie `client/.env`:

```dotenv
STAYPULSE_API_URL=http://127.0.0.1:3000
STAYPULSE_API_KEY=<mesma API_KEY configurada no servidor>
```

Inicie o frontend:

```sh
npm run dev --prefix client
```

Abra o endereço informado pelo Vite, normalmente `http://127.0.0.1:5173`.

O proxy do Vite encaminha `/api` para o backend e adiciona a API key no processo Node. Não coloque credenciais em variáveis `VITE_*` nem no código executado pelo navegador.

## Testes e verificação

Backend (todos os testes ou uma categoria):

```sh
npm test --prefix server
npm run test:unit --prefix server
npm run test:integration --prefix server
```

Frontend:

```sh
npm test --prefix client
```

Para executar as duas suítes em sequência:

```sh
npm test --prefix server && npm test --prefix client
```

Para a verificação completa, execute:

```sh
# Backend: TypeScript, lint, testes e build.
npm run check --prefix server

# Frontend: testes e build com verificação de TypeScript.
npm test --prefix client
npm run build --prefix client
```

O frontend não possui script de lint. Instale as dependências dos dois diretórios: os testes do client reutilizam dependências do server.

Os testes de integração usam MongoDB temporário com replica set e servidores HTTP locais. Não leem `server/.env` nem acessam o banco da aplicação ou o Atlas. Precisam abrir portas locais, descartam o banco temporário ao terminar e dispensam iniciar a API ou o frontend manualmente. Na primeira execução, o `mongodb-memory-server` pode precisar baixar um binário.

## Recriar o banco

Com a API e os workers parados, confira a `MONGODB_URI` e execute:

```sh
npm run db:reset --prefix server
```

O script executa a sequência abaixo no servidor, interrompendo se uma etapa falhar. Os comandos equivalentes a partir da raiz são:

```sh
npm run prisma:validate --prefix server
npm run prisma:generate --prefix server
npm run prisma:push --prefix server
```

Ele recria a estrutura após um drop, sem executar o drop, limpar documentos existentes ou recuperar dados removidos. Apenas reiniciar a API ou gerar o Prisma Client não provisiona os índices.

Para inserir uma reserva de demonstração:

```sh
npm run db:seed --prefix server
```

## Documentação complementar

- [Documentação da API](server/README.md): contratos, banco, migração, consistência e operação.
- [Documentação do frontend](client/README.md): proxy, painel, cenários, filtros e testes.

## Limites atuais

O StayPulse não implementa integração real com OTAs, autenticação por usuário, autorização granular, filas externas, Redis, Kafka, microserviços, regras financeiras, capacidade multiunidade ou confirmação automática de overbooking.

Antes de evoluir para produção, seria necessário validar os cenários com equipes de operação, definir severidade dos alertas, medir tempo até identificação e resolução e planejar observabilidade, disponibilidade e segurança em maior escala.
