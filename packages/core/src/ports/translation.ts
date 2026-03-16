// SPEC-134 — ITranslationPort interface

/**
 * Translation port contract.
 * Provides entity translation support with locale management.
 */
export interface ITranslationPort {
  /**
   * Apply translations to query results for a given locale.
   * No-op if translation module is disabled.
   * @param results - The entities to translate
   * @param locale - The target locale code
   * @param entityType - The entity type name
   * @returns The translated entities
   */
  applyTranslations<T>(results: T[], locale: string, entityType: string): Promise<T[]>

  /**
   * Create translation records.
   * @param data - Array of translation entries
   * @returns The created translation records
   */
  createTranslations(
    data: Array<{
      reference_id: string
      reference: string
      locale_code: string
      translations: Record<string, string>
    }>
  ): Promise<unknown[]>

  /**
   * Update existing translation records.
   * @param data - Array of translation updates
   * @returns The updated translation records
   */
  updateTranslations(
    data: Array<{
      reference_id: string
      locale_code: string
      translations: Record<string, string>
    }>
  ): Promise<unknown[]>

  /**
   * Delete translation records matching filters.
   * @param filters - Filter by reference_id and/or locale_code
   */
  deleteTranslations(filters: { reference_id?: string[]; locale_code?: string[] }): Promise<void>

  /**
   * Get translation statistics for an entity type.
   * @param input - Entity type and optional locale filter
   * @returns Counts of expected, translated, and missing translations
   */
  getStatistics(input: { entity_type: string; locale_code?: string }): Promise<{
    expected: number
    translated: number
    missing: number
  }>

  /**
   * List all available locales.
   * @returns Array of locale objects with code and name
   */
  listLocales(): Promise<Array<{ code: string; name: string }>>
}
