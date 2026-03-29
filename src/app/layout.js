import './globals.css';

export const metadata = {
  title: 'KRK GPS — Kraków komunikacja miejska na żywo',
  description: 'Śledzenie autobusów, tramwajów i Mobilis w Krakowie w czasie rzeczywistym. Pozycje GPS, odjazdy, rozkłady, opóźnienia, korki.',
  keywords: 'Kraków, MPK, GPS, tramwaje, autobusy, Mobilis, na żywo, opóźnienia, korki, rozkład jazdy',
  manifest: '/manifest.json',
  openGraph: { title: 'KRK GPS — Kraków na żywo', description: 'Autobusy i tramwaje na mapie Krakowa.', type: 'website', locale: 'pl_PL', url: 'https://krkgps.pl' },
  alternates: { canonical: 'https://krkgps.pl' },
};
export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 5, themeColor: '#06090e' };

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script src="https://js.hcaptcha.com/1/api.js" async defer />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{__html:`if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});`}} />
        {children}
      </body>
    </html>
  );
}
