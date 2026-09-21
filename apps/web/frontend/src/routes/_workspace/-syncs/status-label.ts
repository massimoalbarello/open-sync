export function statusLabel(state: string): string {
  const labels: Record<string, string> = {
    succeeded: 'Completed',
    syncing: 'Syncing',
    running: 'Syncing',
    yielded: 'Continuing from checkpoint',
    waiting_for_capacity: 'Waiting for delivery',
    retrying: 'Retrying',
    ready: 'Scheduled',
    disabled: 'Paused',
    paused: 'Paused',
    interrupted: 'Interrupted',
    lease_expired: 'Worker interrupted',
    timed_out: 'Timed out',
    cancelled: 'Cancelled',
  };
  return labels[state] ?? state.replaceAll('_', ' ');
}
