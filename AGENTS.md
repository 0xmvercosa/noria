# Working on Noria

- Keep code, documentation, UI copy, commits and pull requests in English.
- Noria combines informational discovery for The Graph track with a separate Arbitrum Aqua/Aave implementation for the 1inch track and a Privy wallet reserve flow. Preserve the distinction between source verification, position capacity and economic merit.
- Keep isolated-fork evidence distinct from actual Privy wallet actions. The wallet supports user-confirmed funding, transfers and Aave reserve operations on Arbitrum. The Aqua launch frontend must prepare the complete owner-confirmed position lifecycle against verified deployments; pending deployment configuration must be explicit and must never fall back to fixtures. Implementing this flow does not authorize the agent to sign or spend the user's funds. Do not claim production deployment, aggregator admission or profitable demand from local related-party fills.
- Never publish credentials, private keys, local absolute paths, private research archives or unrelated project history.
- Preserve source timestamps. Do not fabricate quotes, fills, fees, confidence values or profitable outcomes.
- Do not relax financial invariants to make a candidate pass. Explain legitimate refusals.
- Keep changes scoped to your assigned files. Other contributors may be working concurrently; do not revert their work.
- Use small commits and focused pull requests. Run the checks appropriate to the change and document review findings before merging.
