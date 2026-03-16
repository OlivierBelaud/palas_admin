// SPEC-134 — NoOpTranslationAdapter implements ITranslationPort

import type { ITranslationPort } from '../ports'

export class NoOpTranslationAdapter implements ITranslationPort {
  async applyTranslations<T>(results: T[], _locale: string, _entityType: string): Promise<T[]> {
    return results // No-op per SPEC-105-T8
  }

  async createTranslations(data: Array<{
    reference_id: string
    reference: string
    locale_code: string
    translations: Record<string, string>
  }>): Promise<unknown[]> { return data }

  async updateTranslations(data: Array<{
    reference_id: string
    locale_code: string
    translations: Record<string, string>
  }>): Promise<unknown[]> { return data }

  async deleteTranslations(_filters: { reference_id?: string[]; locale_code?: string[] }): Promise<void> {}

  async getStatistics(_input: { entity_type: string; locale_code?: string }): Promise<{ expected: number; translated: number; missing: number }> {
    return { expected: 0, translated: 0, missing: 0 }
  }

  async listLocales(): Promise<Array<{ code: string; name: string }>> { return [] }
}
