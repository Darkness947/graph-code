import { limitsFromConfig } from '../../src/services/ingestion/limits.js';

/** The ingestion limits at their spec 4.1 defaults. */
export const DEFAULT_LIMITS = limitsFromConfig({
  MAX_ZIP_BYTES: 52428800,
  MAX_ZIP_ENTRIES: 20000,
  MAX_FILE_BYTES: 1048576,
  MAX_TOTAL_SOURCE_BYTES: 52428800,
  MAX_COMPRESSION_RATIO: 100,
  MAX_SOURCE_FILES: 1000,
});
