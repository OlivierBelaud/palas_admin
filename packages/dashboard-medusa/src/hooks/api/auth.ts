import { useMutation } from '@tanstack/react-query'
import { sdk } from '../../lib/sdk'

export const useSignInWithEmailPass = (options?: Record<string, unknown>) => {
  return useMutation({
    mutationFn: (payload: { email: string; password: string }) => sdk.auth.login('user', 'emailpass', payload),
    ...(options as any),
  })
}

export const useLogout = (options?: Record<string, unknown>) => {
  return useMutation({
    mutationFn: () => sdk.auth.logout(),
    ...(options as any),
  })
}

export const useResetPasswordForEmailPass = (options?: Record<string, unknown>) => {
  return useMutation({
    mutationFn: (payload: { email: string }) =>
      sdk.auth.resetPassword('user', 'emailpass', {
        identifier: payload.email,
      }),
    ...(options as any),
  })
}
