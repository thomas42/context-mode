import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Database, Brain, History, Search, Building2, HardDrive } from "lucide-react";

import { api, type ContextStore } from "@/lib/api";
import "../styles.css";

const NAV = [
  { to: "/", label: "Dashboard", icon: Database },
  { to: "/knowledge", label: "Knowledge Base", icon: Brain },
  { to: "/sessions", label: "Sessions", icon: History },
  { to: "/search", label: "Search", icon: Search },
  { to: "/enterprise", label: "Enterprise", icon: Building2 },
] as const;

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const [stores, setStores] = useState<ContextStore[]>([]);
  const [selectedStore, setSelectedStore] = useState(() =>
    globalThis.localStorage?.getItem("ctx-insight-store") || "",
  );

  useEffect(() => {
    api.stores().then((data) => {
      setStores(data.stores);
      const selectedStillExists = data.stores.some((store) => store.id === selectedStore);
      if ((!selectedStore || !selectedStillExists) && data.stores[0]) {
        const nextStore = data.stores[0].id;
        setSelectedStore(nextStore);
        globalThis.localStorage?.setItem("ctx-insight-store", nextStore);
      }
    }).catch(() => setStores([]));
  }, []);

  function changeStore(storeId: string) {
    setSelectedStore(storeId);
    globalThis.localStorage?.setItem("ctx-insight-store", storeId);
    globalThis.location.reload();
  }

  return (
    <div className="dark flex min-h-screen bg-background text-foreground">
      <aside className="w-56 border-r border-border bg-card fixed h-screen flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground tracking-wider uppercase">
            Context Mode
          </h1>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            Insight
          </p>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors border-l-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50 [&.active]:border-primary [&.active]:text-primary [&.active]:bg-accent [&.active]:font-medium"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        {stores.length > 0 && (
          <div className="p-4 border-t border-border">
            <label className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
              <HardDrive className="h-3.5 w-3.5" />
              Store
            </label>
            <select
              value={selectedStore}
              onChange={(event) => changeStore(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-2 text-xs text-foreground outline-none"
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.label} ({store.sessionDbs + store.contentDbs})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="p-4 border-t border-border">
          <p className="text-[10px] text-muted-foreground/50">
            Local · Read-only
          </p>
        </div>
      </aside>

      <main className="ml-56 flex-1 p-8 max-w-6xl">
        <Outlet />
      </main>
    </div>
  );
}
