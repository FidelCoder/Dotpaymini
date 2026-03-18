import "./globals.css";
import { Providers } from "./providers";
import type { ReactNode } from "react";

export const metadata = {
  title: "Dotpaymini",
  description: "World Mini App version of DotPay.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
