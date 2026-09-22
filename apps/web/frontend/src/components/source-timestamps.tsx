export function SourceTimestamps(input: { createdAt?: string; updatedAt?: string }) {
  if (!input.createdAt && !input.updatedAt) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
      {input.createdAt && <SourceTime label="Created" value={input.createdAt} />}
      {input.updatedAt && <SourceTime label="Updated" value={input.updatedAt} />}
    </span>
  );
}

function SourceTime(input: { label: string; value: string }) {
  const date = new Date(input.value);
  return (
    <span>
      {input.label}{' '}
      <time dateTime={date.toISOString()} title={date.toLocaleString()}>
        {date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
      </time>
    </span>
  );
}
