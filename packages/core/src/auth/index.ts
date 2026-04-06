export { AuthModuleService, type AuthModuleServiceDeps } from './auth-module-service'
export { type AuthenticateOptions, extractAuthContext } from './middleware'
export { AuthIdentity, ProviderIdentity } from './models/auth-identity'
export { EmailpassAuthProvider } from './providers/emailpass'
export type {
  AuthenticationInput,
  AuthenticationResponse,
  IAuthIdentityProviderService,
  IAuthProvider,
} from './providers/types'
export type { AuthContext } from './types'
