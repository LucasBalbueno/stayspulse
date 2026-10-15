import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Api } from "./api";
interface Connection {
  api: Api;
  url: string;
}
const Context = createContext<Connection | null>(null);
export function ConnectionProvider({ children }: { children: ReactNode }) {
  // O navegador só conhece o proxy de mesma origem. A chave não chega ao React.
  const value = useMemo(() => ({ api: new Api("/api"), url: "/api" }), []);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useConnection() {
  return useContext(Context)!;
}
