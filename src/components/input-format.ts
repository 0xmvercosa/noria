/** Input amounts stay strings throughout. Formatting never rounds or caps funds. */
export function normalizeAmountInput(
  text: string,
  fullReplacement = true,
): string {
  const value = text.trim();
  let canonical = value;
  if (fullReplacement && /^\d{1,3}(,\d{3})+\.\d*$/.test(value)) {
    // Unambiguous English grouping, including a visible decimal point.
    canonical = value.replaceAll(",", "");
  } else if (fullReplacement && /^\d{1,3}(\.\d{3})+,\d+$/.test(value)) {
    canonical = value.replaceAll(".", "").replace(",", ".");
  } else if (fullReplacement && /^\d{1,3}(,\d{3}){2,}$/.test(value)) {
    canonical = value.replaceAll(",", "");
  } else if (fullReplacement && /^\d{1,3}(\.\d{3}){2,}$/.test(value)) {
    canonical = value.replaceAll(".", "");
  } else if (
    fullReplacement &&
    /^\d*,\d*$/.test(value) &&
    !/^\d+,\d{3}$/.test(value)
  ) {
    canonical = value.replace(",", ".");
  }
  // A lone comma with three following digits has two plausible meanings.
  // Keep it (and all malformed input) invalid instead of guessing an amount.
  if (!/^\d*(\.\d*)?$/.test(canonical)) return value;
  if (canonical.startsWith(".")) canonical = `0${canonical}`;
  return canonical.replace(/^0+(?=\d)/, "");
}

export function amountInputError(
  value: string,
  decimals: number,
): string | null {
  if (!value) return null;
  if (/^\d+,\d{3}$/.test(value))
    return "Ambiguous separator. Use 1234 for a whole amount or 1.234 for decimals.";
  if (!/^\d+(\.\d*)?$/.test(value))
    return "Use digits and a decimal point, for example 1234.56. Signs and exponent notation are not supported.";
  if (decimals === 0 && value.includes("."))
    return "Enter a whole number of basis points.";
  if ((value.split(".")[1]?.length ?? 0) > decimals)
    return `Use at most ${decimals} decimal places. The amount has not been rounded.`;
  return null;
}

/** Group only the whole portion, preserving every fractional digit and trailing zero. */
export function formatAmountInput(value: string, decimals: number): string {
  if (amountInputError(value, decimals)) return value;
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Addresses and hashes are opaque: preserve case, prefix, length and internal text. */
export function normalizeIdentifierInput(value: string): string {
  return value.trim();
}
