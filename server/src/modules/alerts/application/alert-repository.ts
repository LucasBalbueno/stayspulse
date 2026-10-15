export interface ConflictAlert {
    id: string;
    reservationA: string;
    reservationB: string;
    propertyId: string;
    status: string;
    history: unknown;
    updatedAt: Date;
}
export interface AlertRepository {
    reconcile(
        id: string,
        propertyId: string,
        overlappingIds: string[],
        now: Date,
    ): Promise<void>;
    list(propertyId?: string): Promise<ConflictAlert[]>;
}
