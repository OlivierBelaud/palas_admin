import { copyFileSync, existsSync, mkdirSync } from 'node:fs'

const source = 'src/spa/admin/public/favicon.webp'
const targetDirectory = '.manta/spa/admin/public'

if (existsSync(source)) {
  mkdirSync(targetDirectory, { recursive: true })
  copyFileSync(source, `${targetDirectory}/favicon.webp`)
}
