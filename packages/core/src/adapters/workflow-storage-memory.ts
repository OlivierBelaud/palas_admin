// SPEC-020 — InMemoryWorkflowStorage implements IWorkflowStoragePort

import type { IWorkflowStoragePort } from '../ports'
import { MantaError } from '../errors/manta-error'

export class InMemoryWorkflowStorage implements IWorkflowStoragePort {
  private _store = new Map<string, Record<string, unknown>>()

  async save(transactionId: string, stepId: string, data: Record<string, unknown>): Promise<void> {
    // Validate serialisability (WS-09)
    this._validateSerializability(data, '')
    const key = `${transactionId}:${stepId}`
    // BigInt handling
    const serialized = JSON.stringify(data, this._replacer)
    this._store.set(key, JSON.parse(serialized, this._reviver))
  }

  async load(transactionId: string, stepId?: string): Promise<Record<string, unknown> | null> {
    if (stepId) {
      return this._store.get(`${transactionId}:${stepId}`) ?? null
    }

    // Merge all steps for this transaction
    const merged: Record<string, unknown> = {}
    for (const [key, value] of this._store) {
      if (key.startsWith(`${transactionId}:`)) {
        Object.assign(merged, value)
      }
    }
    return Object.keys(merged).length > 0 ? merged : null
  }

  async list(transactionId: string): Promise<Array<{ stepId: string; data: Record<string, unknown> }>> {
    const results: Array<{ stepId: string; data: Record<string, unknown> }> = []
    for (const [key, value] of this._store) {
      if (key.startsWith(`${transactionId}:`)) {
        const stepId = key.slice(transactionId.length + 1)
        results.push({ stepId, data: value })
      }
    }
    return results
  }

  async delete(transactionId: string): Promise<void> {
    for (const key of this._store.keys()) {
      if (key.startsWith(`${transactionId}:`)) {
        this._store.delete(key)
      }
    }
  }

  private _validateSerializability(obj: unknown, path: string): void {
    if (obj instanceof Map) throw new MantaError('INVALID_DATA', `Step result contains non-serializable type: Map at ${path || 'root'}`)
    if (obj instanceof Set) throw new MantaError('INVALID_DATA', `Step result contains non-serializable type: Set at ${path || 'root'}`)
    if (obj instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj))) {
      throw new MantaError('INVALID_DATA', `Step result contains non-serializable type: Buffer at ${path || 'root'}`)
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        this._validateSerializability(value, path ? `${path}.${key}` : key)
      }
    }
  }

  private _replacer(_key: string, value: unknown): unknown {
    if (typeof value === 'bigint') return { __type: 'BigInt', value: value.toString() }
    return value
  }

  private _reviver(_key: string, value: unknown): unknown {
    if (typeof value === 'object' && value !== null && (value as Record<string, unknown>).__type === 'BigInt') {
      return BigInt((value as Record<string, unknown>).value as string)
    }
    return value
  }

  _reset() { this._store.clear() }
}
