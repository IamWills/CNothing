export type ConsoleConnection = {
  baseUrl: string;
};

export function sameOriginConnection(): ConsoleConnection {
  return {
    baseUrl: typeof window === "undefined" ? "" : window.location.origin,
  };
}
