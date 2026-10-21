import type { AlertRepository } from './alert-repository.js';

// Implementa o caso de uso para consultar alertas
export class ListAlerts {
    constructor(private readonly alerts: AlertRepository) { }

    // Encaminha a solicitação para o repositório de alertas
    execute(propertyId?: string) { return this.alerts.list(propertyId); }
}
