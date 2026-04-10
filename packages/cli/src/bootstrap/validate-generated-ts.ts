// SPEC TS-04 — Validate generated TypeScript output before writing to disk.
// Belt-and-suspenders: input sanitization in generate-types.ts catches known
// failure modes; this validator catches the rest.

import { MantaError } from '@manta/core'
import ts from 'typescript'

/**
 * Parse the generated TypeScript source and throw if there are any syntax errors.
 * Uses TypeScript's own parser — the only reliable way to validate generated code.
 */
export function validateGeneratedTypeScript(source: string, filename: string): void {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)

  // parseDiagnostics is an internal-ish field but stable in practice
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []

  if (diagnostics.length === 0) return

  // Format the first diagnostic for the error
  const d = diagnostics[0]
  const pos = d.start ?? 0
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, pos)
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n')
  const snippet = source.slice(Math.max(0, pos - 20), Math.min(source.length, pos + 20)).replace(/\n/g, '\\n')

  throw new MantaError(
    'INVALID_DATA',
    `Generated ${filename} has syntax errors at line ${line + 1}:${character + 1}: ${msg}\n` +
      `  Near: "${snippet}"\n` +
      `  This is a codegen bug. Check your defineModel/defineContext/defineSubscriber names for invalid characters.`,
  )
}
