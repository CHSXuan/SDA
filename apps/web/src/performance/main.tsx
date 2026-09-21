import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./performance.css";

// Theme is pushed by the desktop shell (performance-preload sets data-theme);
// default to the OS-independent dark palette just like the main window does.
try {
  document.documentElement.dataset.theme = localStorage.getItem("sda-theme") === "light" ? "light" : "dark";
} catch { /* Keep the default theme when storage is unavailable. */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
