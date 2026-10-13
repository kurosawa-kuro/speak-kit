/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 開発サーバー（.next）と本番ビルドが同じ出力先を使うと、開発サーバーが壊れる。
  distDir: process.env.NEXT_DIST_DIR || ".next",
}
export default nextConfig
