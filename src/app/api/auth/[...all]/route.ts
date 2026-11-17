import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/auth/auth";

// No `runtime` export: with Cache Components enabled, Node.js is the only runtime.
export const GET = (req: Request) => toNextJsHandler(getAuth()).GET(req);
export const POST = (req: Request) => toNextJsHandler(getAuth()).POST(req);
