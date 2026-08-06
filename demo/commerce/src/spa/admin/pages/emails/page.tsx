import { EmailSectionNav } from '../../components/email-section-nav'
import { AbandonedCartCampaignView } from '../paniers-abandonnes/abandoned-cart-campaign-view'

export default function EmailsPage() {
  return (
    <div className="flex flex-col gap-4">
      <EmailSectionNav />
      <AbandonedCartCampaignView mode="emails" />
    </div>
  )
}
