# ETHOnline 2026

Noria is being prepared for **The Graph — Best AI Tooling or AI Use Case with The Graph**, in the **From Scratch** category. Its current deliverable is informational Uniswap v3 discovery for people and external AI agents.

| Review item                         | Evidence or status                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Public repository                   | [github.com/0xmvercosa/noria](https://github.com/0xmvercosa/noria)                                |
| Working scope                       | Full web interface, six MCP tools and a focused Arbitrum WETH/native-USDC reference API           |
| The Graph contribution              | Required pool discovery/history, indexed ticks, source metadata and reusable agent tools          |
| Local reproduction                  | [README](../README.md), [agent setup](agent-setup.md), [validation](validation.md)                |
| Hosted application                  | Vercel builds verified; the final judging domain is to be supplied. Local routes: `/` and `/aqua` |
| Public demo video                   | No URL published                                                                                  |
| Submission and organizer acceptance | Not established by this repository                                                                |
| 1inch integration status            | Reference-selection API implemented; Aqua execution and Aave/accounting remain planned            |

## What judges can inspect

An agent starts from a user's network, capital and objective, discovers candidates through live Graph data, and receives an explainable range or refusal. Noria does more than expose a query: it independently revalues screening inputs, verifies canonical pool state, validates or recovers tick coverage, models inventory and capacity, and keeps economics explicitly unproven.

The reusable part is the [six-tool MCP interface](agent-setup.md). A live external-agent demonstration should show the actual calls and returned source evidence. The server and CLI contain no language model, so a CLI transcript alone does not demonstrate agent reasoning.

The [Graph guide](the-graph.md) maps each indexed input to the resulting behavior. The [architecture](architecture.md) identifies the implementation and its boundaries. No Graph availability, profitability or organizer approval is implied by the targeted category.

## Suggested three-minute demonstration

| Time      | Action                                                                                  | What to explain                                                                           |
| --------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 0:00–0:25 | Show the empty workspace and choose a network, $1,000, fee exposure and six-hour review | The user supplies an objective, not a preselected pool                                    |
| 0:25–1:00 | Run discovery and inspect the actual result                                             | Candidate bounds, token identity, source age and valid refusal reasons                    |
| 1:00–1:40 | Show an external agent calling discovery, then same-session verification                | Live Graph dependency, reusable MCP tools and internal-verification limits                |
| 1:40–2:15 | Analyze the same pool with another supported capital amount or conversion objective     | Required inventory, capacity changes, token1 → token0 semantics and reversible conversion |
| 2:15–2:40 | Open evidence and download the report                                                   | Canonical block, providers, timestamps, expiry and `not-established` economics            |
| 2:40–3:00 | Summarize the working scope and show the roadmap                                        | Aave/Aqua execution remains planned and needs a separate adapter                          |

Show what providers actually return. If discovery refuses a candidate, explain the evidence and try another supported input if useful. A saved response must appear with its original date; it cannot stand in for a current opportunity.

## Historical material and From Scratch review

The optional historical tool reads a dated **26 August 2026 WBTC/WETH simulation**, supplied separately from live analysis. Its [case](../data/examples/historical-case.json) and [ledger](../data/examples/historical-ledger.json) explain the difference between portfolio gains, fees, costs and excess versus holding. It is an explanatory data artifact, not an executed Noria trade or newly observed live result. The compact data does not include a complete market replay.

The project does not present the dated simulation, public dependencies or captured market inputs as newly generated hackathon outcomes. The From Scratch category remains subject to the organizer's current rules and review of implementation dates and disclosed materials; a repository title or targeting statement does not establish eligibility.

The proposed 1inch effort has an implemented [reference-selection handoff](aqua-integration.md) and a separate [execution roadmap](roadmap.md): Aave ETH collateral, bounded USDC borrowing, Aqua liquidity, owner-authorized checkpoints and a 50/50 split of eligible realized net surplus after interest, cost provisions and loss recovery. None of those capital-moving actions is implemented in the current product. The Aqua application starts the combined flow and calls Noria for a reference pool/range; it must supply its own strategy mapping and execution checks.

Official reference: [ETHOnline 2026 prize page](https://ethglobal.com/events/ethonline2026/prizes/#the-graph).
