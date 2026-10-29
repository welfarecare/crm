import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App interna: tutte le pagine sono dinamiche (dati per utente)
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
