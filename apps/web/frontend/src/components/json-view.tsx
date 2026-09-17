export function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-mono text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
