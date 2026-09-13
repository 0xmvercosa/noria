# The Graph integration

Noria targets **Best AI Tooling or AI Use Case with The Graph** at ETHOnline 2026. Its contribution is an evidence-producing tool layer for external AI agents: live indexed observations become candidate screening, canonical checks, modeled inventory and a range with explicit limits.

## Data that changes the result

| Graph data                                                          | Noria behavior                                                           | If unavailable or invalid                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Pool identities, liquidity, token balances and hourly token volumes | Discover pools and independently revalue screening inputs                | Exclude candidates or report the provider failure                                               |
| 168 consecutive completed hourly price observations                 | Construct the historical fee-exposure range and validate analysis inputs | Refuse incomplete history; do not interpolate a passing result                                  |
| Initialized ticks and liquidity changes                             | Reconstruct competing liquidity across the proposed range                | Attempt a bounded canonical RPC bitmap recovery; refuse if it cannot verify the required window |
| `_meta` deployment, indexing status and block identity              | Pin queries and report reproducible source context                       | Reject invalid, inconsistent or stale evidence                                                  |

RPC verifies selected-network identity and canonical state. USD providers revalue balances and validate relative prices. These checks supplement indexed data; they do not replace the Graph discovery and history dependency. Removing Graph access prevents current live discovery and full analysis.

## Transport

The default route uses the official MCP TypeScript SDK to connect to The Graph Subgraph MCP at `https://subgraphs.mcp.thegraph.com/sse` and call `execute_query_by_subgraph_id`. A server-side `GRAPH_API_KEY` selects The Graph gateway instead, with bearer authentication. Both routes execute the same subgraph queries.

| Network  | Chain ID | Configured subgraph ID                         |
| -------- | -------: | ---------------------------------------------- |
| Ethereum |        1 | `2SNYtSof7BDC8aCfPy85JZ9Mrh8vYTVecYkeNNtcmQXN` |
| Base     |     8453 | `GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz` |
| Arbitrum |    42161 | `FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM` |
| Unichain |      130 | `57u1SNex2eyQULFpmSfzcpN87Yp3Q7cJeNKNWLAonSNn` |

The registry lists configured support, not live availability. Provider timeouts, rate limits, indexing lag and data gaps remain visible outcomes. The Graph adapter bounds requests and retries transient failures; it does not substitute saved fixtures for live responses.

## Two MCP layers

An external AI client calls Noria's six domain tools. Noria in turn calls The Graph's data tool during live work. The layers serve different purposes:

```text
AI client → noria_find_opportunity → discovery and analysis
                                     → Graph execute_query_by_subgraph_id
                                     → canonical RPC and USD references
          ← structured result, evidence and exclusions
```

Noria's server contains no language model. The AI use case comes from an external agent selecting tools, comparing actual results and explaining the evidence to a user. The command-line tool client demonstrates the protocol, not an AI reasoning session.

The MCP tools are independently reusable without the web interface. [Agent setup](agent-setup.md) provides commands, inputs and an example workflow. [Architecture](architecture.md) describes the bounded search, canonical tick recovery and integrity limits. The [Aqua reference endpoint](aqua-integration.md) reuses this Graph-first pipeline for exact Arbitrum WETH/native-USDC selection; it does not replace Graph data with an Aqua pool or claim an execution integration.

## Review the integration

Inspect [the Graph adapter](../src/providers/graph.ts), [discovery](../src/services/discovery.ts), [snapshot collection](../src/providers/snapshot.ts) and [report construction](../src/domain/report.ts). In a fresh live report, inspect its provider, subgraph/deployment, source block and timestamps, then compare data validity, capacity and the unchanged `not-established` economics status. If discovery returns no report, inspect the actual exclusions.

Useful references:

- [ETHOnline 2026 prize page](https://ethglobal.com/events/ethonline2026/prizes/#the-graph)
- [The Graph Subgraph MCP documentation](https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/)
- [The Graph Subgraph skills](https://github.com/graphprotocol/subgraphs-skills)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Uniswap v3 SDK](https://docs.uniswap.org/sdk/v3/overview)

Track targeting describes project intent. Submission and acceptance are tracked separately in the [hackathon guide](hackathon.md).
