/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  // Increase the timeout for API routes
  experimental: {
    serverComponents: true,
  },
  // Increase the bodyParser size limit for API routes
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false,
  }
};

module.exports = nextConfig; 