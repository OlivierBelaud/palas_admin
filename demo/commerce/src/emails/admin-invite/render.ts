import type { RenderedEmail } from '../abandoned-cart/render'

export function renderAdminInviteEmail(acceptUrl: string): RenderedEmail {
  return {
    subject: 'Invitation Palas Admin',
    text: `Tu as ete invite a rejoindre l'admin Palas. Utilise ce lien pour accepter l'invitation : ${acceptUrl}\n\nCe lien expire dans 7 jours.`,
    html: `<p>Tu as ete invite a rejoindre l'admin Palas.</p><p><a href="${acceptUrl}">Accepter l'invitation</a></p><p>Ce lien expire dans 7 jours.</p>`,
  }
}
