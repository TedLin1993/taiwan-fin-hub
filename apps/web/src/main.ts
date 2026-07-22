import { mount } from "svelte";
import App from "./app/App.svelte";
import { isStandalonePwa } from "./shared/pwa/detection";
import { registerPushServiceWorker } from "./shared/pwa/push";

document.documentElement.classList.toggle("is-standalone", isStandalonePwa());

if ("serviceWorker" in navigator) {
  void registerPushServiceWorker().catch((error) =>
    console.warn("[pwa] service worker registration failed", error),
  );
}

const target = document.getElementById("root");
if (!target) throw new Error("Missing #root element");
mount(App, { target });
