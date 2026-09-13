const returnKey = "noria.auth.return.v1";

/** Never turn OAuth completion into an open redirect, or retain OAuth codes in storage. */
export function safeWalletReturn(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return "/reserve";
  try {
    const url = new URL(value, "https://noria.invalid");
    if (
      url.origin !== "https://noria.invalid" ||
      !["/", "/aqua", "/reserve"].includes(url.pathname)
    )
      return "/reserve";
    const amount = url.searchParams.get("collateralUSDC");
    return url.pathname === "/aqua" &&
      amount &&
      /^\d{1,12}(\.\d{1,6})?$/.test(amount)
      ? `/aqua?collateralUSDC=${amount}`
      : url.pathname;
  } catch {
    return "/reserve";
  }
}

export function rememberWalletReturn() {
  try {
    sessionStorage.setItem(
      returnKey,
      safeWalletReturn(window.location.pathname + window.location.search),
    );
  } catch {
    /* Login still works when browser storage is unavailable. */
  }
}

export function consumeWalletReturn(): string {
  try {
    const path = safeWalletReturn(sessionStorage.getItem(returnKey));
    sessionStorage.removeItem(returnKey);
    return path;
  } catch {
    return "/reserve";
  }
}
