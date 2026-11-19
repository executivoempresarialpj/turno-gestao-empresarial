import type { Instrumentation } from "next";

// Log only the route template and framework digest. Paths and submitted fields
// may contain personal data or a private reservation token.
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  _request,
  context,
) => {
  console.error(
    JSON.stringify({
      event: "request_error",
      route: context.routePath,
      router: context.routerKind,
      digest: error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null,
    }),
  );
};
