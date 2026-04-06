// UserModuleService — manages User and Invite entities.
// ISO Medusa V2's UserModuleService interface.

import type { AuthModuleService } from '../auth/auth-module-service'
import { MantaError } from '../errors/manta-error'
import type { IRepository } from '../ports/repository'

export interface UserModuleServiceDeps {
  baseRepository: IRepository
  userRepository: IRepository
  inviteRepository: IRepository
  authModuleService?: AuthModuleService
  jwtSecret?: string
}

interface UserDTO {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  avatar_url: string | null
  metadata: Record<string, unknown> | null
}

interface InviteDTO {
  id: string
  email: string
  accepted: boolean
  token: string
  expires_at: Date
  metadata: Record<string, unknown> | null
}

export class UserModuleService {
  private userRepo: IRepository
  private inviteRepo: IRepository
  private authModuleService?: AuthModuleService
  private jwtSecret: string

  constructor(deps: UserModuleServiceDeps) {
    this.userRepo = deps.userRepository
    this.inviteRepo = deps.inviteRepository
    this.authModuleService = deps.authModuleService
    this.jwtSecret = deps.jwtSecret ?? process.env.JWT_SECRET ?? 'manta-dev-secret'
  }

  // --- User CRUD ---

  async createUsers(
    data: Array<{ email: string; first_name?: string; last_name?: string; metadata?: Record<string, unknown> }>,
  ): Promise<UserDTO[]> {
    return (await this.userRepo.create(data)) as UserDTO[]
  }

  async retrieveUser(id: string): Promise<UserDTO> {
    const results = (await this.userRepo.find({ where: { id } })) as UserDTO[]
    if (results.length === 0) throw new MantaError('NOT_FOUND', `User "${id}" not found`)
    return results[0]
  }

  async listUsers(filters?: Record<string, unknown>): Promise<UserDTO[]> {
    return (await this.userRepo.find({ where: filters })) as UserDTO[]
  }

  async updateUsers(data: Array<{ id: string } & Partial<UserDTO>>): Promise<UserDTO[]> {
    const results: UserDTO[] = []
    for (const item of data) {
      const updated = (await this.userRepo.update(item)) as UserDTO
      results.push(updated)
    }
    return results
  }

  async deleteUsers(ids: string[]): Promise<void> {
    await this.userRepo.delete(ids)
  }

  // --- Invite management ---

  async createInvites(data: Array<{ email: string; metadata?: Record<string, unknown> }>): Promise<InviteDTO[]> {
    const invites: Record<string, unknown>[] = []
    for (const item of data) {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      const token = this.authModuleService
        ? await this.authModuleService.generateToken(
            { id: item.email, type: 'invite', auth_identity_id: '' },
            this.jwtSecret,
            '7d',
          )
        : `invite_${crypto.randomUUID()}`

      invites.push({
        email: item.email,
        accepted: false,
        token,
        expires_at: expiresAt,
        metadata: item.metadata ?? {},
      })
    }
    return (await this.inviteRepo.create(invites)) as InviteDTO[]
  }

  async validateInviteToken(token: string): Promise<InviteDTO> {
    const results = (await this.inviteRepo.find({ where: { token } })) as InviteDTO[]
    if (results.length === 0) throw new MantaError('NOT_FOUND', 'Invalid invite token')
    const invite = results[0]

    if (invite.accepted) throw new MantaError('INVALID_DATA', 'Invite already accepted')
    if (new Date(invite.expires_at) < new Date()) throw new MantaError('UNAUTHORIZED', 'Invite token expired')

    return invite
  }

  async acceptInvite(inviteId: string): Promise<InviteDTO> {
    const [updated] = (await this.inviteRepo.update([{ id: inviteId, accepted: true }])) as InviteDTO[]
    return updated
  }

  async listInvites(filters?: Record<string, unknown>): Promise<InviteDTO[]> {
    return (await this.inviteRepo.find({ where: filters })) as InviteDTO[]
  }

  async deleteInvites(ids: string[]): Promise<void> {
    await this.inviteRepo.delete(ids)
  }

  async refreshInviteTokens(inviteIds: string[]): Promise<InviteDTO[]> {
    const results: InviteDTO[] = []
    for (const id of inviteIds) {
      const invite = (await this.inviteRepo.find({ where: { id } })) as InviteDTO[]
      if (invite.length === 0) continue

      const nonce = crypto.randomUUID()
      const newToken = this.authModuleService
        ? await this.authModuleService.generateToken(
            { id: invite[0].email, type: 'invite', auth_identity_id: nonce },
            this.jwtSecret,
            '7d',
          )
        : `invite_${nonce}`

      const [updated] = (await this.inviteRepo.update([
        {
          id,
          token: newToken,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      ])) as InviteDTO[]
      results.push(updated)
    }
    return results
  }
}
