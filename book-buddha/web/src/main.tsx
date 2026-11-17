import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App.js";
import { AuthGate } from "./AuthGate.js";

// The API refuses every financial route without a session, so the page is only
// mounted once someone has signed in.
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
);
