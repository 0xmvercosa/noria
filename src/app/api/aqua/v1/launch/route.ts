import { createLaunchHandlers } from "../../../../../integrations/aqua/launch-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const handlers = createLaunchHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
