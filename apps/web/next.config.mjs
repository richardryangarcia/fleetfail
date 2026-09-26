/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@fleetfail/engine'],
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};

export default nextConfig;
