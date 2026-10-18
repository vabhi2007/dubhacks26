import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// The repo-root .env also drives host_permissions, so a non-default WXT_AGENT_URL is still reachable from the panel.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // no .env: defaults below
}
const agentOrigin = new URL(process.env.WXT_AGENT_URL ?? "http://localhost:8787").origin;

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Read the single repo-root .env (WXT_* vars are exposed as import.meta.env.WXT_*)
  vite: () => ({ plugins: [tailwindcss()], envDir: "../.." }),
  dev: { server: { host: "127.0.0.1", port: 3110 } },
  manifest: {
    name: "Alfred",
    description: "Snap anything, get an honest verdict.",
    permissions: ["sidePanel", "activeTab", "storage", "scripting"],
    host_permissions: [...new Set(["http://localhost:8787/*", "http://127.0.0.1:8787/*", `${agentOrigin}/*`])],
    action: { default_title: "Open Alfred" },
    commands: {
      snap: { suggested_key: { default: "Alt+Shift+S" }, description: "Snap with Alfred" },
    },
  },
});
