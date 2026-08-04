// The entry point. It finds the #root element in index.html and hands it to
// React, which renders your <App /> into it.
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
