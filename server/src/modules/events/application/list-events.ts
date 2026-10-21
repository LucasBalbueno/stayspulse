import type { EventReader, EventQuery } from './event-repository.js';

// Ler/listar eventos
export class ListEvents {
  constructor(private readonly reader: EventReader) { }

  execute(query: EventQuery) { return this.reader.list(query); }
}
