// Contrato de alerta de conflito de reservas
export interface ConflictAlert {
    id: string;
    reservationA: string;
    reservationB: string;
    propertyId: string;
    status: string;
    history: unknown;
    updatedAt: Date;
}

// Contrato de persistência de alertas
export interface AlertRepository {
    // Compara os alertas existentes com as reservas fornecidas
    reconcile(
        id: string,
        propertyId: string,
        overlappingIds: string[],
        now: Date,
    ): Promise<void>;
    // Lista os alertas existentes para uma propriedade específica
    list(propertyId?: string): Promise<ConflictAlert[]>;
}
