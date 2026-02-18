import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ✅ Evita que Next intente observar/usar la carpeta de functions durante el build del frontend
  webpack: (config) => {
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: ["**/functions/**"],
    };
    return config;
  },

  // ✅ Next 16: define turbopack config para que no choque con webpack config
  turbopack: {},
};

export default nextConfig;
