import "./globals.css"

export const metadata = { title: "英会話学習" }

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
