# StayPulse · Painel de operações

Frontend React + TypeScript + Vite, integrado aos contratos de `server/`. Não contém dados de preenchimento nem simula respostas da API. Os cenários gravam eventos reais e mantêm seus registros no backend.

## Executar

Use Node.js 24.21.0 (a mesma versão do backend).

Os comandos deste README são executados na pasta `client/`, salvo indicação contrária.

1. Configure e inicie a API seguindo o [README do servidor](../server/README.md). O MongoDB precisa de replica set, índices provisionados e worker ativo.
2. Configure `client/.env` (use `.env.example` como referência):

```dotenv
STAYPULSE_API_URL=http://127.0.0.1:3000
STAYPULSE_API_KEY=<mesma API_KEY configurada no backend>
```

Copie `.env.example` para `.env` e preencha a chave. O arquivo `.env` é ignorado pelo Git. Ao trocar `API_KEY` no backend, atualize também `STAYPULSE_API_KEY` aqui; os arquivos não são sincronizados automaticamente.

3. Neste diretório:

```sh
npm ci
npm run dev
```

Abra o endereço informado pelo Vite (normalmente `http://127.0.0.1:5173`). O painel conecta automaticamente e oferece **Testar** para consultar novamente. Não pede URL ou chave no navegador.

O navegador chama `/api` na mesma origem. O processo Node do Vite lê `STAYPULSE_API_URL` e `STAYPULSE_API_KEY`, encaminha a requisição ao backend e adiciona `X-API-Key`. A chave não entra no React, no armazenamento do navegador, em logs ou no bundle. Os campos privados não têm prefixo `VITE_`. Não precisa configurar CORS para esse acesso local pelo proxy. Depois de editar `.env`, reinicie `npm run dev` (ou `npm run preview`).

O proxy substitui qualquer `X-API-Key` recebido do navegador pela chave configurada e bloqueia requisições com origem diferente. Vite e preview escutam somente em `127.0.0.1` por padrão. Não exponha este proxy autenticado na rede pública: ele dá acesso à API a quem puder acessá-lo localmente.

## Build e produção

```sh
npm run build
npm run preview
```

O build verifica TypeScript e gera `dist/`. `preview` também usa o proxy e lê a configuração privada do ambiente, para testar localmente o build sem digitar a chave. O build pode ser gerado sem a chave: a autenticação é adicionada em tempo de execução pelo servidor, não compilada no JavaScript.

Vite e preview não são servidores de produção. Ao publicar os arquivos estáticos, disponibilize um proxy/BFF de mesma origem em `/api` que adicione a chave no servidor, preservando os caminhos após remover `/api`, as respostas de erro e `X-Request-ID`. Proteja o acesso público ao painel/proxy com autenticação e autorização próprias; servir somente `dist/` não implementa esse proxy. Use HTTPS. Nunca coloque a chave em `VITE_*` ou injete credenciais no bundle.

A conexão atual usa o proxy de mesma origem. Se uma futura implantação passar a chamar uma API diretamente em outra origem, configure no backend/gateway uma lista explícita de origens permitidas, métodos `GET`, `POST`, `OPTIONS`, cabeçalhos `Content-Type` e `X-API-Key`, e exposição de `X-Request-ID`. Responda ao preflight antes da autenticação. O backend atual não configura CORS. Não use CORS aberto com credenciais.

## Cenários: “Veja o StayPulse em ação.”

Há quatro opções independentes, cada uma com seu botão de execução, etapas e resultado esperado. A orquestração fica em `src/demo.ts`; `client/server/api-proxy.ts` apenas encaminha as chamadas autenticadas, enquanto as regras são executadas na API de `../server/`.

- **Receber uma atualização atrasada:** cria a reserva v1, aplica a atualização v2 e envia uma atualização v0; confirma `ignored` e preservação das datas da v2.
- **Receber atualização antes da criação:** envia atualização v2, observa `pending_reference`, envia criação v1 e confirma a reavaliação com a reserva na v2.
- **Criar um conflito e depois resolvê-lo:** cria A e B com datas sobrepostas; confirma alerta aberto; cancela B e confirma resolução com histórico.
- **Receber o mesmo evento novamente:** cria a reserva e reenvia exatamente o mesmo JSON; confirma o mesmo evento interno, uma nova entrega e uma única reserva.
- Cada execução gera origem, propriedade e reservas com UUIDs. Datas são futuras, a partir do momento da execução. Identificadores e evidências ficam visíveis. Os dados não são apagados ao concluir ou cancelar o acompanhamento. Copie os identificadores se quiser consultá-los depois de recarregar a página.
- **Envio manual:** criação/atualização enviam snapshots completos; cancelamento contém `reservationId`, `status: cancelled` e `propertyId` opcional. Use **Novo ID** para gerar outro evento e horário; reenviar sem editar mantém os valores para testar idempotência. Validação final é do backend.

HTTP 201 indica recebimento, nunca conclusão. Depois do POST, o painel consulta `/events` por origem e reserva, percorrendo páginas para encontrar o evento lógico. O polling usa intervalo de 1,5 s, limite de 60 s por espera, e requisições com timeout de 15 s. Estados finais: `completed`, `ignored`, `rejected`, `failed`. `pending_reference` **não é final**: o cenário de atualização antes da criação pausa a espera nesse estado observado para enviar a criação necessária e depois volta a acompanhar até `completed`. No envio manual a pendência continua até o limite ou cancelamento. O botão **Retomar consulta** não reenvia o evento.

