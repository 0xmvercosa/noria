import { createLocalRehearsalHandlers } from "../../../../../integrations/aqua/local-rehearsal";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createLocalRehearsalHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
