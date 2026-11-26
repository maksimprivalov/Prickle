import type { RecordRegistry, SourcedRecord } from './port';

export function createRecordRegistry(): RecordRegistry {
  const byId = new Map<string, SourcedRecord>();
  return {
    add(records) {
      // Record ids are stable, so a second copy of an id is the same record seen again. The
      // first copy wins, so a later tool cannot overwrite a value an agent already cited.
      for (const record of records) {
        if (!byId.has(record.recordId)) byId.set(record.recordId, record);
      }
    },
    get: (recordId) => byId.get(recordId),
    all: () => [...byId.values()],
  };
}
