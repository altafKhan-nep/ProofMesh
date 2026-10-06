/** Shorten a long base58 address/id for display: `ABC…XYZ` preserving N head/tail. */
export function shortAddress(id: string, head = 6, tail = 4): string {
  if (!id) return '';
  const seg = head + tail;
  if (id.length <= seg + 3) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}