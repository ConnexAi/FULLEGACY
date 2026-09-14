import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Navegacion } from "@/components/navegacion";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FULLEGACY",
  description: "Sistema de reportes de pedidos a partir de exports de Dropi.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* El relleno inferior deja aire para la pastilla flotante, que va fija
          sobre el contenido. */}
      <body className="flex min-h-full flex-col pb-24">
        {children}
        <Navegacion />
      </body>
    </html>
  );
}
