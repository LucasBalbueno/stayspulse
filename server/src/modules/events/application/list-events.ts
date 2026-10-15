import type { EventReader, EventQuery } from './event-repository.js';

export class ListEvents {
  constructor(private readonly reader: EventReader) { }

  execute(query: EventQuery) { return this.reader.list(query); }
}
