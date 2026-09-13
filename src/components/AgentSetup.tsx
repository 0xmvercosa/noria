"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Copy, Terminal } from "lucide-react";
import s from "./AgentSetup.module.css";
import { NoriaHeader } from "./NoriaHeader";

const examplePrompt =
  "Use Noria to list the configured networks, then find a Uniswap v3 WETH/USDC pool on Arbitrum for $1,000 of fee exposure with a six-hour review. Show the selected token contracts, range, required inventory, capacity, source dates and exclusions. Verify the complete returned report with noria_verify_report. Keep economics: not-established explicit. If no pool qualifies, explain the recorded reasons. Do not sign or submit transactions.";

function CopyText({ label, value }: { label: string; value: string }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copied to clipboard.");
    } catch {
      setStatus("Copy failed. Select and copy the text above.");
    }
  }
  return (
    <div className={s.copyControl}>
      <button type="button" onClick={copy} disabled={!value}>
        <Copy size={14} />
        {label}
      </button>
      <span role="status">{status}</span>
    </div>
  );
}

export function AgentSetup() {
  const [endpoint, setEndpoint] = useState("");
  useEffect(() => {
    setEndpoint(new URL("/api/mcp", window.location.origin).href);
  }, []);

  return (
    <>
      <NoriaHeader current="agent" context="Read-only tools · The Graph" />
      <main className={s.page}>
        <a href="/#agent-toolkit" className={s.back}>
          <ArrowLeft size={15} /> Back to Noria
        </a>
        <header className={s.header}>
          <Terminal size={28} />
          <p>THE GRAPH · SIX READ-ONLY TOOLS</p>
          <h1>Connect your AI agent</h1>
          <div>
            Your agent supplies the model. Noria supplies live pool discovery,
            range analysis and evidence you can inspect.
          </div>
        </header>

        <section className={s.card} aria-labelledby="remote-heading">
          <h2 id="remote-heading">Connect to this deployment</h2>
          <p>
            Add a remote MCP server in a client that supports{" "}
            <strong>Streamable HTTP</strong>. Use this server URL with no
            authentication. The tools cannot access your wallet or submit
            transactions.
          </p>
          <code className={s.endpoint}>
            {endpoint || "Loading this deployment’s endpoint…"}
          </code>
          <CopyText label="Copy endpoint" value={endpoint} />
          <p>
            Allow up to five minutes for live analysis. Provider failures and a
            result with no qualifying pool remain visible.
          </p>
        </section>

        <section className={s.card} aria-labelledby="prompt-heading">
          <h2 id="prompt-heading">Try a complete workflow</h2>
          <p>After connecting, give your agent this prompt.</p>
          <pre className={s.prompt}>{examplePrompt}</pre>
          <CopyText label="Copy prompt" value={examplePrompt} />
          <p>
            For HTTP verification, pass the complete, unmodified report object.
            Its hash checks internal consistency; it does not authenticate the
            source or establish profitability.
          </p>
        </section>

        <section className={s.card} aria-labelledby="local-heading">
          <h2 id="local-heading">Run locally or install the skill</h2>
          <p>
            Clone the repository, run <code>npm ci</code>, then configure your
            MCP client with command <code>npm</code>, arguments{" "}
            <code>--silent run mcp</code>, and the repository root as its
            working directory. Transport: <strong>stdio</strong>.
          </p>
          <p>
            The optional skill teaches your agent how to preserve source
            evidence, compare the same pool and interpret refusals. It uses your
            MCP connection and does not install a model.
          </p>
          <div className={s.links}>
            <a href="/agent/skill">
              Download agent skill <ArrowUpRight size={14} />
            </a>
            <a href="/api/noria?doc=agent">
              Full setup &amp; tool reference <ArrowUpRight size={14} />
            </a>
            <a href="https://github.com/0xmvercosa/noria">
              Repository <ArrowUpRight size={14} />
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
