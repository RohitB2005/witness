// Tiny fetch wrapper: JSON in, JSON out, errors carry the server's plain-language message.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export const GENERIC_ERROR = "Something went wrong. Please try again.";

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, GENERIC_ERROR);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
  if (!res.ok) {
    const message = res.status >= 500 || !data.error ? GENERIC_ERROR : data.error;
    throw new ApiError(res.status, message, data.field);
  }
  return data as T;
}
