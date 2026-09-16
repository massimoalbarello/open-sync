import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
export const noteKeys = { owner: (ownerId: string) => ['notes', ownerId] as const };
export function notesOptions(ownerId: string) {
  return queryOptions({
    queryKey: noteKeys.owner(ownerId),
    queryFn: async () => {
      const result = await api.api.notes.get();
      if (result.error) {
        throw new Error('Could not load your notes. Try again.');
      }
      return result.data;
    },
  });
}
export async function createNote(body: string) {
  const result = await api.api.notes.post({ body });
  if (result.error) {
    throw new Error('Could not save your note. Use 1–280 characters and try again.');
  }
  return result.data;
}
export async function deleteNote(id: string) {
  const result = await api.api.notes({ id }).delete();
  if (result.error) {
    throw new Error('Could not delete your note. Try again.');
  }
}
