import { createHash } from 'node:crypto';

function canonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';

    if (value !== null && typeof value === 'object') {
        return (
            '{' +
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => JSON.stringify(key) + ':' + canonical(entry))
                .join(',') +
            '}'
        );
    }

    return JSON.stringify(value);
}

export const hash = (value: unknown) =>
    createHash('sha256').update(canonical(value)).digest('hex');
