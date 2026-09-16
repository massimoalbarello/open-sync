import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { cn } from '../../lib/class-names';

export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded border border-input outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="size-3"
          aria-hidden="true"
        >
          <path d="m3 8 3 3 7-7" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
