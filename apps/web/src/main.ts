import { mount } from "svelte";
import App from "./App.svelte";

document.documentElement.classList.toggle(
  "is-standalone",
  window.matchMedia("(display-mode: standalone)").matches,
);

const target = document.getElementById("root");
if (!target) throw new Error("Missing #root element");
mount(App, { target });
