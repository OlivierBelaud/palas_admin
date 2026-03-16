import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  StatusBadge,
  Table,
  Text,
  Tooltip,
  clx,
  DropdownMenu,
  toast,
  usePrompt,
} from "@medusajs/ui"
import {
  Adjustments,
  EllipsisHorizontal,
  PencilSquare,
  Trash,
  Plus,
  Photo,
  DescendingSorting,
  XMarkMini,
} from "@medusajs/icons"
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
} from "@tanstack/react-table"
import type {
  ColumnDef,
  PaginationState,
  Row,
  VisibilityState,
} from "@tanstack/react-table"
import type { DataComponent } from "../pages/types"
import { useQueryClient } from "@tanstack/react-query"
import { resolveDataPath } from "../data/index"

// ──────────────────────────────────────────────
// Renderer registry
// ──────────────────────────────────────────────

export type BlockRendererProps = {
  component: DataComponent
  data: Record<string, unknown>
}

type BlockRenderer = React.ComponentType<BlockRendererProps>

const rendererRegistry: Record<string, BlockRenderer> = {}

export function registerRenderer(type: string, renderer: BlockRenderer) {
  rendererRegistry[type] = renderer
}

export function getRenderer(type: string): BlockRenderer | undefined {
  return rendererRegistry[type]
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const statusColors: Record<string, "green" | "orange" | "red" | "blue" | "grey"> = {
  active: "green",
  published: "green",
  completed: "green",
  captured: "green",
  draft: "grey",
  pending: "orange",
  requires_action: "orange",
  not_fulfilled: "orange",
  archived: "grey",
  disabled: "grey",
  failed: "red",
  canceled: "red",
  refunded: "blue",
}

function getStatusColor(value: string): "green" | "orange" | "red" | "blue" | "grey" {
  const lower = String(value).toLowerCase().replace(/ /g, "_")
  return statusColors[lower] || "grey"
}

function formatValue(value: unknown, format?: string): string {
  if (value === null || value === undefined) return "-"
  if (Array.isArray(value)) return `${value.length} items`

  switch (format) {
    case "badge":
      return String(value)
    case "date":
      try { return new Date(value as string).toLocaleDateString() } catch { return String(value) }
    case "currency":
      return typeof value === "number"
        ? (value / 100).toLocaleString(undefined, { style: "currency", currency: "EUR" })
        : String(value)
    case "boolean":
      return value ? "True" : "False"
    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value)
    case "count":
      if (Array.isArray(value)) return String(value.length)
      return typeof value === "number" ? String(value) : "-"
    case "percentage":
      return typeof value === "number" ? `${value}%` : String(value)
    default:
      return String(value)
  }
}

function renderCellValue(value: unknown, format?: string): React.ReactNode {
  if (value === null || value === undefined) {
    return React.createElement(Text, {
      size: "small",
      className: "text-ui-fg-muted",
    }, "-")
  }

  if (format === "badge") {
    const strVal = String(value)
    return React.createElement(StatusBadge, {
      color: getStatusColor(strVal),
    }, strVal.replace(/_/g, " "))
  }

  if (format === "count") {
    const count = Array.isArray(value) ? value.length : value
    return React.createElement(Text, { size: "small" }, String(count))
  }

  return React.createElement(Text, { size: "small" }, formatValue(value, format))
}

// ──────────────────────────────────────────────
// Action button helpers — shared by all card renderers
// ──────────────────────────────────────────────

type ActionDef = { label: string; icon?: string; to?: string; action?: string; destructive?: boolean; entity?: string }

/** Resolve :param placeholders in an action path using entity data */
function resolveActionTo(to: string, data: Record<string, unknown>): string {
  return to.replace(/:(\w+)/g, (_, key) => {
    const val = data[key] ?? data["id"]
    return val != null ? String(val) : key
  })
}

/** Map icon name to @medusajs/icons component */
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  PencilSquare,
  Trash,
  Plus,
  EllipsisHorizontal,
}

function getIcon(name?: string): React.ComponentType<{ className?: string }> | null {
  if (!name) return null
  return iconMap[name] || null
}

/** Render action buttons for a card header. Uses Link for actions with `to`, plain Button otherwise. */
function renderActionButtons(actions: ActionDef[], data: Record<string, unknown>) {
  return actions.map((action, i) =>
    action.to
      ? React.createElement(Link, {
          key: i,
          to: resolveActionTo(action.to, data),
        },
          React.createElement(Button, {
            variant: "secondary",
            size: "small",
            type: "button",
          }, action.label)
        )
      : React.createElement(Button, {
          key: i,
          variant: "secondary",
          size: "small",
        }, action.label)
  )
}

type ActionGroupDef = { actions: ActionDef[] }

/** Render a three-dots action menu dropdown — matches Medusa's ActionMenu exactly.
 *  Groups are separated by DropdownMenu.Separator.
 *  action: "delete" + entity: "products" triggers usePrompt() + DELETE /admin/products/:id + cache invalidation. */
