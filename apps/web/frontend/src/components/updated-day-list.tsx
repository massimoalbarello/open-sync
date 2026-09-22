import type { ReactNode } from 'react';

export function UpdatedDayList<T extends { updatedAt?: string }>(input: {
  items: T[];
  label: string;
  itemKey(item: T): string;
  children(item: T): ReactNode;
}) {
  const dayFormat = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const days = new Map<string, T[]>();
  for (const item of input.items) {
    const day = item.updatedAt ? dayFormat.format(new Date(item.updatedAt)) : 'Unknown date';
    const items = days.get(day);
    if (items) {
      items.push(item);
    } else {
      days.set(day, [item]);
    }
  }
  return (
    <div className="space-y-8">
      {[...days].map(([day, items]) => (
        <section key={day} aria-label={day}>
          <h2 className="border-border border-b pb-3 font-medium text-sm">{day}</h2>
          <ul aria-label={input.label} className="divide-y divide-border">
            {items.map((item) => (
              <li key={input.itemKey(item)} className="flex items-start gap-4 py-4">
                <div className="min-w-0 flex-1">{input.children(item)}</div>
                {item.updatedAt && (
                  <time
                    dateTime={new Date(item.updatedAt).toISOString()}
                    title={`Updated ${new Date(item.updatedAt).toLocaleString()}`}
                    className="shrink-0 text-muted-foreground text-xs tabular-nums"
                  >
                    {timeFormat.format(new Date(item.updatedAt))}
                  </time>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
