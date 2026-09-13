"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Database,
  Fingerprint,
  Globe2,
  Layers,
  Terminal,
} from "lucide-react";
import { HistoricalStudy } from "./HistoricalStudy";
import { NoriaLogo } from "./NoriaLogo";
import { WorkspaceControls } from "./WorkspaceControls";
import { WorkspaceResults } from "./WorkspaceResults";
import { GraphMark } from "./ui";
import { useNoriaWorkspace } from "./useNoriaWorkspace";
import s from "./NoriaApp.module.css";

export default function NoriaApp() {
  const workspace = useNoriaWorkspace();
  const {
    networkLabel,
    historical,
    historyLoading,
    historyError,
    retryHistory,
  } = workspace;
  return (
    <div className={s.app}>
      <header className={s.header}>
        <a href="/" className={s.brand} aria-label="Noria home">
          <NoriaLogo className={s.brandLogo} />
        </a>
        <nav className={s.navigation} aria-label="Workspace navigation">
          <a href="#workspace" className={s.activeNav}>
            Workspace
          </a>
          <a href="#historical-case">Historical case</a>
          <a href="/aqua">Aqua handoff</a>
          <a href="#agent-toolkit">
            For agents <ArrowUpRight size={12} />
          </a>
        </nav>
        <span className={s.chainBadge}>
          <Globe2 size={13} />
          {networkLabel}
        </span>
      </header>

      <main className={s.main}>
        <section className={s.hero}>
          <div>
            <div className={s.productStage}>
              <span>
                <i className={s.limeDot} />
                Noria Discover
              </span>
              <span>The Graph · live discovery</span>
            </div>
            <h1>
              An LP decision
              <br />
              you can <span>inspect.</span>
            </h1>
            <p>
              Turn your capital and intent into an explainable Uniswap v3
              position.
              <br className={s.desktopBreak} />
              Real pool data. Explicit assumptions. Sources you can trace.
            </p>
          </div>
          <div className={s.heroAside}>
            <div className={s.builtWith}>
              <GraphMark />
              <span>
                Powered by
                <br />
                <strong>The Graph</strong>
              </span>
            </div>
            <div className={s.proofFlow}>
              <span>
                <Database size={14} />
                Source
              </span>
              <ArrowRight size={12} />
              <span>
                <Layers size={14} />
                Model
              </span>
              <ArrowRight size={12} />
              <span>
                <Fingerprint size={14} />
                Inspect
              </span>
            </div>
            <p>Onchain context → inspectable position analysis</p>
          </div>
        </section>

        <div className={s.workspace} id="workspace">
          <WorkspaceControls workspace={workspace} />

          <WorkspaceResults workspace={workspace} />
        </div>

        <HistoricalStudy
          historical={historical}
          loading={historyLoading}
          error={historyError}
          retry={retryHistory}
        />

        <section
          className={s.agentSection}
          id="agent-toolkit"
          aria-labelledby="agent-heading"
        >
          <div className={s.agentIcon}>
            <Terminal size={23} />
          </div>
          <div className={s.agentCopy}>
            <span className={s.miniEyebrow}>SAME DATA. YOUR OWN WORKFLOW.</span>
            <h2 id="agent-heading">Use with your AI agent.</h2>
            <p>
              Connect to this site's six read-only MCP tools. Your agent can
              inspect the pool, compare intentions, and explain the evidence in
              your own workflow.
            </p>
            <code>Streamable HTTP · /api/mcp</code>
          </div>
          <a className={s.agentLink} href="/agent">
            Open agent setup <ArrowUpRight size={17} />
          </a>
        </section>

        <section
          className={s.roadmapNote}
          id="roadmap"
          aria-label="Product roadmap"
        >
          <span>Planned next</span>
          <p>
            Aave borrowing and 1inch Aqua execution are planned. Noria Discover
            currently provides read-only discovery and position analysis.
          </p>
        </section>

        <footer className={s.footer}>
          <a className={s.footerBrand} href="/">
            noria<span>↗</span>
          </a>
          <p>Read-only insights. Inspectable decisions.</p>
          <span>Pool discovery · Uniswap v3 · The Graph</span>
        </footer>
      </main>
    </div>
  );
}
