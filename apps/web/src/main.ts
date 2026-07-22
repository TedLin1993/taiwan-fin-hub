import { mount } from "svelte";
import App from "./app/App.svelte";
import { isStandalonePwa } from "./shared/pwa/detection";

document.documentElement.classList.toggle("is-standalone", isStandalonePwa());

const target = document.getElementById("root");
if (!target) throw new Error("Missing #root element");
mount(App, { target });
