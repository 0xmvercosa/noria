import type { Metadata } from "next";
import { AquaWorkbench } from "../../components/AquaWorkbench";

export const metadata: Metadata = {
  title: "Noria × Aqua — Arbitrum reference strategy",
  description:
    "Find a WETH/native-USDC reference pool and range on Arbitrum, with an inspectable handoff for an Aqua execution system.",
};

export default function AquaPage() {
  return <AquaWorkbench />;
}
