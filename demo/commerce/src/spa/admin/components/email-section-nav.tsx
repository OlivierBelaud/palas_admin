import { History, PanelsTopLeft } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

const links = [
  { to: '/emails', label: 'Emails envoyés', icon: History, exact: true },
  { to: '/emails/templates', label: 'Templates & scénarios', icon: PanelsTopLeft, exact: false },
]

export function EmailSectionNav() {
  const location = useLocation()
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/25 p-1.5">
      {links.map((link) => {
        const active = link.exact ? location.pathname === link.to : location.pathname.startsWith(link.to)
        const Icon = link.icon
        return (
          <Link
            key={link.to}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            to={link.to}
          >
            <Icon className="size-4" />
            {link.label}
          </Link>
        )
      })}
    </div>
  )
}
