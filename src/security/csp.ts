/** Trusted browser integrations only. Protocol/Graph RPC calls remain server-side.
 * Privy's official CSP guidance is the baseline; funding adds Stripe and Relay.
 * No wildcard Vercel origins, inline scripts or production eval are permitted.
 */
export function contentSecurityPolicy(
  nonce: string,
  development = false,
): string {
  if (!/^[A-Za-z0-9+/=]+$/.test(nonce)) throw new Error("Invalid CSP nonce");
  const frames = [
    "https://auth.privy.io",
    "https://verify.walletconnect.com",
    "https://verify.walletconnect.org",
    "https://challenges.cloudflare.com",
    "https://js.stripe.com",
    "https://crypto.link",
    "https://hooks.stripe.com",
  ];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    // Privy styled components and Next/CSS modules use inline style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://auth.privy.io",
      "https://images.ctfassets.net",
      "https://explorer-api.walletconnect.com",
      "https://assets.coingecko.com",
    ],
    "font-src": ["'self'", "data:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "child-src": frames,
    "frame-src": frames,
    "connect-src": [
      "'self'",
      "https://auth.privy.io",
      "https://*.rpc.privy.systems",
      "wss://relay.walletconnect.com",
      "wss://relay.walletconnect.org",
      "wss://www.walletlink.org",
      "https://explorer-api.walletconnect.com",
      "https://api.relay.link",
      "https://api.moonpay.com",
      "https://api.stripe.com",
      "https://r.stripe.com",
      "https://m.stripe.network",
      ...(development ? ["ws://127.0.0.1:*", "ws://localhost:*"] : []),
    ],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
