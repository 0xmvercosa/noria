# Responsive product navigation

Every product page uses the same navigation: **Discover pools** (The Graph), **Aqua positions** (1inch), **Wallet & funds** (Privy), **Buy with euros** (Privy EUR funding) and **For agents**. Workspace, historical evidence, agent toolkit and Graph API remain available under More on desktop and within the mobile menu.

At widths up to 1,100 CSS pixels, a labeled Menu button opens the full list. On phones up to 520 pixels, the wallet remains visible in its own header row. Navigation stays in the page's normal scroll flow, including landscape screens. Opening the wallet closes navigation before the SDK opens its own interface.

Wallet settings have an explicit close control, Escape support with focus restoration, and outside-click dismissal. On phones the panel is constrained to the viewport with internal scrolling. Dismissing an initialization error leaves Retry wallet connection available in the header. These controls do not alter balances, clear saved operations or initiate funding.

Financial forms use single-column layouts on narrow screens, touch targets of at least 44 pixels and 16-pixel input text on small or coarse-pointer devices. Addresses and displayed balances wrap; editable financial values retain their exact precision. Checkout remains the supported Privy interface rather than a custom payment form.

## Integration map

| Responsibility                                                   | Source                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Destinations, current page, keyboard behavior, responsive header | [NoriaHeader](../src/components/NoriaHeader.tsx), [styles](../src/components/NoriaHeader.module.css)                                                                                                         |
| Connected wallet, dismissible settings and recovery              | [NoriaWallet](../src/components/NoriaWallet.tsx)                                                                                                                                                             |
| Graph, Aqua, wallet and agent entry points                       | [NoriaApp](../src/components/NoriaApp.tsx), [AquaWorkbench](../src/components/AquaWorkbench.tsx), [ReserveWorkbench](../src/components/ReserveWorkbench.tsx), [AgentSetup](../src/components/AgentSetup.tsx) |
| EUR amount and checkout handoff                                  | [ReserveWorkbench](../src/components/ReserveWorkbench.tsx), [Privy provider](../src/components/NoriaWalletProvider.tsx), [EUR options](../src/integrations/privy/fiat.ts)                                    |
| Form, panel, amount and receipt layout                           | [Aqua styles](../src/components/AquaWorkbench.module.css), [wallet styles](../src/components/ReserveWorkbench.module.css), [input styles](../src/components/FinancialInput.module.css)                       |
| Navigation and actual unauthenticated Privy dialog checks        | [mobile browser scenarios](../tests/browser/mobile-navigation.spec.ts)                                                                                                                                       |
| Populated plan layout and error recovery                         | [Aqua scenarios](../tests/browser/aqua.spec.ts), [wallet journey scenarios](../tests/browser/wallet-journey.spec.ts)                                                                                         |

## Validation scope

Local validation on September 13, 2026: **173 unit tests passed**, **44 configured browser scenarios passed** and two scenarios requiring an unconfigured Privy deployment were skipped. Production build, TypeScript validation, formatting and runtime-asset tracing passed. CI separately runs the browser suite without a public Privy App ID.

The browser suite checks all four pages at 320, 375, 390, 768, 1,100, 1,101 and 1,440 pixels, including every destination, current-page indication, horizontal overflow, keyboard dismissal, orientation changes and the EUR funding anchor. Populated Aqua fixtures check long inventory values and downloadable source evidence at phone and tablet widths.

With a public Privy App ID, the actual SDK login is checked at 375 × 667: email, Google, external wallet and close controls must fit the viewport. Its mobile dialog wrapper has zero height around fixed-position children, so tests inspect the visible controls rather than the wrapper's dimensions.

Connected-state layout was additionally checked in an isolated browser harness using the real components with a synthetic wallet provider and synthetic balances. It exercises settings dismissal, focus restoration, EUR precision and the checkout handoff without credentials, signing or a payment provider. This is presentation evidence, not proof of a live purchase or settlement. The responsive work does not change the acceptance boundaries in [Privy validation](privy/validation.md) or [Aqua live launch](1inch/live-launch.md).

Independent review identified and resolved wallet-sheet dismissal, agent-page spacing and recovery after closing an initialization error. The connected-state check also caught an immediate-Escape timing race in native details toggling; dismissal now reads the actual open state.

Use the stable deployment at [noria-blue.vercel.app](https://noria-blue.vercel.app). Earlier immutable Vercel preview URLs do not receive later releases.
