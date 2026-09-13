"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { NoriaLogo } from "./NoriaLogo";
import { NoriaWallet } from "./NoriaWallet";
import s from "./NoriaHeader.module.css";

type Page = "discover" | "aqua" | "wallet" | "agent";
const destinations = [
  {
    href: "/",
    label: "Discover pools",
    detail: "The Graph · market research",
    page: "discover",
  },
  {
    href: "/aqua",
    label: "Aqua positions",
    detail: "1inch · launch and manage",
    page: "aqua",
  },
  {
    href: "/reserve",
    label: "Wallet & funds",
    detail: "Privy · balances and transfers",
    page: "wallet",
  },
  {
    href: "/reserve#fund-heading",
    label: "Buy with euros",
    detail: "Privy · EUR onramp",
    page: null,
  },
  {
    href: "/agent",
    label: "For agents",
    detail: "The Graph · AI tools",
    page: "agent",
  },
] as const;
const resources = [
  { href: "/#workspace", label: "Workspace" },
  { href: "/#historical-case", label: "Historical case" },
  { href: "/#agent-toolkit", label: "Agent toolkit" },
  { href: "/aqua/openapi.json", label: "Graph API" },
];

/** Shared navigation keeps every product reachable at every viewport width.
 * Funding links open the existing reviewed flow; navigation never starts a payment.
 */
export function NoriaHeader({
  current,
  context,
}: {
  current: Page;
  context?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const header = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1101px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !header.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
    };
  }, [open]);

  return (
    <header className={s.header} ref={header}>
      <div className={s.topbar}>
        <a href="/" className={s.brand} aria-label="Noria home">
          <NoriaLogo />
        </a>
        <nav className={s.desktopNav} aria-label="Main navigation">
          {destinations.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={item.page === current ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
          <details className={s.more} ref={more}>
            <summary>
              More <ChevronDown size={14} aria-hidden="true" />
            </summary>
            <div className={s.resourceMenu}>
              {resources.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => {
                    if (more.current) more.current.open = false;
                  }}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </details>
        </nav>
        <div
          className={s.walletArea}
          onPointerDownCapture={() => setOpen(false)}
          onFocusCapture={() => setOpen(false)}
        >
          <span className={s.walletLabel}>Privy wallet</span>
          <NoriaWallet />
        </div>
        <button
          className={s.menuButton}
          type="button"
          ref={trigger}
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => {
            if (!open)
              header.current
                ?.querySelectorAll("details[open]")
                .forEach((element) => element.removeAttribute("open"));
            setOpen((value) => !value);
          }}
        >
          {open ? (
            <X size={20} aria-hidden="true" />
          ) : (
            <Menu size={20} aria-hidden="true" />
          )}
          {open ? "Close" : "Menu"}
        </button>
      </div>
      <nav
        className={s.mobileNav}
        id={menuId}
        hidden={!open}
        aria-label="Main navigation"
      >
        <div className={s.destinations}>
          {destinations.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={item.page === current ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </a>
          ))}
        </div>
        <div className={s.resources}>
          {resources.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
        </div>
      </nav>
      {context && <p className={s.context}>{context}</p>}
    </header>
  );
}
