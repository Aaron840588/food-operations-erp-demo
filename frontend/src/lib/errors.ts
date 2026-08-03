/** Returns a safe, user-facing message from an unknown thrown value. */
export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const errObj = error as Record<string, unknown>;
    if (typeof errObj.message === "string" && errObj.message.trim()) {
      return errObj.message;
    }
    if (typeof errObj.detail === "string" && errObj.detail.trim()) {
      return errObj.detail;
    }
  }
  return fallback;
}
