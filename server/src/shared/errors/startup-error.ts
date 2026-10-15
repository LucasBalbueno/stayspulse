export type StartupStage =
  | 'client'
  | 'connect'
  | 'ping'
  | 'indexes'
  | 'listen';

// Trata erros de inicialização (Evita vazar informações sensíveis do banco de dados e do sistema)
export function startupErrorMessage(error: unknown, stage: StartupStage): string {
  const value = error && typeof error === 'object' ? error as {
    code?: unknown;
    errorCode?: unknown;
    cause?: unknown
  } : {};

  const cause = value.cause && typeof value.cause === 'object' ? value.cause as {
    code?: unknown
  } : {};

  const codes = [
    value.code,
    value.errorCode,
    cause.code
  ];

  if (codes.includes('EREFUSED'))
    return 'Falha de DNS (EREFUSED): o resolvedor da rede recusou a consulta ao MongoDB. Verifique o DNS da conexão; a autenticação ainda não foi iniciada.';

  if (codes.includes('ENOTFOUND') || codes.includes('ENODATA'))
    return 'Endereço do MongoDB não encontrado no DNS. Verifique o endereço do cluster e se ele está ativo.';

  if (codes.includes(18) || codes.includes('P1000'))
    return 'Autenticação MongoDB recusada. Confira o usuário de banco, a senha e a codificação das credenciais na MONGODB_URI.';

  if (codes.includes(13) || codes.includes('P1010'))
    return 'MongoDB recusou a operação por falta de permissão. Confira o acesso do usuário ao banco e à criação de índices.';

  if (stage === 'listen' && codes.includes('EADDRINUSE'))
    return 'Porta HTTP já está em uso. Encerre a outra instância ou altere PORT no .env.';

  const stages: Record<StartupStage, string> = {
    client: 'Falha ao configurar o cliente MongoDB. Verifique o formato e as opções da MONGODB_URI.',
    connect: 'Falha ao conectar ao MongoDB. Verifique DNS, rede, acesso de IP no Atlas e credenciais.',
    ping: 'MongoDB conectado, mas a verificação do banco falhou. Verifique permissões e disponibilidade.',
    indexes: 'Falha ao preparar índices do MongoDB. Verifique permissões e índices existentes no banco.',
    listen: 'Falha ao abrir o servidor HTTP. Verifique HOST, PORT e permissões da rede local.',
  };

  return stages[stage];
}
