import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@ossuary/sim'],
  reactStrictMode: true,
};

export default config;
