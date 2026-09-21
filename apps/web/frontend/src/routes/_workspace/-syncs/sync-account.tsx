import { accountLabel } from './account-label';

export function SyncAccount(input: {
  connection?: { id: string };
  connections?: { id: string; service: string; account: string }[];
}) {
  return input.connection ? (
    <p className="text-sm">
      Account: {accountLabel({ id: input.connection.id, connections: input.connections ?? [] })}
    </p>
  ) : null;
}
