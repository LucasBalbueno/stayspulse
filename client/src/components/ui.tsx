import type { ReactNode } from "react";
const labels: Record<string, string> = {
  received: "Recebido",
  processing: "Processando",
  pending_reference: "Referência pendente",
  completed: "Processado",
  ignored: "Ignorado",
  rejected: "Rejeitado",
  failed: "Falhou",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  open: "Aberto",
  resolved: "Resolvido",
  accepted: "Aceita",
  inconsistent: "Inconsistente",
};
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span aria-hidden="true">●</span> {labels[status] ?? status}
    </span>
  );
}
export const time = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
export const day = (value: string) => value.split("-").reverse().join("/");
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <span aria-hidden="true">◎</span>
      <p>{children}</p>
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export const reasons: Record<string, string> = {
  processing_error:
    "O worker encontrou uma falha. Ele repete o processamento com espera crescente; failed exige diagnóstico e reagendamento operacional.",
  missing_creation:
    "A criação ainda não chegou. O worker reavalia esta referência periodicamente.",
  older_version: "Versão anterior à atual. A reserva não foi alterada.",
  equivalent_version:
    "Esta versão já representa o mesmo estado. Nenhuma alteração aplicada.",
  incompatible_version:
    "A mesma versão contém um estado diferente. Revise a origem do evento.",
  immutable_property: "A propriedade de uma reserva existente não pode mudar.",
  terminal_cancellation: "Uma reserva cancelada não pode ser reativada no MVP.",
  already_created: "A reserva já foi criada. Use um evento de atualização.",
  applied: "Evento aplicado à projeção da reserva.",
};
