import { Select as SelectPrimitive } from '@base-ui/react/select';

export function Select(input: {
  id?: string;
  value: string;
  onValueChange(value: string): void;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <SelectPrimitive.Root
      value={input.value || null}
      onValueChange={(value) => input.onValueChange(value ?? '')}
      items={input.options}
      disabled={input.disabled}
    >
      <SelectPrimitive.Trigger
        id={input.id}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <SelectPrimitive.Value placeholder={input.placeholder ?? 'Select…'} />
        <SelectPrimitive.Icon aria-hidden="true">⌄</SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={4} className="z-50">
          <SelectPrimitive.Popup className="max-h-80 min-w-[var(--anchor-width)] overflow-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <SelectPrimitive.List>
              {input.options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="cursor-default rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
