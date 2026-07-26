/** @type {import('next').NextConfig} */

function getGitSha() {
  try {
    return require('child_process').execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'dev';
  }
}

const nextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    optimizePackageImports: ['recharts', 'xlsx', 'xlsx-js-style', 'react-syntax-highlighter', '@tanstack/react-table', '@dnd-kit/core', '@dnd-kit/sortable'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  env: {
    NEXT_PUBLIC_GIT_SHA: getGitSha(),
  },
}

module.exports = nextConfig