function ActionMenu({ groups, data }: { groups: ActionGroupDef[]; data: Record<string, unknown> }) {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const queryClient = useQueryClient()

  const handleDelete = useCallback(async (entity: string) => {
    const id = data.id as string
    if (!entity || !id) return

    const title = data.title as string | undefined
    const res = await prompt({
      title: "Are you sure?",
      description: `You are about to delete${title ? ` "${title}"` : " this record"}. This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })

    if (!res) return

    try {
      const endpoint = `/admin/${entity}/${id}`
      const response = await fetch(endpoint, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      // Fire-and-forget: invalidate cache, navigate immediately.
      // The listing will refetch in the background when it mounts.
      queryClient.invalidateQueries({ queryKey: [entity] })
      toast.success("Deleted successfully")
      navigate("..")
    } catch (e) {
      toast.error("Failed to delete", {
        description: (e as Error).message,
      })
    }
  }, [data, prompt, navigate, queryClient])

  function getActionHandler(action: ActionDef): (() => void) | undefined {
    if (action.to) return () => navigate(resolveActionTo(action.to!, data))
    if (action.action === "delete" && action.entity) return () => handleDelete(action.entity!)
    return undefined
  }

  function renderItem(action: ActionDef, i: number) {
    const IconComp = getIcon(action.icon)
    const content = React.createElement("span", {
      className: "[&_svg]:text-ui-fg-subtle flex items-center gap-x-2",
    },
      IconComp ? React.createElement(IconComp, null) : null,
      React.createElement("span", null, action.label)
    )

    return React.createElement(DropdownMenu.Item, {
      key: i,
      onClick: getActionHandler(action),
    }, content)
  }

  const contentChildren: React.ReactNode[] = []
  groups.forEach((group, gi) => {
    contentChildren.push(
      React.createElement(DropdownMenu.Group, { key: `g${gi}` },
        ...group.actions.map((action, ai) => renderItem(action, ai))
      )
    )
    // Separator between groups, not after the last one
    if (gi < groups.length - 1) {
      contentChildren.push(
        React.createElement(DropdownMenu.Separator, { key: `s${gi}` })
      )
    }
  })

  return React.createElement(DropdownMenu, null,
    React.createElement(DropdownMenu.Trigger, { asChild: true },
      React.createElement(IconButton, {
        size: "small",
        variant: "transparent",
      },
        React.createElement(EllipsisHorizontal, null)
      )
    ),
    React.createElement(DropdownMenu.Content, null, ...contentChildren)
  )
}

// ──────────────────────────────────────────────
// InfoCard — Container + SectionRow pattern
// ──────────────────────────────────────────────

/** Capitalize first letter of each word, replace underscores with spaces */
function capitalizeStatus(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

registerRenderer("InfoCard", function InfoCardRenderer({ component, data }) {
  const props = component.props as {
    title: string
    titleField?: string
    statusField?: string
    fields: Array<{ key: string; label: string; display?: string }>
    actions?: ActionDef[]
    actionGroups?: ActionGroupDef[]
  }

  // Dynamic title from data, fallback to static title
  const displayTitle = props.titleField
    ? String(resolveDataPath(data, props.titleField) ?? props.title)
    : props.title

  // Status badge in header (if statusField is set)
  const statusValue = props.statusField
    ? resolveDataPath(data, props.statusField)
    : null

  // Build action groups: use actionGroups if provided, else wrap flat actions in a single group
  const groups: ActionGroupDef[] = props.actionGroups
    ? props.actionGroups
    : props.actions?.length
      ? [{ actions: props.actions }]
      : []

  return React.createElement(Container, {
    className: "divide-y p-0",
  },
    // Header: title on left, status badge + action menu on right
    React.createElement("div", {
      className: "flex items-center justify-between px-6 py-4",
    },
      React.createElement(Heading, { level: "h2" }, displayTitle),
      React.createElement("div", {
        className: "flex items-center gap-x-4",
      },
        statusValue != null
          ? React.createElement(StatusBadge, {
              color: getStatusColor(String(statusValue)),
            }, capitalizeStatus(String(statusValue)))
          : null,
        groups.length > 0
          ? React.createElement(ActionMenu, { groups, data })
          : null
      )
    ),
    // Fields as SectionRows (matches Medusa's SectionRow component)
    ...props.fields.map((field) => {
      const value = resolveDataPath(data, field.key)
      return React.createElement("div", {
        key: field.key,
        className: "text-ui-fg-subtle grid w-full grid-cols-2 items-center gap-4 px-6 py-4",
      },
        React.createElement(Text, {
          size: "small",
          weight: "plus",
          leading: "compact",
        }, field.label),
        renderCellValue(value, field.display)
      )
    })
  )
})

// ──────────────────────────────────────────────
// Thumbnail — matches Medusa's Thumbnail component
// ──────────────────────────────────────────────

function Thumbnail({ src, size = "base" }: { src?: string | null; size?: "base" | "small" }) {
  const sizeClass = size === "small" ? "h-5 w-4" : "h-8 w-6"
  return React.createElement("div", {
    className: clx(
      "bg-ui-bg-component flex items-center justify-center overflow-hidden rounded border border-ui-border-base",
      sizeClass
    ),
  },
    src
      ? React.createElement("img", {
          src,
          alt: "",
          className: "h-full w-full object-cover object-center",
        })
      : React.createElement(Photo, { className: "text-ui-fg-subtle" })
  )
}

// ──────────────────────────────────────────────
// StatusCell — colored dot + text (matches Medusa exactly)
// ──────────────────────────────────────────────

function StatusCell({ color, children }: { color: string; children: string }) {
  const colorClasses: Record<string, string> = {
    grey: "bg-ui-tag-neutral-icon",
    green: "bg-ui-tag-green-icon",
    red: "bg-ui-tag-red-icon",
    blue: "bg-ui-tag-blue-icon",
    orange: "bg-ui-tag-orange-icon",
    purple: "bg-ui-tag-purple-icon",
  }

  return React.createElement("div", {
    className: "txt-compact-small text-ui-fg-subtle flex h-full w-full items-center gap-x-2 overflow-hidden",
  },
    React.createElement("div", {
      role: "presentation",
      className: "flex h-5 w-2 items-center justify-center",
    },
      React.createElement("div", {
        className: clx(
          "h-2 w-2 rounded-sm shadow-[0px_0px_0px_1px_rgba(0,0,0,0.12)_inset]",
          colorClasses[color] || colorClasses.grey
        ),
      })
    ),
    React.createElement("span", { className: "truncate" }, children)
  )
}

// ──────────────────────────────────────────────
// Icon map for row actions
// ──────────────────────────────────────────────

function getActionIcon(icon?: string): React.ReactNode {
  switch (icon) {
    case "pencil": return React.createElement(PencilSquare, null)
    case "trash": return React.createElement(Trash, null)
    case "plus": return React.createElement(Plus, null)
    default: return null
  }
}

// ──────────────────────────────────────────────
// PlaceholderCell — renders "-" dash for empty values (matches Medusa)
// ──────────────────────────────────────────────

function PlaceholderCell() {
  return React.createElement("span", {
    className: "txt-compact-small text-ui-fg-muted",
  }, "-")
}

// ──────────────────────────────────────────────
// Cell renderers for EntityTable columns
// ──────────────────────────────────────────────

function renderCellByType(
  col: { key: string; label: string; type?: string; thumbnailKey?: string },
  item: Record<string, unknown>
): React.ReactNode {
  const value = resolveDataPath(item, col.key)

  switch (col.type) {
    case "thumbnail": {
      const thumbSrc = col.thumbnailKey
        ? resolveDataPath(item, col.thumbnailKey) as string | null
        : null
      return React.createElement("div", {
        className: "flex h-full w-full max-w-[250px] items-center gap-x-3 overflow-hidden",
      },
        React.createElement("div", { className: "w-fit flex-shrink-0" },
          React.createElement(Thumbnail, { src: thumbSrc })
        ),
        React.createElement("span", {
          className: "truncate",
          title: String(value ?? ""),
        }, String(value ?? "-"))
      )
    }

    case "badge": {
      if (value == null) return React.createElement(PlaceholderCell, null)
      const strVal = String(value)
      // Capitalize first letter of each word, replace underscores with spaces (matches Medusa)
      const label = strVal.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      return React.createElement(StatusCell, {
        color: getStatusColor(strVal),
      }, label)
    }

    case "count": {
      if (Array.isArray(value)) {
        if (value.length === 0) return React.createElement(PlaceholderCell, null)
        // Show count with singular/plural unit derived from column label
        const unit = col.label.toLowerCase()
        const singular = unit.endsWith("s") ? unit.slice(0, -1) : unit
        const plural = unit.endsWith("s") ? unit : unit + "s"
        return React.createElement("span", {
          className: "txt-compact-small",
        }, `${value.length} ${value.length === 1 ? singular : plural}`)
      }
      if (value == null) return React.createElement(PlaceholderCell, null)
      return React.createElement("span", {
        className: "txt-compact-small",
      }, String(value))
    }

    case "list-count": {
      if (!Array.isArray(value) || value.length === 0) {
        return React.createElement(PlaceholderCell, null)
      }
      const names = (value as Array<Record<string, unknown>>).map(
        (v) => String(v.name || v.title || v.label || v.id || "")
      )
      if (names.length <= 2) {
        return React.createElement("span", {
          className: "txt-compact-small truncate",
          title: names.join(", "),
        }, names.join(", "))
      }
      return React.createElement("div", {
        className: "flex items-center gap-x-1 txt-compact-small",
      },
        React.createElement("span", { className: "truncate" },
          names.slice(0, 2).join(", ")
        ),
        React.createElement(Tooltip, {
          content: React.createElement("ul", { className: "list-none p-0 m-0" },
            names.slice(2).map((n, i) =>
              React.createElement("li", { key: i }, n)
            )
          ),
        },
          React.createElement("span", {
            className: "text-ui-fg-muted whitespace-nowrap cursor-default",
          }, `+${names.length - 2} more`)
        )
      )
    }

    case "display-id": {
      if (value == null) return React.createElement(PlaceholderCell, null)
      return React.createElement("span", {
        className: "txt-compact-small",
      }, `#${value}`)
    }

    case "customer-name": {
      if (typeof value === "object" && value !== null) {
        const customer = value as Record<string, unknown>
        const name = [customer.first_name, customer.last_name]
          .filter(Boolean)
          .join(" ")
        return React.createElement("span", {
          className: "txt-compact-small truncate",
        }, name || String(customer.email || "-"))
      }
      const name = [item.first_name, item.last_name]
        .filter(Boolean)
        .join(" ")
      return React.createElement("span", {
        className: "txt-compact-small truncate",
      }, name || String(item.email || value || "-"))
    }

    case "currency": {
      if (value == null) return React.createElement(PlaceholderCell, null)
      const amount = typeof value === "number"
        ? (value / 100).toLocaleString(undefined, { style: "currency", currency: "EUR" })
        : String(value)
      return React.createElement("span", {
        className: "txt-compact-small tabular-nums",
      }, amount)
    }

    case "date": {
      if (value == null) return React.createElement(PlaceholderCell, null)
      try {
        return React.createElement("span", {
          className: "txt-compact-small text-ui-fg-subtle",
        }, new Date(value as string).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }))
      } catch {
        return React.createElement("span", { className: "txt-compact-small" }, String(value))
      }
    }

    case "number": {
      if (value == null) return React.createElement(PlaceholderCell, null)
      return React.createElement("span", {
        className: "txt-compact-small tabular-nums",
      }, typeof value === "number" ? value.toLocaleString() : String(value))
    }

    case "boolean": {
      return React.createElement("span", {
        className: "txt-compact-small",
      }, value ? "Yes" : "No")
    }

    default: {
      if (value == null) return React.createElement(PlaceholderCell, null)
      if (Array.isArray(value)) {
        return React.createElement("span", {
          className: "txt-compact-small",
        }, `${value.length}`)
      }
      return React.createElement("span", {
        className: "txt-compact-small truncate",
        title: String(value),
      }, String(value))
    }
  }
}

