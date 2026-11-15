/**
 * @typedef {object} IngestionLimits
 * @property {number} maxZipBytes largest archive downloaded
 * @property {number} maxZipEntries most entries an archive may list
 * @property {number} maxFileBytes largest source file kept; larger ones are skipped (`too_large`)
 * @property {number} maxTotalSourceBytes most source inflated in total
 * @property {number} maxCompressionRatio highest uncompressed/compressed ratio of any entry
 * @property {number} maxSourceFiles most source files in one repository
 */

/**
 * The ingestion limits (spec 4.1, 7.5 step 2) from a loaded config.
 * @param {Readonly<Record<string, any>>} config from `loadConfig`
 * @returns {Readonly<IngestionLimits>}
 */
export function limitsFromConfig(config) {
  return Object.freeze({
    maxZipBytes: config.MAX_ZIP_BYTES,
    maxZipEntries: config.MAX_ZIP_ENTRIES,
    maxFileBytes: config.MAX_FILE_BYTES,
    maxTotalSourceBytes: config.MAX_TOTAL_SOURCE_BYTES,
    maxCompressionRatio: config.MAX_COMPRESSION_RATIO,
    maxSourceFiles: config.MAX_SOURCE_FILES,
  });
}
