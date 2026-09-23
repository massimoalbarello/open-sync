import { cn } from '@repo/ui/class-names';
import logoUrl from '../../assets/open-sync.svg';

export function OpenSyncLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-8 shrink-0 bg-current', className)}
      style={{ mask: `url("${logoUrl}") center / contain no-repeat` }}
    />
  );
}