// ──────────────────────────────────────────────
// useSelectedParams — URL param management for filters/search
// (copied from Medusa's data-table/hooks.tsx)
// ──────────────────────────────────────────────

function useSelectedParams({
  param,
  prefix,
  multiple = false,
}: {
  param: string
  prefix?: string
  multiple?: boolean
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const identifier = prefix ? `${prefix}_${param}` : param
  const offsetKey = prefix ? `${prefix}_offset` : "offset"

  const add = useCallback((value: string) => {
    setSearchParams((prev) => {
      const newValue = new URLSearchParams(prev)
      if (multiple) {
        const existingValues = newValue.get(identifier)?.split(",") || []
        if (!existingValues.includes(value)) {
          existingValues.push(value)
          newValue.set(identifier, existingValues.join(","))
        }
      } else {
        newValue.set(identifier, value)
      }
      newValue.delete(offsetKey)
      return newValue
    })
  }, [setSearchParams, identifier, offsetKey, multiple])

  const deleteParam = useCallback((value?: string) => {
    setSearchParams((prev) => {
      if (value && multiple) {
        const existingValues = prev.get(identifier)?.split(",") || []
        const index = existingValues.indexOf(value)
        if (index > -1) {
          existingValues.splice(index, 1)
          prev.set(identifier, existingValues.join(","))
        }
        if (!prev.get(identifier)) {
          prev.delete(identifier)
        }
      } else {
        prev.delete(identifier)
      }
      prev.delete(offsetKey)
      return prev
    })
  }, [setSearchParams, identifier, offsetKey, multiple])

  const get = useCallback(() => {
    return searchParams.get(identifier)?.split(",").filter(Boolean) || []
  }, [searchParams, identifier])

  return { add, delete: deleteParam, get }
}

// ──────────────────────────────────────────────
// DataTableSearch — debounced search input
// (copied from Medusa's data-table-search.tsx)
// ──────────────────────────────────────────────

function DataTableSearch({ prefix }: { prefix?: string }) {
  const selectedParams = useSelectedParams({ param: "q", prefix, multiple: false })
  const initialQuery = selectedParams.get()
  const [localValue, setLocalValue] = useState(initialQuery?.[0] || "")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setLocalValue(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (!value) {
        selectedParams.delete()
      } else {
        selectedParams.add(value)
      }
    }, 300)
  }, [selectedParams])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return React.createElement(Input, {
    autoComplete: "off",
    name: "q",
    type: "search",
    size: "small",
    value: localValue,
    onChange: handleChange,
    placeholder: "Search",
  })
}

// ──────────────────────────────────────────────
// DataTableOrderBy — sort dropdown
// (copied from Medusa's data-table-order-by.tsx)
// ──────────────────────────────────────────────

type OrderByKey = { key: string; label: string }

