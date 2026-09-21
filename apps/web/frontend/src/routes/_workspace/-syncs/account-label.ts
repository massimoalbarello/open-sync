type Connection = { id: string; service: string; account: string };

export function accountLabel(input: { id: string; connections: Connection[] }): string {
  const connection = input.connections.find((entry) => entry.id === input.id);
  if (!connection) {
    return 'Account unavailable';
  }
  const ambiguous = input.connections.some(
    (entry) =>
      entry.id !== connection.id &&
      entry.service === connection.service &&
      entry.account === connection.account,
  );
  const disambiguatorLength = 8;
  return ambiguous
    ? `${connection.account} · ${connection.id.slice(-disambiguatorLength)}`
    : connection.account;
}
