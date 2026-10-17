/** Normalises a code typed by the user ("123 456" -> "123456"). */
export function normalizeCode(code: string): string {
  return code.replace(/\D/g, "").slice(0, 6);
}
