/** @type {import('next').NextConfig} */

function getGitSha() {
  try {
    return require('child_process').execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'dev';
  }
}

const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  env: {
    NEXT_PUBLIC_GIT_SHA: getGitSha(),
  },
}

module.exports = nextConfig
