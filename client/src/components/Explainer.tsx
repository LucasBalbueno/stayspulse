const items = [
  [
    "01",
    "SNAPSHOTS",
    "Criações e atualizações enviam o estado completo da reserva: propriedade, datas e status. Assim, uma versão mais recente pode ser aplicada sem depender de cada atualização anterior."
  ],
  [
    "02",
    "CONTROLE DE VERSÕES",
    "sourceVersion define a ordem das alterações. Versões antigas são ignoradas; uma versão igual só é aceita como equivalente se representar o mesmo estado. Conteúdo incompatível é rejeitado."
  ],
  [
    "03",
    "AUTENTICAÇÃO COM X-API-KEY",
    "A API valida a chave enviada no cabeçalho X-API-Key. O proxy adiciona essa credencial no servidor, sem expor a chave ao navegador."
  ],
  [
    "04",
    "IDEMPOTÊNCIA",
    "source + eventId identifica um evento. Reenviar o mesmo conteúdo registra outra entrega sem aplicar a alteração novamente. Reutilizar essa identidade com conteúdo diferente retorna HTTP 409."
  ],
  [
    "05",
    "USO DE INDEX NO DB",
    "Índices ajudam o banco a localizar eventos, reservas e conflitos pelos filtros usados nas consultas. Índices únicos também impedem identidades duplicadas de eventos, reservas e pares de conflito."
  ],
  [
    "06",
    "HASH CANÔNICO",
    "As chaves dos objetos são ordenadas antes de gerar um hash SHA-256. Isso permite comparar conteúdos e estados sem tratar uma mudança na ordem dos campos JSON como uma alteração de dados."
  ],
  [
    "07",
    "CONTROLE DE CICLO DE VIDA",
    "O evento registra os estados do recebimento ao resultado do processamento. Na reserva, o cancelamento é terminal: o histórico permanece disponível, mas a reserva não pode ser reativada."
  ],
  [
    "08",
    "REFERÊNCIA PENDENTE",
    "Uma atualização ou um cancelamento que chega antes da criação fica em pending_reference. Após a criação, o worker pode reavaliar o evento e aplicar a alteração."
  ],
  [
    "09",
    "LEASE E TOKEN",
    "O worker recebe uma autorização temporária (lease) e um token ao assumir um evento. Apenas o token vigente pode concluir o processamento; se o prazo expirar, outro worker pode recuperar o trabalho."
  ],
  [
    "10",
    "PROPERTYGUARD",
    "Coordena transações que alteram reservas da mesma propriedade para evitar decisões simultâneas inconsistentes sobre disponibilidade. Reserva, alertas e conclusão do evento são gravados juntos."
  ],
  [
    "11",
    "RETRY (com Jitter)",
    "Conflitos de transação elegíveis são tentados novamente, com limite de tentativas e espera crescente. O jitter acrescenta um atraso aleatório para reduzir novas colisões entre operações concorrentes."
  ],
  [
    "12",
    "PAGINAÇÃO",
    "Eventos e reservas são consultados em páginas por cursor. “Carregar mais 20” busca a próxima página mantendo os filtros. Alertas têm uma consulta separada, limitada aos 100 mais recentes."
  ]
];
export function Explainer() {
  return (
    <section className="explainer" aria-labelledby="explainer-title">
      <span className="eyebrow">POR DENTRO DO STAYPULSE</span>
      <h2 id="explainer-title">Cada evento tem uma explicação.</h2>
      <div className="explain-grid">
        {items.map(([number, title, body]) => (
          <article key={number}>
            <span className="step-number">{number}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
