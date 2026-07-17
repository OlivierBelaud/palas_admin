import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx']

async function exists(url) {
  try {
    await access(fileURLToPath(url))
    return true
  } catch {
    return false
  }
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.tsx')) {
    return nextLoad(url, context)
  }

  const source = await readFile(fileURLToPath(url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: fileURLToPath(url),
  })

  return {
    format: 'module',
    shortCircuit: true,
    source: output.outputText,
  }
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (
      error?.code !== 'ERR_MODULE_NOT_FOUND' ||
      !context.parentURL?.startsWith('file:') ||
      !(specifier.startsWith('./') || specifier.startsWith('../'))
    ) {
      throw error
    }

    for (const extension of extensions) {
      const candidate = new URL(`${specifier}${extension}`, context.parentURL)
      if (await exists(candidate)) {
        return nextResolve(candidate.href, context)
      }
    }

    throw error
  }
}
