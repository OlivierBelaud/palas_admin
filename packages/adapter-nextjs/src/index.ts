// @manta/adapter-nextjs — Mount Manta inside a Next.js App Router project.
//
// Public surface:
//   import { withManta } from '@manta/adapter-nextjs'             // next.config wrapper
//   import { GET, POST, ... } from '@manta/adapter-nextjs/handler' // catch-all route handler
//
// The admin dashboard mount is NOT exposed as a package export — instead, `manta init --preset next`
// scaffolds `app/admin/[[...slug]]/page.tsx` with an inline `dynamic(() => import('@manta/dashboard'))`
// so webpack resolves @manta/dashboard from the consumer project's node_modules. Pushing the import
// through a subpath of this package breaks pnpm workspace resolution in Next 15.

export { getMantaAdapter, getMantaApp } from './bootstrap'
export { withManta } from './with-manta'
