// Trata erros em execução
// Herda de Error (padrão Node) e adiciona informações do erro
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { field: string; message: string }[]
  ) {
    super(message);
  }
}