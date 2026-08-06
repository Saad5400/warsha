// The entry point. It mounts your <App> into the #app element in index.html.
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (target) mount(App, { target });
