import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Evita que Next intente incluir carpetas que NO son parte del frontend
  webpack: (config) => {
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: ["**/functions/**"],
    };
    return config;
  },
};

export default nextConfig;
