export interface Cursor {
    date: string;
    id: string
}

export interface PageQuery {
    limit: number;
    cursor?: Cursor
}

export interface Page<T> {
    data: T[];
    pagination: {
        nextCursor: string | null;
        hasMore: boolean
    }
}
