import { mount } from "svelte";
import App from "./App.svelte";
import { isStandalonePwa } from "./lib/pwa";

document.documentElement.classList.toggle("is-standalone", isStandalonePwa());

const target = document.getElementById("root");
if (!target) throw new Error("Missing #root element");
mount(App, { target });
