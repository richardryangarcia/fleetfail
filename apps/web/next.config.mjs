/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@fleetfail/engine', 'leaflet.markercluster'],
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};

export default nextConfig;