Cancelar interrompe o acompanhamento e os próximos passos da apresentação; requisições já recebidas podem continuar sendo processadas. Erros de rede no POST podem ser ambíguos: retome a consulta ou reenvie exatamente o mesmo JSON para aproveitar a idempotência. Não há retry automático de POST.

## Explicações técnicas e identidade visual

A seção **“Cada evento tem uma explicação.”**, em `src/components/Explainer.tsx`, apresenta os 12 tópicos:

| Tópico | O que explica |
|---|---|
| SNAPSHOTS | Estado completo enviado em criações e atualizações. |
| CONTROLE DE VERSÕES | Aplicação, descarte ou rejeição conforme `sourceVersion` e equivalência do estado. |
| AUTENTICAÇÃO COM X-API-KEY | Validação da chave na API e inclusão pelo proxy no servidor. |
| IDEMPOTÊNCIA | Reutilização de eventos por `source + eventId`, com entregas separadas. |
| USO DE INDEX NO DB | Índices de consulta e restrições de unicidade. |
| HASH CANÔNICO | Comparação SHA-256 com chaves JSON ordenadas. |
| CONTROLE DE CICLO DE VIDA | Estados do evento e cancelamento terminal da reserva. |
| REFERÊNCIA PENDENTE | Reavaliação de alterações recebidas antes da criação. |
| LEASE E TOKEN | Aquisição temporária e proteção contra conclusão por um worker desatualizado. |
| PROPERTYGUARD | Coordenação das transações por propriedade. |
| RETRY (com Jitter) | Repetição de transações elegíveis com espera crescente e atraso aleatório. |
| PAGINAÇÃO | Consultas por cursor e limites da interface. |

O favicon fica em `public/favicon.svg`, com o “S” e as cores da marca. A referência em `index.html` usa `%BASE_URL%`, e o Vite inclui o arquivo em `dist/` no build.

## Dados, filtros e limites

- Eventos: `source`, `propertyId`, `reservationId`, `type`; páginas de 20.
- Reservas: `source`, `propertyId`, `status`; páginas de 20.
- Alertas: apenas `propertyId`; até 100 mais recentes, conforme o backend. IDs do par são internos; quando a reserva correspondente está carregada, a interface mostra seu identificador externo e origem.
- Entregas: páginas de 20 por ID interno do evento, incluindo payload e requestId.
- Indicadores contam **somente os registros carregados**, respeitando os filtros próprios de cada consulta. Não representam totais globais.
- Aplicar filtros ou atualizar reinicia as páginas. Carregar mais preserva os filtros e usa o cursor retornado. Consultas entre páginas não são snapshots transacionais; a lista remove duplicatas por ID, mas mudanças concorrentes podem exigir atualização.
- Atualização manual fora do polling; não há assinatura em tempo real permanente. Registros antigos permanecem visíveis com aviso se uma atualização falhar.
- Datas de estadia são exibidas como calendário, sem conversão de fuso. Intervalo semiaberto `[checkIn, checkOut)`: saída e entrada no mesmo dia não se sobrepõem.

## Organização

- `src/api.ts`: HTTP, erros e requestId; o navegador chama o proxy sem chave.
- `src/connection.tsx`: contexto da conexão automática ao proxy `/api`.
- `server/api-proxy.ts` e `vite.config.ts`: configuração privada e autenticação no processo Node.
- `src/polling.ts`: consulta paginada, estados finais, cancelamento e timeout.
- `src/demo.ts`: orquestração dos cenários e verificação de evidências.
- `src/App.tsx`: consultas, filtros, paginação e composição do painel.
- `src/components/`: formulários, detalhe com entregas, badges e explicações técnicas.
- `src/styles.css`: layout responsivo, foco visível e suporte a movimento reduzido.
- `src/types.ts`: formatos do backend.
- `public/favicon.svg` e `index.html`: ícone e metadados da página.

## Testes e verificação

Instale também as dependências do backend, pois os testes usam seu loader `tsx`, Prisma, Express e MongoDB temporário:

```sh
# Na pasta client/:
npm ci --prefix ../server
npm ci
npm test
npm run build
```

`npm test` executa os testes de integração. `npm run build` verifica TypeScript e gera a versão de produção; não há script de lint configurado no client.

Os testes exercitam o cliente HTTP e os quatro cenários independentes contra a aplicação Express real e um MongoDB temporário com replica set. Cobrem idempotência e entregas, alerta aberto/resolvido, cancelamento, pendência/reavaliação, atualização atrasada, paginação, 401/422 com `requestId`, interrupção do polling e autenticação pelo proxy.

Não leem `server/.env`, não usam Atlas e geram uma chave aleatória em memória. Precisam abrir portas locais; na primeira execução, o MongoDB pode ser baixado. A API e o banco são iniciados pelos testes, e o banco temporário é descartado ao final. Os registros criados pela interface não são afetados.

Para testar front e back na mesma sequência, execute **na raiz do projeto**:

```sh
npm test --prefix server && npm test --prefix client
```

As instruções de verificação completa e de `db:reset` estão no [README da raiz](../readme.md).
