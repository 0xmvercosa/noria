# Privy browser security

Noria uses Privy's React SDK with visible, cancellable transaction confirmations. There is no application server wallet, delegated signer, app secret or private key. Financial APIs read, simulate and verify fixed recipes; they never broadcast transactions.

## Exact application configuration

Configure the public App ID and these exact URLs in the Privy dashboard:

- Allowed origin: `https://noria-blue.vercel.app`.
- Allowed OAuth redirect: `https://noria-blue.vercel.app/auth/callback`.
- Login methods: Google, email and external wallet. Frontend configuration creates an Ethereum embedded wallet for all authenticated users.

`https://vercel.app` does not authorize its subdomains. Do not allow every Vercel application with a wildcard. Configure development clients/origins deliberately; old preview URLs have distinct origins and browser histories.

The callback accepts only relative `/`, `/aqua` and `/reserve` paths. A valid collateral amount is the only retained query parameter. OAuth codes, state values and arbitrary destinations are discarded. Planner storage contains input, never live evidence or authorization. Receipts retain their owner-scoped history and recovery controls.

No paid plan, card onboarding, gas sponsorship or commercial-only feature is required. Google works in supported browsers; embedded-browser users can use email or open the stable site in a supported browser. The experimental embedded-browser OAuth bypass is not enabled.

## Content Security Policy

[middleware.ts](../../src/middleware.ts) generates a random 128-bit nonce per application HTML request and replaces incoming nonce/CSP headers. The root layout passes it to Privy's `scriptNonce`, including Turnstile support. HTML is dynamic and `private, no-store`: static HTML caching would reuse nonces.

[csp.ts](../../src/security/csp.ts) uses `default-src 'self'`, nonce-based scripts with `strict-dynamic`, `object-src 'none'` and `frame-ancestors 'none'`. Production scripts have neither `unsafe-inline` nor `unsafe-eval`. Development-only eval supports Next's development runtime. Inline styles are retained for Privy styled components and UI style attributes; this does not allow inline scripts.

| Integration allowlist                                    | Purpose                                     |
| -------------------------------------------------------- | ------------------------------------------- |
| `auth.privy.io`, `*.rpc.privy.systems`                   | Authentication, wallet iframe and Privy RPC |
| WalletConnect verification/relay/explorer and WalletLink | External-wallet connections                 |
| `challenges.cloudflare.com`                              | Turnstile iframe/script                     |
| `api.relay.link`                                         | External-wallet funding                     |
| Stripe/Link and MoonPay endpoints listed in source       | Checkout resources for pinned SDK 3.42.0    |
| Explicit image origins and `data:`/`blob:` images        | Wallet/token icons and local UI assets      |

Graph and protocol RPC calls run server-side. No blanket HTTPS source, wildcard Vercel origin or user-selected RPC is allowed. `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options` apply globally. Provider iframes govern their internal checkout resources with their own policy.

## Validation and limits

Unit tests cover nonce validation, open redirects, sensitive callback parameters and draft-only restoration. Browser tests verify per-request nonces, nonced Next scripts, hydration, blocked parser-inserted scripts, draft return and initialization recovery. Test actual login and funding after SDK/CSP upgrades; fixtures do not establish provider availability or settlement.

The exact stable origin was corrected in the authorized dashboard session. HttpOnly-cookie isolation requires a separately configured base domain and has not been enabled. Account MFA/session policy and provider KYC remain separate configuration. No claim of completing every dashboard recommendation is made.

Official references: [CSP guidance](https://docs.privy.io/security/implementation-guide/content-security-policy), [security checklist](https://docs.privy.io/security/implementation-guide/security-checklist). See [setup](setup.md) for financial behavior and configuration.
