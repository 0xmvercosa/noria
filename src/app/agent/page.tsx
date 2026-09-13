import type { Metadata } from "next";
import { AgentSetup } from "../../components/AgentSetup";

export const metadata: Metadata = {
  title: "Connect your AI agent · Noria",
  description:
    "Connect to Noria’s read-only MCP tools for The Graph-backed liquidity discovery and position analysis.",
};

export default function AgentPage() {
  return <AgentSetup />;
}
