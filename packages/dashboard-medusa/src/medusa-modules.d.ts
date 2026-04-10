// Ambient declarations for Medusa upstream modules.
// These are resolved at build time by vite-plugin-override in demo/medusa, pointing to
// @medusajs/dashboard internals. TypeScript has no way to resolve them here (they are
// runtime-only aliases), so we declare them as `any` to satisfy the compiler.
//
// This is a deliberate escape hatch — the real types live in the Medusa upstream package
// which is too large to typecheck in our pipeline. Runtime validation happens at build.

declare module '@medusa-routes/*' {
  const anyModule: any
  export default anyModule
  export = anyModule
}

declare module '@medusa-i18n/*' {
  const anyJson: any
  export default anyJson
  export = anyJson
}
