import { afterEach, expect, test } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NoteForm } from '../src/components/note-form';

afterEach(cleanup);
test('validation waits for submission and a failed save preserves the draft', async () => {
  const user = userEvent.setup();
  const saves: string[] = [];
  render(
    <NoteForm
      onSave={(body) => {
        saves.push(body);
        return Promise.resolve(false);
      }}
    />,
  );
  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  expect(screen.getByRole('alert').textContent).toContain('Write something');
  expect(saves).toEqual([]);
  await user.type(screen.getByLabelText('What’s on your mind?'), 'Keep this draft');
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() => expect(saves).toEqual(['Keep this draft']));
  expect((screen.getByLabelText('What’s on your mind?') as HTMLInputElement).value).toBe(
    'Keep this draft',
  );
});