function DataTableOrderBy({ keys, prefix }: { keys: OrderByKey[]; prefix?: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = prefix ? `${prefix}_order` : "order"

  type SortState = { key?: string; dir: "asc" | "desc" }

  const initState = (): SortState => {
    const sortParam = searchParams.get(param)
    if (!sortParam) return { dir: "asc", key: undefined }
    const dir: "asc" | "desc" = sortParam.startsWith("-") ? "desc" : "asc"
    const key = sortParam.replace("-", "")
    return { key, dir }
  }

  const [state, setState] = useState<SortState>(initState)

  const updateOrderParam = useCallback((s: { key?: string; dir: string }) => {
    if (!s.key) {
      setSearchParams((prev) => { prev.delete(param); return prev })
      return
    }
    const orderParam = s.dir === "asc" ? s.key : `-${s.key}`
    setSearchParams((prev) => { prev.set(param, orderParam); return prev })
  }, [setSearchParams, param])

  const handleKeyChange = useCallback((value: string) => {
    setState((prev) => {
      const newState = { ...prev, key: value }
      updateOrderParam(newState)
      return newState
    })
  }, [updateOrderParam])

  const handleDirChange = useCallback((dir: string) => {
    setState((prev) => {
      const newState: SortState = { ...prev, dir: dir as "asc" | "desc" }
      updateOrderParam(newState)
      return newState
    })
  }, [updateOrderParam])

  return React.createElement(DropdownMenu, null,
    React.createElement(DropdownMenu.Trigger, { asChild: true },
      React.createElement(IconButton, { size: "small" },
        React.createElement(DescendingSorting, null)
      )
    ),
    React.createElement(DropdownMenu.Content, { className: "z-[1]", align: "end" },
      React.createElement(DropdownMenu.RadioGroup, {
        value: state.key,
        onValueChange: handleKeyChange,
      },
        keys.map((k) =>
          React.createElement(DropdownMenu.RadioItem, {
            key: k.key,
            value: k.key,
            onSelect: (e: Event) => e.preventDefault(),
          }, k.label)
        )
      ),
      React.createElement(DropdownMenu.Separator, null),
      React.createElement(DropdownMenu.RadioGroup, {
        value: state.dir,
        onValueChange: handleDirChange,
      },
        React.createElement(DropdownMenu.RadioItem, {
          className: "flex items-center justify-between",
          value: "asc",
          onSelect: (e: Event) => e.preventDefault(),
        }, "Ascending"),
        React.createElement(DropdownMenu.RadioItem, {
          className: "flex items-center justify-between",
          value: "desc",
          onSelect: (e: Event) => e.preventDefault(),
        }, "Descending")
      )
    )
  )
}

// ──────────────────────────────────────────────
// ColumnsToggle — show/hide columns dropdown
// ──────────────────────────────────────────────

function ColumnsToggle({
  columns,
  columnVisibility,
  onToggle,
}: {
  columns: Array<{ id: string; label: string }>
  columnVisibility: VisibilityState
  onToggle: (columnId: string) => void
}) {
  return React.createElement(DropdownMenu, null,
    React.createElement(DropdownMenu.Trigger, { asChild: true },
      React.createElement(IconButton, { size: "small" },
        React.createElement(Adjustments, null)
      )
    ),
    React.createElement(DropdownMenu.Content, { className: "z-[1]", align: "end" },
      React.createElement(DropdownMenu.Label, null, "Columns"),
      React.createElement(DropdownMenu.Separator, null),
      ...columns.map((col) => {
        const isVisible = columnVisibility[col.id] !== false
        return React.createElement(DropdownMenu.Item, {
          key: col.id,
          className: "flex items-center gap-x-2",
          onSelect: (e: Event) => {
            e.preventDefault()
            onToggle(col.id)
          },
        },
          React.createElement("div", {
            className: clx(
              "flex h-5 w-5 items-center justify-center rounded border",
              isVisible
                ? "border-ui-fg-base bg-ui-fg-base text-ui-bg-base"
                : "border-ui-border-strong"
            ),
          },
            isVisible
              ? React.createElement("svg", {
                  width: "10",
                  height: "8",
                  viewBox: "0 0 10 8",
                  fill: "none",
                  xmlns: "http://www.w3.org/2000/svg",
                },
                  React.createElement("path", {
                    d: "M1 4L3.5 6.5L9 1",
                    stroke: "currentColor",
                    strokeWidth: "1.5",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  })
                )
              : null
          ),
          col.label
        )
      })
    )
  )
}

// ──────────────────────────────────────────────
// DataTableFilter — "Add filter" + active filter chips
// (simplified from Medusa's data-table-filter.tsx)
// ──────────────────────────────────────────────

type FilterDef = {
  key: string
  label: string
  type: "select" | "multiselect" | "radio"
  options: Array<{ label: string; value: string }>
}

function DataTableFilterBar({ filters, prefix }: { filters: FilterDef[]; prefix?: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeFilters, setActiveFilters] = useState<FilterDef[]>(() => {
    // Initialize from URL params
    return filters.filter((f) => {
      const key = prefix ? `${prefix}_${f.key}` : f.key
      return !!searchParams.get(key)
    })
  })
  const [menuOpen, setMenuOpen] = useState(false)

  const availableFilters = filters.filter(
    (f) => !activeFilters.find((af) => af.key === f.key)
  )

  const addFilter = useCallback((filter: FilterDef) => {
    setMenuOpen(false)
    setActiveFilters((prev) => [...prev, filter])
  }, [])

  const removeFilter = useCallback((key: string) => {
    setActiveFilters((prev) => prev.filter((f) => f.key !== key))
    setSearchParams((prev) => {
      prev.delete(prefix ? `${prefix}_${key}` : key)
      prev.delete(prefix ? `${prefix}_offset` : "offset")
      return prev
    })
  }, [setSearchParams, prefix])

  const removeAllFilters = useCallback(() => {
    setActiveFilters([])
    setSearchParams((prev) => {
      for (const f of filters) {
        prev.delete(prefix ? `${prefix}_${f.key}` : f.key)
      }
      prev.delete(prefix ? `${prefix}_offset` : "offset")
      return prev
    })
  }, [setSearchParams, filters, prefix])

  return React.createElement("div", {
    className: "max-w-2/3 flex flex-wrap items-center gap-2",
  },
    // Active filter chips
    ...activeFilters.map((filter) =>
      React.createElement(SelectFilterChip, {
        key: filter.key,
        filter,
        prefix,
        multiple: filter.type === "multiselect",
        onRemove: () => removeFilter(filter.key),
      })
    ),
    // "Add filter" button
    availableFilters.length > 0
      ? React.createElement(DropdownMenu, {
          open: menuOpen,
          onOpenChange: setMenuOpen,
        },
          React.createElement(DropdownMenu.Trigger, { asChild: true },
            React.createElement(Button, {
              size: "small",
              variant: "secondary",
            }, "Add filter")
          ),
          React.createElement(DropdownMenu.Content, {
            className: "z-[1]",
            align: "start",
          },
            availableFilters.map((filter) =>
              React.createElement(DropdownMenu.Item, {
                key: filter.key,
                onClick: () => addFilter(filter),
              }, filter.label)
            )
          )
        )
      : null,
    // "Clear all" button
    activeFilters.length > 0
      ? React.createElement("button", {
          type: "button",
          onClick: removeAllFilters,
          className: "text-ui-fg-muted transition-fg txt-compact-small-plus rounded-md px-2 py-1 hover:text-ui-fg-subtle",
        }, "Clear all")
      : null
  )
}

// ──────────────────────────────────────────────
// SelectFilterChip — individual filter chip with dropdown
// ──────────────────────────────────────────────

function SelectFilterChip({
  filter,
  prefix,
  multiple,
  onRemove,
}: {
  filter: FilterDef
  prefix?: string
  multiple?: boolean
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const selectedParams = useSelectedParams({
    param: filter.key,
    prefix,
    multiple,
  })
  const currentValue = selectedParams.get()

  const labelValues = currentValue
    .map((v) => filter.options.find((o) => o.value === v)?.label)
    .filter(Boolean) as string[]

  const handleSelect = useCallback((value: string) => {
    const isSelected = selectedParams.get().includes(value)
    if (isSelected) {
      selectedParams.delete(value)
    } else {
      selectedParams.add(value)
    }
  }, [selectedParams])

  const handleOpenChange = useCallback((o: boolean) => {
    setOpen(o)
    if (!o && currentValue.length === 0) {
      setTimeout(() => onRemove(), 200)
    }
  }, [currentValue.length, onRemove])

  const displayValue = labelValues.join(", ")

  return React.createElement(DropdownMenu, {
    open,
    onOpenChange: handleOpenChange,
  },
    // Chip
    React.createElement("div", {
      className: "bg-ui-bg-field transition-fg shadow-borders-base text-ui-fg-subtle flex cursor-default select-none items-stretch overflow-hidden rounded-md",
    },
      React.createElement("div", {
        className: clx("flex items-center justify-center whitespace-nowrap px-2 py-1", {
          "border-r": !!displayValue,
        }),
      },
        React.createElement(Text, { size: "small", weight: "plus", leading: "compact" as any },
          filter.label
        )
      ),
      displayValue
        ? React.createElement("div", { className: "flex w-full items-center overflow-hidden" },
            React.createElement("div", {
              className: "border-r p-1 px-2",
            },
              React.createElement(Text, {
                size: "small",
                weight: "plus",
                leading: "compact" as any,
                className: "text-ui-fg-muted",
              }, "is")
            ),
            React.createElement(DropdownMenu.Trigger, {
              asChild: true,
              className: "flex-1 cursor-pointer overflow-hidden border-r p-1 px-2 hover:bg-ui-bg-field-hover",
            },
              React.createElement(Text, {
                size: "small",
                leading: "compact" as any,
                weight: "plus",
                className: "truncate text-nowrap",
              }, displayValue)
            ),
            React.createElement("button", {
              onClick: (e: React.MouseEvent) => { e.stopPropagation(); onRemove() },
              className: "text-ui-fg-muted transition-fg flex items-center justify-center p-1 hover:bg-ui-bg-subtle-hover",
            },
              React.createElement(XMarkMini, null)
            )
          )
        : React.createElement(DropdownMenu.Trigger, {
            asChild: true,
            className: "flex-1 cursor-pointer overflow-hidden border-l p-1 px-2 hover:bg-ui-bg-field-hover",
          },
            React.createElement(Text, {
              size: "small",
              leading: "compact" as any,
              className: "text-ui-fg-muted",
            }, "Select...")
          )
    ),
    // Dropdown content
    React.createElement(DropdownMenu.Content, {
      className: "z-[1] max-h-[200px] w-[300px] overflow-auto",
      align: "start",
    },
      filter.options.map((option) => {
        const isSelected = currentValue.includes(option.value)
        return React.createElement(DropdownMenu.Item, {
          key: option.value,
          className: clx("flex items-center gap-x-2", {
            "bg-ui-bg-base-pressed": isSelected,
          }),
          onSelect: (e: Event) => {
            e.preventDefault()
            handleSelect(option.value)
          },
        },
          React.createElement("div", {
            className: clx("flex h-5 w-5 items-center justify-center", {
              "[&_svg]:invisible": !isSelected,
            }),
          },
            React.createElement("div", {
              className: clx("h-2 w-2 rounded-full", {
                "bg-ui-fg-base": isSelected,
              }),
            })
          ),
          option.label
        )
      })
    )
  )
}

// ──────────────────────────────────────────────
// EntityTable — Uses @tanstack/react-table directly
// Follows exact same pattern as Medusa's _DataTable:
//   DataTableQuery (filters left, search+orderBy right)
//   + DataTableRoot (table + pagination)
// ──────────────────────────────────────────────

registerRenderer("EntityTable", function EntityTableRenderer({ component, data }) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const props = component.props as {
    heading?: string
    subHeading?: string
    pageActions?: Array<{ label: string; to?: string; variant?: string }>
    columns: Array<{
      key: string
      label: string
      type?: string
      thumbnailKey?: string
      sortable?: boolean
    }>
    searchable?: boolean
    filterable?: boolean
    pagination?: boolean
    navigateTo?: string
    rowActions?: Array<{
      label: string
      icon?: string
      to?: string
      action?: string
      destructive?: boolean
    }>
    orderBy?: Array<{ key: string; label: string }>
    actions?: Array<{ label: string; icon?: string; to?: string; action?: string; destructive?: boolean }>
    filters?: Array<{
      key: string
      label: string
      type: "select" | "multiselect" | "radio"
      options: Array<{ label: string; value: string }>
    }>
  }

  const rowActions = props.rowActions || props.actions || []
  const items = Array.isArray(data) ? data : (data as any)?.items || []
  const count = (data as any)?.count ?? items.length
  const _pageSize = 15

  // ── URL-based pagination (copied from Medusa's useDataTable hook) ──
  const offset = searchParams.get("offset")
  const [paginationState, setPaginationState] = useState<PaginationState>({
    pageIndex: offset ? Math.ceil(Number(offset) / _pageSize) : 0,
    pageSize: _pageSize,
  })

  useEffect(() => {
    const index = offset ? Math.ceil(Number(offset) / _pageSize) : 0
    if (index === paginationState.pageIndex) return
    setPaginationState((prev) => ({ ...prev, pageIndex: index }))
  }, [offset, _pageSize, paginationState.pageIndex])

  const onPaginationChange = useCallback((
    updater: ((old: PaginationState) => PaginationState) | PaginationState
  ) => {
    const state = typeof updater === "function" ? updater(paginationState) : updater
    const { pageIndex, pageSize } = state
    setSearchParams((prev) => {
      if (!pageIndex) {
        prev.delete("offset")
      } else {
        prev.set("offset", String(pageIndex * pageSize))
      }
      return prev
    })
    setPaginationState(state)
  }, [paginationState, setSearchParams])

  // ── Column visibility state ──
  // Extra orderBy columns (not in explicit columns) are hidden by default
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    const initial: VisibilityState = {}
    if (props.orderBy) {
      const visibleKeys = new Set(props.columns.map((c) => c.key))
      for (const ob of props.orderBy) {
        if (!visibleKeys.has(ob.key)) {
          initial[ob.key] = false
        }
      }
    }
    return initial
  })

  // All toggleable columns (all spec columns except thumbnail which is always needed)
  const toggleableColumns = useMemo(() => {
    const allCols: Array<{ id: string; label: string }> = []
    for (const col of props.columns) {
      allCols.push({ id: col.key, label: col.label })
    }
    // Add orderBy keys that aren't in explicit columns (like created_at, updated_at)
    if (props.orderBy) {
      const visibleKeys = new Set(props.columns.map((c) => c.key))
      for (const ob of props.orderBy) {
        if (!visibleKeys.has(ob.key)) {
          allCols.push({ id: ob.key, label: ob.label })
        }
      }
    }
    return allCols
  }, [props.columns, props.orderBy])

  const handleColumnToggle = useCallback((columnId: string) => {
    setColumnVisibility((prev) => ({
      ...prev,
      [columnId]: prev[columnId] === false ? true : false,
    }))
  }, [])

  // ── Build @tanstack/react-table columns ──

  const hasActions = rowActions.length > 0

  const columns: ColumnDef<Record<string, unknown>, any>[] = useMemo(() => {
    const cols: ColumnDef<Record<string, unknown>, any>[] = []

    for (const col of props.columns) {
      cols.push({
        id: col.key,
        header: col.label,
        accessorFn: (row) => resolveDataPath(row, col.key),
        cell: (info) => renderCellByType(col, info.row.original),
      })
    }

    // Add extra columns from orderBy that aren't in the explicit columns list
    // (e.g., created_at, updated_at — hidden by default, toggleable)
    if (props.orderBy) {
      const visibleKeys = new Set(props.columns.map((c) => c.key))
      for (const ob of props.orderBy) {
        if (!visibleKeys.has(ob.key)) {
          cols.push({
            id: ob.key,
            header: ob.label,
            accessorFn: (row) => resolveDataPath(row, ob.key),
            cell: (info) => renderCellByType(
              { key: ob.key, label: ob.label, type: "date" },
              info.row.original
            ),
          })
        }
      }
    }

    // Add actions column if needed
    if (hasActions) {
      cols.push({
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const item = row.original
          return React.createElement(DropdownMenu, null,
            React.createElement(DropdownMenu.Trigger, { asChild: true },
              React.createElement(IconButton, {
                variant: "transparent",
                size: "small",
              },
                React.createElement(EllipsisHorizontal, null)
              )
            ),
            React.createElement(DropdownMenu.Content, { align: "end" },
              rowActions.map((action, j) => {
                const isDestructive = action.destructive
                const icon = getActionIcon(action.icon)
                if (action.to) {
                  const resolvedTo = action.to.replace(/:(\w+)/g, (_, key) =>
                    String(item[key] || item.id || "")
                  )
                  return React.createElement(DropdownMenu.Item, {
                    key: j,
                    asChild: true,
                    className: isDestructive ? "text-ui-fg-error" : undefined,
                  },
                    React.createElement(Link, { to: resolvedTo },
                      icon,
                      React.createElement("span", { className: icon ? "ml-2" : undefined }, action.label)
                    )
                  )
                }
                return React.createElement(DropdownMenu.Item, {
                  key: j,
                  className: isDestructive ? "text-ui-fg-error" : undefined,
                },
                  icon,
                  React.createElement("span", { className: icon ? "ml-2" : undefined }, action.label)
                )
              })
            )
          )
        },
      })
    }

    return cols
  }, [props.columns, rowActions, hasActions])

  // ── Create table instance (same as Medusa's useDataTable) ──

  const table = useReactTable({
    data: items,
    columns,
    state: {
      pagination: paginationState,
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
    pageCount: Math.ceil((count ?? 0) / _pageSize),
    getRowId: (row) => (row.id as string) || String(items.indexOf(row)),
    onPaginationChange: onPaginationChange as any,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
  })

  // ── Navigate to row on click ──

  const getNavigateTo = useCallback((row: Row<Record<string, unknown>>): string | undefined => {
    if (!props.navigateTo) return undefined
    return props.navigateTo.replace(/:(\w+)/g, (_, key) =>
      String(row.original[key] || row.original.id || "")
    )
  }, [props.navigateTo])

  // ── Scroll to top on page change ──
  const scrollableRef = useRef<HTMLDivElement>(null)
  const { pageIndex } = table.getState().pagination

  useEffect(() => {
    scrollableRef.current?.scroll({ top: 0, left: 0 })
  }, [pageIndex])

  // Column widths
  const hasSelect = false // no row selection for now
  const colCount = columns.length - (hasSelect ? 1 : 0) - (hasActions ? 1 : 0)
  const colWidth = 100 / colCount

  // ── Build page action buttons ──
  const actionButtons = props.pageActions?.map((action, i) =>
    React.createElement(Button, {
      key: i,
      variant: (action.variant as any) || "secondary",
      size: "small",
      asChild: true,
    },
      React.createElement(Link, { to: action.to || "#" }, action.label)
    )
  )

  // ── Render ──
  // Structure: Container > heading row > DataTableQuery > DataTableRoot > Pagination
  // Exactly matches Medusa's _DataTable layout

  return React.createElement(Container, { className: "divide-y p-0" },
    // ── Row 1: Heading + action buttons ──
    (props.heading || props.subHeading || (actionButtons && actionButtons.length > 0))
      ? React.createElement("div", {
          className: "flex items-center justify-between px-6 py-4",
        },
          React.createElement("div", null,
            props.heading
              ? React.createElement(Heading, { level: "h1" }, props.heading)
              : null,
            props.subHeading
              ? React.createElement(Text, {
                  size: "small",
                  className: "text-ui-fg-subtle",
                }, props.subHeading)
              : null
          ),
          actionButtons && actionButtons.length > 0
            ? React.createElement("div", { className: "flex items-center gap-x-2" },
                ...actionButtons
              )
            : null
        )
      : null,

    // ── Row 2: DataTableQuery — filters left, search + orderBy right ──
    // (same layout as Medusa's DataTableQuery component)
    (props.searchable !== false || props.orderBy || (props.filters && props.filters.length > 0))
      ? React.createElement("div", {
          className: "flex items-start justify-between gap-x-4 px-6 py-4",
        },
          // Left side: filters
          React.createElement("div", { className: "w-full max-w-[60%]" },
            props.filters && props.filters.length > 0
              ? React.createElement(DataTableFilterBar, {
                  filters: props.filters,
                })
              : null
          ),
          // Right side: search + orderBy
          React.createElement("div", {
            className: "flex shrink-0 items-center gap-x-2",
          },
            props.searchable !== false
              ? React.createElement(DataTableSearch, null)
              : null,
            props.orderBy && props.orderBy.length > 0
              ? React.createElement(DataTableOrderBy, {
                  keys: props.orderBy,
                })
              : null,
            toggleableColumns.length > 0
              ? React.createElement(ColumnsToggle, {
                  columns: toggleableColumns,
                  columnVisibility,
                  onToggle: handleColumnToggle,
                })
              : null
          )
        )
      : null,

    // ── DataTableRoot: Table + Pagination (single child to avoid double border) ──
    React.createElement("div", {
      className: "flex w-full flex-col overflow-hidden",
    },
      React.createElement("div", {
        ref: scrollableRef,
        className: "w-full overflow-x-auto",
      },
        items.length > 0
          ? React.createElement(Table, { className: "relative w-full" },
              React.createElement(Table.Header, { className: "border-t-0" },
                table.getHeaderGroups().map((headerGroup) =>
                  React.createElement(Table.Row, {
                    key: headerGroup.id,
                    className: clx({
                      "relative border-b-0 [&_th:last-of-type]:w-[1%] [&_th:last-of-type]:whitespace-nowrap":
                        hasActions,
                    }),
                  },
                    headerGroup.headers.map((header) => {
                      const isActionHeader = header.id === "actions"
                      return React.createElement(Table.HeaderCell, {
                        key: header.id,
                        style: {
                          width: !isActionHeader ? `${colWidth}%` : undefined,
                        },
                      },
                        flexRender(header.column.columnDef.header, header.getContext())
                      )
                    })
                  )
                )
              ),
              React.createElement(Table.Body, { className: "border-b-0" },
                table.getRowModel().rows.map((row) => {
                  const to = getNavigateTo(row)
                  return React.createElement(Table.Row, {
                    key: row.id,
                    className: clx(
                      "transition-fg group/row",
                      "[&_td:last-of-type]:w-[1%] [&_td:last-of-type]:whitespace-nowrap",
                      { "cursor-pointer": !!to }
                    ),
                  },
                    row.getVisibleCells().map((cell, index) => {
                      const isFirstCell = index === 0
                      const isSelectCell = false
                      const shouldRenderAsLink = !!to && cell.column.id !== "actions"

                      const Inner = flexRender(cell.column.columnDef.cell, cell.getContext())

                      if (shouldRenderAsLink) {
                        return React.createElement(Table.Cell, {
                          key: cell.id,
                          className: "!ps-0 !pe-0",
                        },
                          React.createElement(Link, {
                            to: to!,
                            className: "size-full outline-none",
                            tabIndex: isFirstCell ? 0 : -1,
                          },
                            React.createElement("div", {
                              className: clx("flex size-full items-center pe-6", {
                                "ps-6": isFirstCell,
                              }),
                            }, Inner)
                          )
                        )
                      }

                      return React.createElement(Table.Cell, {
                        key: cell.id,
                      }, Inner)
                    })
                  )
                })
              )
            )
          : React.createElement("div", {
              className: "flex items-center justify-center py-10 text-ui-fg-muted txt-compact-small",
            }, "No records")
      ),
      // Pagination inside the same wrapper (avoids double border from Container's divide-y)
      props.pagination !== false
        ? React.createElement(Table.Pagination, {
            className: "flex-shrink-0",
            canNextPage: table.getCanNextPage(),
            canPreviousPage: table.getCanPreviousPage(),
            nextPage: table.nextPage,
            previousPage: table.previousPage,
            count,
            pageIndex: table.getState().pagination.pageIndex,
            pageCount: table.getPageCount(),
            pageSize: table.getState().pagination.pageSize,
            translations: {
              of: "of",
              results: "results",
              pages: "pages",
              prev: "Prev",
              next: "Next",
            },
          })
        : null
    )
  )
})

