/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // keep the ONNX embedding runtime out of the webpack bundle
    serverComponentsExternalPackages: ['@xenova/transformers', 'onnxruntime-node', 'sharp', 'pg'],
  },
};
export default nextConfig;
