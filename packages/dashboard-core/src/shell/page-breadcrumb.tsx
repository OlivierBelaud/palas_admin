import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useDashboardContext } from '../context'
import type { BreadcrumbDef } from '../pages/types'

interface PageBreadcrumbProps {
  entity: string
  field: string
  idParam: string
}

export const PageBreadcrumb = ({ entity, field, idParam }: PageBreadcrumbProps) => {
  const params = useParams()
  const id = params[idParam]
  const { dataSource } = useDashboardContext()

  const { data } = useQuery({
    queryKey: ['breadcrumb', entity, id],
    queryFn: async () => {
      const endpoint = dataSource.entityToEndpoint(entity)
      return dataSource.fetch(`${endpoint}/${id}`)
    },
    enabled: !!id,
    staleTime: 60000,
  })

  if (!data) {
    return null
  }

  const record = (data as Record<string, unknown>)[entity] ?? data
  const title = (record as Record<string, unknown>)?.[field]

  if (!title) {
    return null
  }

  return <span>{String(title)}</span>
}

export function buildBreadcrumbHandle(spec: {
  type: 'list' | 'detail'
  query: { entity: string; id?: { $state: string } }
  breadcrumb?: BreadcrumbDef
}) {
  if (!spec.breadcrumb) {
    return undefined
  }

  const { label, field } = spec.breadcrumb

  if (spec.type === 'list' || !field) {
    return {
      breadcrumb: () => label,
    }
  }

  const idParam = spec.query.id?.$state?.split('/').pop() || 'id'

  return {
    breadcrumb: () => <PageBreadcrumb entity={spec.query.entity} field={field} idParam={idParam} />,
  }
}