// ──────────────────────────────────────────────
// RelationTable
// ──────────────────────────────────────────────

registerRenderer("RelationTable", function RelationTableRenderer({ component, data }) {
  const navigate = useNavigate()
  const props = component.props as {
    title: string
    relation: string
    columns: Array<{ key: string; label: string; type?: string }>
    actions?: Array<{ label: string; to?: string }>
    summaries?: Array<{ label: string; value: { key: string; type?: string } }>
    navigateTo?: string
  }

  const items = (resolveDataPath(data, props.relation) as unknown[]) || []

  return React.createElement(Container, {
    className: "divide-y p-0",
  },
    // Header
    React.createElement("div", {
      className: "flex items-center justify-between px-6 py-4",
    },
      React.createElement(Heading, { level: "h2" }, props.title),
      props.actions?.length
        ? React.createElement("div", { className: "flex items-center gap-x-2" },
            ...renderActionButtons(props.actions, data)
          )
        : null
    ),
    // Table
    React.createElement(Table, null,
      React.createElement(Table.Header, null,
        React.createElement(Table.Row, null,
          props.columns.map((col) =>
            React.createElement(Table.HeaderCell, { key: col.key }, col.label)
          )
        )
      ),
      React.createElement(Table.Body, null,
        items.length === 0
          ? React.createElement(Table.Row, null,
              React.createElement(Table.Cell, {
                className: "text-center py-6 text-ui-fg-muted",
              } as any, "No items")
            )
          : (items as Record<string, unknown>[]).map((item, i) =>
              React.createElement(Table.Row, {
                key: (item.id as string) || i,
                className: clx(
                  props.navigateTo && "cursor-pointer hover:bg-ui-bg-base-hover"
                ),
                onClick: props.navigateTo
                  ? () => {
                      const path = props.navigateTo!.replace(/:(\w+)/g, (_, key) =>
                        String(item[key] || item.id || "")
                      )
                      navigate(path)
                    }
                  : undefined,
              },
                props.columns.map((col) =>
                  React.createElement(Table.Cell, { key: col.key },
                    renderCellValue(resolveDataPath(item, col.key), col.type)
                  )
                )
              )
            )
      )
    ),
    // Summaries
    props.summaries
      ? React.createElement("div", {
          className: "bg-ui-bg-subtle px-6 py-3",
        },
          props.summaries.map((s, i) =>
            React.createElement("div", {
              key: i,
              className: "flex items-center justify-between py-1",
            },
              React.createElement(Text, {
                size: "small",
                className: "text-ui-fg-subtle",
              }, s.label),
              React.createElement(Text, {
                size: "small",
                weight: "plus",
              }, formatValue(resolveDataPath(data, s.value.key), s.value.type))
            )
          )
        )
      : null
  )
})

