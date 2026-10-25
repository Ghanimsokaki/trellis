import { NimError } from "./nim";

export function jsonError(error: unknown, fallbackStatus = 500): Response {
  if (error instanceof NimError) {
    return Response.json(error.toJSON(), { status: error.status >= 400 && error.status < 600 ? error.status : 500 });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json(
    {
      error: message,
      code: "unexpected",
      status: fallbackStatus,
      hint: "Check the server logs, then retry.",
      requestId: null,
      detail: null,
    },
    { status: fallbackStatus },
  );
}

export function validationError(message: string, hint?: string): Response {
  return Response.json(
    { error: message, code: "invalid_request", status: 400, hint: hint ?? null, requestId: null, detail: null },
    { status: 400 },
  );
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new NimError("Request body must be valid JSON.", { status: 400, code: "invalid_json" });
  }
}
