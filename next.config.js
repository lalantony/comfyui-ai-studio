/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/tools", destination: "/settings/tools", permanent: true },
      { source: "/integrations", destination: "/settings/integrations", permanent: true },
    ];
  },
};

module.exports = nextConfig;
