import type { AlertRepository } from './alert-repository.js';
export class ListAlerts {
    constructor(private readonly alerts: AlertRepository) { }

    execute(propertyId?: string) { return this.alerts.list(propertyId); }
}
