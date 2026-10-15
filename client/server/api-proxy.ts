import type { ProxyOptions } from "vite";

// Executado somente pelo processo Node do Vite; nunca importado pelo React.
export function createApiProxy(
  target: string,
  key: string,
): Record<string, ProxyOptions> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error(
      "Configure STAYPULSE_API_URL em client/.env com uma URL HTTP(S).",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "STAYPULSE_API_URL deve ser uma URL HTTP(S) sem credenciais, query ou fragmento.",
    );
  }
  if (key.length < 16 || /[\r\n]/.test(key)) {
    throw new Error(
      "Configure STAYPULSE_API_KEY em client/.env com a mesma API_KEY do backend (mínimo 16 caracteres).",
    );
  }
  return {
    "^/api(?:/|$)": {
      target: url.toString().replace(/\/$/, ""),
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ""),
      headers: { "X-API-Key": key },
      // O proxy autenticado é local. Não aceite chamadas de páginas de outra origem.
      bypass(req) {
        if (req.headers["sec-fetch-site"] === "cross-site") return false;
        const origin = req.headers.origin;
        if (origin) {
          try {
            if (new URL(origin).host !== req.headers.host) return false;
          } catch {
            return false;
          }
        }
      },
    },
  };
}
