import Head from "next/head";
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>Aufschlag</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0e2a3a" />
        <link rel="manifest" href="/manifest.json" />

        {/* iOS: "Zum Home-Bildschirm" */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Aufschlag" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        <link rel="icon" href="/favicon-32.png" sizes="32x32" />
        <link rel="icon" href="/icon-192.png" sizes="192x192" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
