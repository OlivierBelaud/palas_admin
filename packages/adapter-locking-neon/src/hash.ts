// FNV-1a 64-bit hash — converts string key to bigint for pg_advisory_lock()
// PG advisory locks require a bigint key. We hash the string key to a signed 64-bit integer.

const FNV_OFFSET_BASIS = 14695981039346656037n
const FNV_PRIME = 1099511628211n
const MAX_SIGNED_64 = (1n << 63n) - 1n
const MOD = 1n << 64n

export function stringToAdvisoryLockKey(key: string): bigint {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < key.length; i++) {
    hash ^= BigInt(key.charCodeAt(i))
    hash = (hash * FNV_PRIME) % MOD
  }
  // Convert to signed 64-bit range for PG
  if (hash > MAX_SIGNED_64) {
    hash = hash - MOD
  }
  return hash
}
