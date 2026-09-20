import { useState } from 'react';

export function ProviderIcon(input: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted font-medium text-muted-foreground"
      aria-hidden="true"
    >
      {input.url && !failed ? (
        <img
          src={input.url}
          alt=""
          width={24}
          height={24}
          className="size-6 object-contain"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        input.name.slice(0, 1)
      )}
    </span>
  );
}
