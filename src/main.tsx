import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./embedded-module.css";

const embedded = window.self !== window.top;

if (embedded) {
  // The hub is a top-level application shell. If a child system ever sends an
  // iframe back here, escape the frame instead of rendering two sidebars and
  // two identity areas on the same page.
  try {
    window.top?.location.replace(window.location.href);
  } catch {
    window.open(window.location.href, "_top");
  }
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
