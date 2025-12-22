# Messenger Wrapped - GitHub Pages Deployment

To projekt działający w 100% w przeglądarce przy użyciu **PyScript**.

### Jak uruchomić lokalnie?
Ponieważ przeglądarki blokują ładowanie plików lokalnych (CORS), musisz uruchomić prosty serwer HTTP:

```bash
# Jeśli masz Pythona:
python -m http.server
```

Następnie wejdź na `http://localhost:8000`.

### Jak wdrożyć na GitHub Pages?
1. Stwórz nowe repozytorium na GitHubie.
2. Wrzuć zawartość folderu `github/` do repozytorium (lub brancha `gh-pages`).
3. W ustawieniach repozytorium włącz GitHub Pages wskazując na folder główny `/`.
4. Gotowe! Twoja strona będzie dostępna pod adresem `https://uzytkownik.github.io/nazwa-repo/`.

**Ważne:** Plik `.nojekyll` jest wymagany, aby GitHub nie ignorował plików zaczynających się od podkreślnika (np. `__init__.py`).
