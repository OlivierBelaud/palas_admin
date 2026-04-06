// Auth provider interface — ISO Medusa V2's AbstractAuthModuleProvider

export interface AuthenticationInput {
  url: string
  headers: Record<string, string>
  query: Record<string, string>
  body: Record<string, unknown>
  protocol: string
}

export interface AuthenticationResponse {
  success: boolean
  authIdentity?: { id: string; app_metadata?: Record<string, unknown> }
  error?: string
  /** Redirect URL for OAuth flows */
  location?: string
}

/**
 * Auth provider contract — same as Medusa's AbstractAuthModuleProvider.
 * Each provider (emailpass, google, github) implements this.
 */
export interface IAuthProvider {
  /** Authenticate an existing identity */
  authenticate(
    data: AuthenticationInput,
    authIdentityService: IAuthIdentityProviderService,
  ): Promise<AuthenticationResponse>

  /** Register a new identity */
  register(
    data: AuthenticationInput,
    authIdentityService: IAuthIdentityProviderService,
  ): Promise<AuthenticationResponse>

  /** Handle OAuth callback */
  validateCallback?(
    data: AuthenticationInput,
    authIdentityService: IAuthIdentityProviderService,
  ): Promise<AuthenticationResponse>

  /** Update provider data (e.g., new OAuth token) */
  update?(
    data: Record<string, unknown>,
    authIdentityService: IAuthIdentityProviderService,
  ): Promise<AuthenticationResponse>
}

/**
 * Service interface passed to auth providers for identity management.
 * Allows providers to create/update auth identities without knowing the storage layer.
 */
export interface IAuthIdentityProviderService {
  create(data: {
    entity_id: string
    provider: string
    user_metadata?: Record<string, unknown>
    provider_metadata?: Record<string, unknown>
  }): Promise<{ id: string; app_metadata?: Record<string, unknown> }>

  update(
    entity_id: string,
    provider: string,
    data: {
      user_metadata?: Record<string, unknown>
      provider_metadata?: Record<string, unknown>
    },
  ): Promise<{ id: string; app_metadata?: Record<string, unknown> }>

  retrieve(
    entity_id: string,
    provider: string,
  ): Promise<{
    id: string
    provider_metadata?: Record<string, unknown>
    auth_identity: { id: string; app_metadata?: Record<string, unknown> }
  } | null>

  /** Store temporary state (OAuth state param, PKCE verifier) */
  setState(key: string, value: Record<string, unknown>): Promise<void>
  /** Retrieve and delete state (one-time use) */
  getState(key: string): Promise<Record<string, unknown> | null>
}
