export const queryKeysFactory = <T>(globalKey: T) => {
  return {
    all: [globalKey] as const,
    lists: () => [globalKey, 'list'] as const,
    list: (query?: unknown) => (query ? ([globalKey, 'list', { query }] as const) : ([globalKey, 'list'] as const)),
    details: () => [globalKey, 'detail'] as const,
    detail: (id: string, query?: unknown) =>
      query ? ([globalKey, 'detail', id, { query }] as const) : ([globalKey, 'detail', id] as const),
  }
}