// ──────────────────────────────────────────────
// RelationList
// ──────────────────────────────────────────────

registerRenderer("RelationList", function RelationListRenderer({ component, data }) {
  const props = component.props as {
    title: string
    relation: string
    display: { primary: string; secondary?: string }
    actions?: Array<{ label: string; to?: string }>
  }

  const items = (resolveDataPath(data, props.relation) as unknown[]) || []

  return React.createElement(Container, {
    className: "divide-y p-0",
  },
    React.createElement("div", {
      className: "flex items-center justify-between px-6 py-4",
    },
      React.createElement(Heading, { level: "h2" }, props.title),
      props.actions?.length
        ? React.createElement("div", { className: "flex items-center gap-x-2" },
            ...renderActionButtons(props.actions, data)
          )
        : null
    ),
    React.createElement("div", { className: "divide-y" },
      items.length === 0
        ? React.createElement("div", {
            className: "px-6 py-6 text-center text-ui-fg-muted text-sm",
          }, "No items")
        : (items as Record<string, unknown>[]).map((item, i) =>
            React.createElement("div", {
              key: (item.id as string) || i,
              className: "flex items-center justify-between px-6 py-3",
            },
              React.createElement("div", null,
                React.createElement(Text, {
                  size: "small",
                  weight: "plus",
                }, String(resolveDataPath(item, props.display.primary) ?? "-")),
                props.display.secondary
                  ? React.createElement(Text, {
                      size: "small",
                      className: "text-ui-fg-subtle",
                    }, String(resolveDataPath(item, props.display.secondary) ?? ""))
                  : null
              )
            )
          )
    )
  )
})

