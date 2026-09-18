import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // An unrelated package-lock.json exists in a parent directory on some dev
    // machines. Without an explicit root, Turbopack walks upward and picks it
    // up, which makes builds depend on what sits outside the repository.
    root: __dirname,
  },
};

export default nextConfig;
