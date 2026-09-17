import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { authClient } from '../lib/auth';
export const registrationOptions = queryOptions({
  queryKey: ['registration'],
  queryFn: async () => {
    const result = await api.api.registration.get();
    if (result.error) {
      throw new Error('Could not check instance setup.');
    }
    return result.data;
  },
});
export const sessionOptions = queryOptions({
  queryKey: ['session'],
  queryFn: async () => {
    const result = await authClient.getSession();
    if (result.error) {
      throw new Error(result.error.message ?? 'Could not load your account.');
    }
    return result.data;
  },
});
export async function registerAccount() {
  const result = await authClient.passkey.addPasskey({ name: 'My passkey', createSession: true });
  if (result.error) {
    throw new Error(result.error.message ?? 'Could not create your passkey.');
  }
}
export async function signIn() {
  const result = await authClient.signIn.passkey();
  if (result.error) {
    throw new Error(result.error.message ?? 'Could not sign in.');
  }
}
export async function signOut() {
  const result = await authClient.signOut();
  if (result.error) {
    throw new Error(result.error.message ?? 'Could not sign out.');
  }
}