// ──────────────────────────────────────────────
// MediaCard
// ──────────────────────────────────────────────

registerRenderer("MediaCard", function MediaCardRenderer({ component, data }) {
  const props = component.props as {
    title: string
    field: string
    actions?: Array<{ label: string; to?: string }>
  }

  const images = (resolveDataPath(data, props.field) as Array<{ url?: string }>) || []

  return React.createElement(Container, {
    className: "divide-y p-0",
  },
    React.createElement("div", {
      className: "flex items-center justify-between px-6 py-4",
    },
      React.createElement(Heading, { level: "h2" }, props.title),
      props.actions?.length
        ? React.createElement("div", { className: "flex items-center gap-x-2" },
            ...renderActionButtons(props.actions, data)
          )
        : null
    ),
    React.createElement("div", {
      className: "grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-3 p-6",
    },
      images.length === 0
        ? React.createElement(Text, {
            size: "small",
            className: "text-ui-fg-muted col-span-full text-center py-4",
          }, "No media")
        : images.map((img, i) =>
            React.createElement("div", {
              key: i,
              className: "aspect-square rounded-lg border border-ui-border-base overflow-hidden bg-ui-bg-subtle",
            },
              img.url
                ? React.createElement("img", {
                    src: img.url,
                    alt: "",
                    className: "w-full h-full object-cover",
                  })
                : React.createElement("div", {
                    className: "w-full h-full flex items-center justify-center text-ui-fg-muted text-xs",
                  }, "No image")
            )
          )
    )
  )
})

