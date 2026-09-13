import { createReserveHandlers } from "../../../../../integrations/privy/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const { GET, POST } = createReserveHandlers();
