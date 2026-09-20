/** A named segment matches one encoded identifier, never a path or traversal. */
export function matchesProviderPath(input: { path: string; allowed?: readonly string[] }): boolean {
  const segments = input.path.split('/');
  return (
    input.allowed?.some((pattern) => {
      const expected = pattern.split('/');
      return (
        expected.length === segments.length &&
        // biome-ignore lint/complexity/useMaxParams: Array.every supplies the segment index.
        expected.every((segment, index) => {
          const value = segments[index]!;
          if (!segment.startsWith(':')) {
            return segment === value;
          }
          try {
            const decoded = decodeURIComponent(value);
            return Boolean(decoded) && !['.', '..'].includes(decoded) && !/[\\/?#%]/.test(decoded);
          } catch {
            return false;
          }
        })
      );
    }) ?? false
  );
}
