import { NextResponse, type NextRequest } from "next/server";
import { serverDb } from "@/lib/server";
export async function GET(req: NextRequest) {
  const token_hash = req.nextUrl.searchParams.get("token_hash"),
    type = req.nextUrl.searchParams.get("type");
  if (token_hash && (type === "invite" || type === "recovery")) {
    const { error } = await (
      await serverDb()
    ).auth.verifyOtp({ token_hash, type });
    if (!error) return NextResponse.redirect(new URL("/acesso", req.url));
  }
  return NextResponse.redirect(new URL("/acesso?expirado=1", req.url));
}