// ──────────────────────────────────────────────
// JsonCard (Metadata)
// ──────────────────────────────────────────────

registerRenderer("JsonCard", function JsonCardRenderer({ component, data }) {
  const props = component.props as { title: string; field: string }
  const value = resolveDataPath(data, props.field)

  return React.createElement(Container, {
    className: "divide-y p-0",
  },
    React.createElement("div", {
      className: "flex items-center justify-between px-6 py-4",
    },
      React.createElement(Heading, { level: "h2" }, props.title)
    ),
    React.createElement("pre", {
      className: "px-6 py-4 font-mono text-xs text-ui-fg-subtle bg-ui-bg-subtle overflow-x-auto whitespace-pre-wrap",
    }, JSON.stringify(value, null, 2) || "null")
  )
})

// ──────────────────────────────────────────────
// ActivityCard
// ──────────────────────────────────────────────

registerRenderer("ActivityCard", function ActivityCardRenderer({ component, data }) {
  const props = component.props as { title: string; relation: string }
  const items = (resolveDataPath(data, props.relation) as unknown[]) || []

  return React.createElement(Container, {
    className: "divide-y p-0",
  },
    React.createElement("div", {
      className: "px-6 py-4",
    },
      React.createElement(Heading, { level: "h2" }, props.title)
    ),
    React.createElement("div", { className: "divide-y" },
      items.length === 0
        ? React.createElement("div", {
            className: "px-6 py-6 text-center text-ui-fg-muted text-sm",
          }, "No activity")
        : (items as Record<string, unknown>[]).map((item, i) =>
            React.createElement("div", {
              key: i,
              className: "flex items-center justify-between px-6 py-3",
            },
              React.createElement(Text, { size: "small" },
                String(item.description || item.type || "Event")
              ),
              React.createElement(Text, {
                size: "small",
                className: "text-ui-fg-subtle",
              },
                item.created_at
                  ? new Date(item.created_at as string).toLocaleString()
                  : ""
              )
            )
          )
    )
  )
})

// ──────────────────────────────────────────────
// StatsCard
// ──────────────────────────────────────────────

registerRenderer("StatsCard", function StatsCardRenderer({ component, data }) {
  const props = component.props as {
    title: string
    metrics: Array<{ label: string; key: string; format?: string }>
  }

  return React.createElement(Container, {
    className: "divide-y p-0",
  },
    React.createElement("div", {
      className: "px-6 py-4",
    },
      React.createElement(Heading, { level: "h2" }, props.title)
    ),
    React.createElement("div", {
      className: "grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4 p-6",
    },
      props.metrics.map((metric, i) =>
        React.createElement("div", {
          key: i,
          className: "flex flex-col gap-y-1",
        },
          React.createElement(Text, {
            size: "xsmall",
            className: "text-ui-fg-subtle",
            weight: "plus",
          }, metric.label),
          React.createElement(Text, {
            size: "xlarge",
            weight: "plus",
          }, formatValue(resolveDataPath(data, metric.key), metric.format))
        )
      )
    )
  )
})

// ──────────────────────────────────────────────
// TreeList
// ──────────────────────────────────────────────

registerRenderer("TreeList", function TreeListRenderer({ component, data }) {
  const props = component.props as {
    title: string
    relation: string
    display: { primary: string }
    childrenKey: string
    actions?: Array<{ label: string; to?: string }>
    navigateTo?: string
  }

  const items = (resolveDataPath(data, props.relation) as unknown[]) || []

  function renderTree(nodes: unknown[], depth: number): React.ReactElement {
    return React.createElement("div", { className: "divide-y" },
      (nodes as Record<string, unknown>[]).map((node, i) =>
        React.createElement("div", { key: (node.id as string) || i },
          React.createElement("div", {
            className: "flex items-center px-6 py-2.5",
            style: { paddingLeft: 24 + depth * 20 },
          },
            React.createElement(Text, {
              size: "small",
              weight: depth === 0 ? "plus" : "regular",
            }, String(resolveDataPath(node, props.display.primary) ?? "-"))
          ),
          Array.isArray(node[props.childrenKey]) &&
          (node[props.childrenKey] as unknown[]).length > 0
            ? renderTree(node[props.childrenKey] as unknown[], depth + 1)
            : null
        )
      )
    )
  }

  return React.createElement(Container, {
    className: "divide-y p-0",
  },
    React.createElement("div", {
      className: "flex items-center justify-between px-6 py-4",
    },
      React.createElement(Heading, { level: "h2" }, props.title),
      props.actions?.length
        ? React.createElement("div", { className: "flex items-center gap-x-2" },
            ...renderActionButtons(props.actions, data)
          )
        : null
    ),
    items.length === 0
      ? React.createElement("div", {
          className: "px-6 py-6 text-center text-ui-fg-muted text-sm",
        }, "No items")
      : renderTree(items, 0)
  )
})

// ──────────────────────────────────────────────
// ReactBridge
// ──────────────────────────────────────────────

registerRenderer("ReactBridge", function ReactBridgeRenderer({ component }) {
  const props = component.props as {
    component: string
    fallback?: string
  }

  return React.createElement(Container, {
    className: "p-0",
  },
    React.createElement("div", {
      className: "px-6 py-6 text-center text-ui-fg-muted text-sm",
    }, props.fallback || `React component: ${props.component}`)
  )
})

export { formatValue }
