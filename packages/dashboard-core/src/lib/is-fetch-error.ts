interface FetchError {
  status: number
  message: string
  name: string
}

export const isFetchError = (error: unknown): error is FetchError => {
  return error !== null && typeof error === 'object' && 'status' in error && 'message' in error
}
