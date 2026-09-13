import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  analyze,
  historicalCase,
  HistoryDataError,
} from "../../../services/analysis";
import { discover, searchPools } from "../../../services/discovery";
import { networkOptions } from "../../../config/networks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

function errorResponse(error: unknown) {
  const details = error as {
    name?: string;
    shortMessage?: string;
    message?: string;
  };
  const message = (
    details?.shortMessage ??
    details?.message ??
    "Analysis unavailable"
  )
    .replace(/https?:\/\/[^\s"<>]+/g, "[provider]")
    .slice(0, 600);
  return NextResponse.json(
    {
      error: message,
      status: "data-insufficient",
      ...(error instanceof HistoryDataError ? { code: error.code } : {}),
    },
    {
      status:
        details?.name === "ZodError" || error instanceof SyntaxError
          ? 400
          : error instanceof HistoryDataError
            ? 422
            : 503,
      headers: noStore,
    },
  );
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("view") === "networks")
      return NextResponse.json(
        { networks: networkOptions() },
        { headers: noStore },
      );
    if (params.get("view") === "pools")
      return NextResponse.json(
        await searchPools(params.get("network"), params.get("q") ?? ""),
        { headers: noStore },
      );
    if (params.get("doc") === "agent") {
      return new Response(
        await readFile(path.join(process.cwd(), "docs/agent-setup.md"), "utf8"),
        {
          headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }
    return NextResponse.json(await historicalCase(), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 4096) {
      return NextResponse.json(
        { error: "Request is too large." },
        { status: 413, headers: noStore },
      );
    }
    return NextResponse.json(
      await (new URL(request.url).searchParams.get("view") === "discover"
        ? discover(JSON.parse(text))
        : analyze(JSON.parse(text))),
      { headers: noStore },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
