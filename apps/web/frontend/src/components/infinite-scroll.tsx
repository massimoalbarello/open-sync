import { Button } from '@repo/ui/button';
import { useEffect, useRef } from 'react';

export function InfiniteScroll(input: {
  hasMore: boolean;
  fetching: boolean;
  error: Error | null;
  onLoad(): void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !input.hasMore || input.fetching || input.error) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          input.onLoad();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [input.hasMore, input.fetching, input.error, input.onLoad]);
  if (!input.hasMore) {
    return null;
  }
  return (
    <div ref={sentinel} className="flex justify-center py-8">
      <Button variant="ghost" disabled={input.fetching} onClick={input.onLoad}>
        {input.fetching ? 'Loading…' : input.error ? 'Try loading more again' : 'Load more'}
      </Button>
    </div>
  );
}
