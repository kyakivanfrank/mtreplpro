const nextConfig = {
  reactStrictMode: true,
  // The "N" badge sits on top of the Quotes tab when the dev server is opened on a phone.
  devIndicators: false,
  // The whole LAN, not one address: a router hands this machine a different one after
  // a reboot or a lease expiry, and a pinned address means the dev server starts
  // refusing the phone that was working yesterday for no visible reason.
  allowedDevOrigins: ['localhost', '127.0.0.1', '192.168.1.*', '192.168.*.*', '10.*.*.*',
    // Public demo tunnels: the dev server sees a foreign Host header and would otherwise
    // reject HMR/asset requests coming back through the tunnel.
    '*.trycloudflare.com',
    '*.devtunnels.ms'],
  experimental: {
    serverMinification: true,
  },
  onDemandEntries: {
    maxInactiveAge: 60000,
    pagesBufferLength: 5,
  },
};

export default nextConfig;
