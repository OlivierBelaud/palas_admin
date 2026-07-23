import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs"
import { relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024
const SENSITIVE_ASSIGNMENT =
  /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*(?:["'])?([^\s"'`]+)/g

const SAFE_VALUE_MARKERS = [
  "change-me",
  "dummy",
  "example",
  "generate",
  "placeholder",
  "redacted",
  "replace",
  "test-",
]

function isSafeValue(value) {
  const normalized = value.toLowerCase()

  return (
    value.startsWith("<") ||
    value.startsWith("${") ||
    value.startsWith("$(") ||
    (normalized.includes("runtime") && normalized.includes("smoke")) ||
    SAFE_VALUE_MARKERS.some((marker) => normalized.includes(marker))
  )
}

function resemblesSecret(value) {
  if (isSafeValue(value)) {
    return false
  }

  return (
    /^[a-f0-9]{32,}$/i.test(value) ||
    /^(?:github_pat_|gh[oprsu]_|sk_live_|rk_live_|shpat_|xox[baprs]-|re_)[a-z0-9_/-]{16,}$/i.test(
      value,
    ) ||
    (value.length >= 40 && /[a-z]/i.test(value) && /\d/.test(value))
  )
}

export function findPotentialSecrets(contents) {
  const findings = []

  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    SENSITIVE_ASSIGNMENT.lastIndex = 0

    for (const match of line.matchAll(SENSITIVE_ASSIGNMENT)) {
      if (resemblesSecret(match[1])) {
        findings.push({ line: index + 1, rule: "sensitive-literal-assignment" })
      }
    }
  }

  return findings
}

function repositoryRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim()
}

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
}

function scanRepository() {
  const root = repositoryRoot()
  const findings = []

  for (const trackedPath of trackedFiles(root)) {
    const absolutePath = resolve(root, trackedPath)
    if (!existsSync(absolutePath)) {
      continue
    }
    const fileStat = lstatSync(absolutePath)

    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      continue
    }

    const buffer = fileStat.isSymbolicLink()
      ? Buffer.from(readlinkSync(absolutePath))
      : readFileSync(absolutePath)
    if (buffer.includes(0)) {
      continue
    }

    for (const finding of findPotentialSecrets(buffer.toString("utf8"))) {
      findings.push({ path: relative(root, absolutePath), ...finding })
    }
  }

  if (findings.length === 0) {
    console.log("Secret scan passed: no committed sensitive literals detected.")
    return
  }

  console.error(`Secret scan failed: ${findings.length} potential secret(s) detected.`)
  for (const finding of findings) {
    console.error(`${finding.path}:${finding.line} [${finding.rule}]`)
  }
  process.exitCode = 1
}

function selfTest() {
  const syntheticSecret = "a".repeat(64)
  const findings = findPotentialSecrets(`UNSUBSCRIBE_SECRET=${syntheticSecret}`)

  assert.deepEqual(findings, [
    { line: 1, rule: "sensitive-literal-assignment" },
  ])
  assert.deepEqual(
    findPotentialSecrets(
      "UNSUBSCRIBE_SECRET=<generate-and-store-in-secret-manager>",
    ),
    [],
  )
  assert.deepEqual(findPotentialSecrets("JWT_SECRET=test-secret-for-runtime"), [])
  assert.deepEqual(
    findPotentialSecrets("RESEND_API_KEY=re_runtime_smoke_placeholder"),
    [],
  )
  console.log("Secret scanner self-test passed.")
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isEntrypoint) {
  if (process.argv.includes("--self-test")) {
    selfTest()
  } else {
    scanRepository()
  }
}
