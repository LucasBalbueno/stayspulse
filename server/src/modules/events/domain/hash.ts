import { createHash } from 'node:crypto';

// Organizar os dados de forma canônica para gerar um hash consistente
// Depois o hash é usado em comparações
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

// Exporta a função de criar Hash de forma organizada
export const hash = (value: unknown) =>
    createHash('sha256').update(canonical(value)).digest('hex');
