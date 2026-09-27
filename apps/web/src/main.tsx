import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import PwaStatus from "./PwaStatus";
import { registerServiceWorker, trackVisualViewport } from "./lib/pwa";
import "./styles.css";
import "./decor.css";
import "./pwa.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <PwaStatus />
    </QueryClientProvider>
  </React.StrictMode>
);

registerServiceWorker();
trackVisualViewport();
