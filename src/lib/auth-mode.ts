export function isAuthBypassEnabled() {
  return (
    process.env.NEXT_PUBLIC_BYPASS_AUTH === "1" &&
    process.env.NODE_ENV !== "production"
  );
}
