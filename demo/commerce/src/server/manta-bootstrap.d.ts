// Manta generates this module during build. Keep clean-checkout typechecking
// independent of generated files; the CRM route only needs the event emitter.
declare module '*manta-bootstrap.js' {
  export function getMantaApp(): Promise<{
    emit: (name: string, data: unknown) => Promise<unknown>
  }>
}
