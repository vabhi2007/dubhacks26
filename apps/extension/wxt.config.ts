import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Read the single repo-root .env (WXT_* vars are exposed as import.meta.env.WXT_*)
  vite: () => ({ plugins: [tailwindcss()], envDir: "../.." }),
  dev: { server: { host: "127.0.0.1", port: 3110 } },
  manifest: {
    name: "Alfred",
    description: "Snap anything, get an honest verdict.",
    permissions: ["sidePanel", "activeTab", "storage", "scripting"],
    host_permissions: ["http://localhost:8787/*", "http://127.0.0.1:8787/*"],
    action: { default_title: "Open Alfred" },
    commands: {
      snap: { suggested_key: { default: "Alt+Shift+S" }, description: "Snap with Alfred" },
    },
  },
});
