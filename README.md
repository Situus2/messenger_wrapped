# Messenger Wrapped

Podsumowanie roku z rozmów na Messengerze w stylu Spotify Wrapped. Działa w 100% w przeglądarce:
plik z wiadomościami jest czytany lokalnie (Web Worker), nie jest nigdzie wysyłany ani zapisywany.
Po wczytaniu strony można włączyć tryb samolotowy — wszystko dalej działa.

## Struktura

| Plik | Rola |
| --- | --- |
| `index.html` | jedyna strona: start z 3 krokami, wybór rozmowy, karty |
| `assets/js/engine.js` | silnik (Web Worker): czytnik ZIP/ZIP64 bez bibliotek, parser eksportu Facebooka i eksportu szyfrowanych czatów, statystyki |
| `assets/js/app.js` | strona główna, tryb samolotowy, wgrywanie, wybór rozmowy, nawigacja „wstecz” |
| `assets/js/stories.js` + `assets/css/stories.css` | karty podsumowania, odtwarzacz i arkusz udostępniania (używane też w wyeksportowanym pliku HTML) |
| `assets/js/exporter.js` | eksport kart: PNG 1080×1920 na relację (Instagram), ZIP wszystkich kart, samodzielny plik HTML |
| `assets/js/demo.js` | fikcyjne dane do przykładowych kart na stronie głównej |
| `assets/fonts/`, `assets/css/fonts.css` | fonty Anybody i Figtree hostowane lokalnie (OFL) — bez zapytań do Google |
| `sw.js` | service worker — strona działa po odświeżeniu offline |
| `wybor_osob.html`, `design_new.html` | przekierowania ze starych adresów |

## Obsługiwane pliki

- ZIP lub JSON z „Pobierz dane z bezpiecznej pamięci” (czaty szyfrowane end-to-end),
- ZIP lub JSON z „Pobierz swoje informacje” na Facebooku (format **JSON**, nie HTML),
- kilka plików naraz — ta sama rozmowa z różnych eksportów jest łączona, a powtórzone wiadomości liczone raz.

## Uruchomienie lokalnie

Web Worker i service worker nie działają z `file://`, potrzebny jest serwer:

```bash
python -m http.server 8000
```

i wejdź na `http://localhost:8000`.

Po zmianie plików w `assets/` podbij `?v=` w `index.html`, `VERSION` w `app.js` i `exporter.js` oraz listę i nazwę cache w `sw.js`,
żeby użytkownicy dostali nową wersję.

## Start w grudniu

Na razie `index.html` to strona zapowiedzi, a pełna aplikacja jest w `app.html` (niepodlinkowana, `noindex`).
Żeby uruchomić Wrapped dla wszystkich:

```bash
git mv index.html zapowiedz.html
git mv app.html index.html
```

i usuń z nowego `index.html` linię `<meta name="robots" content="noindex, nofollow">`.
