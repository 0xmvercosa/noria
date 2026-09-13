import type { Metadata } from "next";
import { ReserveWorkbench } from "../../components/ReserveWorkbench";

export const metadata: Metadata = {
  title: "Noria × Privy — Your USDC reserve",
  description:
    "Create a Privy wallet, fund it on Arbitrum, supply USDC to Aave and withdraw with a verifiable operation report.",
};
export default function ReservePage() {
  return <ReserveWorkbench />;
}
