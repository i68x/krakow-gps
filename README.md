# 🚍 KRK GPS — Komunikacja Miejska Kraków na żywo

Aplikacja do śledzenia pojazdów komunikacji miejskiej w Krakowie w czasie rzeczywistym.
Dane z oficjalnego serwera GTFS-RT: `https://gtfs.ztp.krakow.pl/`

## Funkcje

- **Mapa GPS pojazdów** — autobusy (A), tramwaje (T), Mobilis (M) na mapie Leaflet
- **Filtrowanie** — po typie pojazdu i numerze linii
- **Opóźnienia** — informacje o opóźnieniach z TripUpdates
- **Tryb kierowcy** — GPS telefonu vs rozkład jazdy, wybór linii/kierunku/brygady
- **Popup z detalami** — przystanek, prędkość, pojazd, brygada, opóźnienie

## Wdrożenie na Vercel

### 1. Wymagania
- Konto na [vercel.com](https://vercel.com)
- Node.js 18+ lokalnie
- Git

### 2. Szybki deploy

```bash
# Sklonuj projekt
cd krakow-gps

# Zainstaluj zależności
npm install

# Deploy na Vercel
npx vercel --prod
```

### 3. Alternatywnie — przez GitHub

1. Wrzuć kod na GitHub:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TWOJ_USER/krakow-gps.git
git push -u origin main
```

2. Połącz repo z Vercel:
   - Zaloguj się na vercel.com
   - "New Project" → Import z GitHub
   - Framework: **Next.js** (wykryje automatycznie)
   - Deploy!

### 4. Lokalne uruchomienie

```bash
npm install
npm run dev
# http://localhost:3000
```

## Struktura danych

```
public/data/
├── route_list.json     # Lista linii per typ
├── routes.json         # Szczegóły tras
├── trips_A/T/M.json    # Kursy z info o linii
├── stops.json          # Przystanki (nazwa, lat, lon)
├── blocks.json         # Bloki/brygady (A)
└── st/                 # Stop times per linia (lazy load)
    ├── A_102.json
    ├── T_1.json
    └── ...
```

## API Proxy

Endpoint: `/api/gtfs-rt?feed=vehicles_A`

Dostępne feedy:
- `vehicles_A`, `vehicles_T`, `vehicles_M` — pozycje pojazdów
- `trips_A`, `trips_T`, `trips_M` — aktualizacje kursów (opóźnienia)
- `alerts_A`, `alerts_T`, `alerts_M` — alerty serwisowe

Serwer ZTP nie ma nagłówków CORS, więc API Next.js działa jako proxy.

## Aktualizacja danych statycznych

Pliki GTFS statyczne (rozkłady, przystanki) mogą się zmieniać.
Aby zaktualizować, pobierz nowe ZIPy z `https://gtfs.ztp.krakow.pl/`
i uruchom ponownie skrypt przetwarzania.

## Tech stack

- Next.js 14 (App Router)
- Leaflet.js (mapa)
- protobufjs (dekodowanie GTFS-RT)
- Tailwind CSS
