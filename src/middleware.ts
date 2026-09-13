import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "./security/csp";

/** Nonces are created per HTML request; neither visitors nor caches supply them. */
export function middleware(request: NextRequest) {
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );
  const policy = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/", "/aqua", "/reserve", "/agent", "/auth/callback"],
};
