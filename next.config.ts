import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AWS SDK v3 must stay external in the server bundle — bundling it breaks
  // the credential-chain resolution on AWS Amplify's SSR runtime.
  serverExternalPackages: ["@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb"],
};

export default nextConfig;
