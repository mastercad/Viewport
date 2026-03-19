# Blickfang · Viewport – Technische Dokumentation

> Für Entwickler, Systemadministratoren und alle, die die App bauen, anpassen oder debuggen wollen.
>
> Die **Bedienungsanleitung für Endnutzer** befindet sich in [HANDBUCH.md](HANDBUCH.md).

---

![Blickfang Hauptfenster](assets/blickfang_hauptfenster.png)

---

## Inhaltsverzeichnis

1. [Projektüberblick](#1-projektüberblick)
2. [Technologie-Stack](#2-technologie-stack)
3. [Projektstruktur](#3-projektstruktur)
4. [Architektur](#4-architektur)
5. [Voraussetzungen & Installation](#5-voraussetzungen--installation)
6. [App starten (Entwicklung)](#6-app-starten-entwicklung)
7. [Tests ausführen](#7-tests-ausführen)
8. [Distributionsbuild erstellen](#8-distributionsbuild-erstellen)
9. [Auto-Update-Mechanismus](#9-auto-update-mechanismus)
10. [Sicherheitskonzept](#10-sicherheitskonzept)
11. [Bekannte Probleme & Lösungen](#11-bekannte-probleme--lösungen)
12. [Push-Notification-Konfiguration](#12-push-notification-konfiguration)

---


## 1. Projektüberblick

**Blickfang · Viewport** ist eine Desktop-Applikation (Electron 32) für Windows und Linux, mit der sich beliebige Websites gleichzeitig in mehreren Gerätegrößen als parallele Chromium-Render-Prozesse anzeigen lassen.

Im Unterschied zu iFrame-basierten Ansätzen umgeht Blickfang `X-Frame-Options`- und CSP-Beschränkungen vollständig: Jeder Viewport ist ein eigenständiger `WebContentsView`-Prozess, der nicht im Cross-Origin-Kontext läuft.

---

## 2. Technologie-Stack

| Paket | Version | Zweck |
|---|---|---|
| `electron` | ^32.0.0 | Framework (Main-Prozess: CommonJS; Renderer: ES-Module via `"type":"module"`) |
| `electron-builder` | ^24.9.1 | Distribution: Windows NSIS-Installer (x64), Linux AppImage (x64) |
| `electron-updater` | ^6.8.3 | Auto-Update via GitHub Releases |
| `vitest` | ^2.1.9 | Unit-Tests (ab Node 18; vitest@4+ benötigt Node ≥ 22) |
| Node.js | ≥ 18 | Laufzeitumgebung (entwickelt auf v21.7.3) |

Kein Frontend-Framework — reines Vanilla-JS mit ES-Modulen im Renderer.

---

## 3. Projektstruktur

```
electron-version/
├── package.json
├── src/
│   ├── main.js              ← Electron-Main-Prozess: BrowserWindow, IPC-Handler,
│   │                           Session-Setup, CSP-Stripping, Auto-Updater,
│   │                           globale Tastatur-Shortcuts (Ctrl+P, Ctrl+Shift+A …)
│   ├── preload.js           ← contextBridge: exponiert window.ss-API
│   └── renderer/
│       ├── index.html       ← App-Shell (Header, DeviceBar, Workspace, Toolbar)
│       ├── app.js           ← Renderer-Einstiegspunkt, verkabelt alle Module
│       ├── panels.js        ← Panel-Lifecycle: add/remove/drag/resize/snap/
│       │                       maximize/focus/autoArrange
│       ├── navLogic.js      ← Pure Funktion navigateWvLogic() – kein Side-Effect,
│       │                       vollständig unit-testbar
│       ├── screenshot.js    ← Screenshot-Modi: combined / workspace / single
│       ├── annotate.js      ← Screenshot-Editor: select / arrow / circle /
│       │                       magnifier / crop
│       ├── storage.js       ← localStorage-Persistenz (Schlüssel: blickfang:layout,
│       │                       blickfang:customDevices, blickfang:templates)
│       ├── dialogs.js       ← Custom-Größen-Dialog, Google-Keys-Dialog
│       ├── constants.js     ← PRESETS, SNAP_THRESH(14), FRAME_HEAD_H(36),
│       │                       MIN_W(200), MIN_H(150)
│       ├── state.js         ← Geteilter Zustand: panels-Map, wsRect,
│       │                       panelScale, snapEnabled, topId
│       ├── utils.js         ← normalizeUrl, sleep, toast
│       └── style.css        ← Alle Styles
└── tests/
    └── navigateWv.test.js   ← 12 vitest-Unit-Tests für navigateWvLogic
```

---

## 4. Architektur

### 4.1 Prozess-Modell

```
BrowserWindow (Hauptfenster)
├── renderer/index.html   ← UI-Shell (HTML / CSS / Vanilla-JS ES-Module)
│   ├── Header            (URL-Leiste, Sync-Toggle, Scale-Slider)
│   ├── DeviceBar         (Gerätechips + "Eigene Größe"-Button)
│   ├── Workspace         (Dekorations-Divs: Panel-Rahmen & Titelleisten als HTML)
│   └── Toolbar           (Screenshot, Auto-Arrange)
│
├── WebContentsView #0  ──▶  Chromium-Render-Prozess (Website in Panel 0)
├── WebContentsView #1  ──▶  Chromium-Render-Prozess (Website in Panel 1)
└── ...
```

Jeder Panel erhält einen dedizierten `WebContentsView`, der direkt ins Fenster eingebettet wird. Die HTML-Dekoration (Titelleiste, Rahmen) liegt mit absoluter CSS-Positionierung über dem `WebContentsView`.

### 4.2 IPC-Bridge (`preload.js` → `window.ss`)

`nodeIntegration: false` und `contextIsolation: true` verhindern direkten Node.js-Zugriff aus dem Renderer. Die Kommunikation läuft über `contextBridge`:

```
app.js ──▶ window.ss.xxx() ──▶ preload.js (ipcRenderer) ──▶ main.js
                                                         ◀── ipcMain.handle()
```

Exponierte `window.ss`-Methoden:

| Methode | Richtung | Zweck |
|---|---|---|
| `keysLoad` / `keysSave` | R→M | Google-API-Keys aus/nach `userData` lesen/schreiben |
| `getWorkspace` | R→M | Fensterkoordinaten (Position + Größe) abfragen |
| `captureRect` | R→M | Screenshot eines Rects via `desktopCapturer` |
| `setFullScreen` | R→M | Vollbild-Modus umschalten |
| `onFullScreenChange` | M→R | Vollbild-Event weiterleiten |
| `onWindowResize` | M→R | Resize-Event weiterleiten |
| `onToggleSync` | M→R | Globales Shortcut Ctrl+Shift+S |
| `onAutoArrange` | M→R | Globales Shortcut Ctrl+Shift+A |
| `onScreenshot` | M→R | Globales Shortcut Ctrl+P |
| `onMaximize` | M→R | Maximieren-Befehl |
| `onFocusToggle` | M→R | Fokus-Modus umschalten |
| `onUpdateAvailable` | M→R | Update verfügbar |
| `onUpdateDownloaded` | M→R | Update heruntergeladen |
| `installUpdate` | R→M | `autoUpdater.quitAndInstall()` |

### 4.3 Click-/Scroll-/Input-Forwarding

`WebContentsView` absorbiert Mausevents, bevor sie den HTML-Overlay erreichen. Zur Rückkommunikation aus dem WebContentsView-Kontext zum Renderer nutzt `main.js` ein Console-Message-Protokoll:

Das in den WebContentsView injizierte Skript schreibt:
- `console.log('__SS_CLICK__:…')` — Klick-Koordinaten
- `console.log('__SS_SCROLL__:…')` — Scroll-Events
- `console.log('__SS_INPUT__::…')` — Tastatureingaben

`main.js` lauscht auf `console-message`-Events und löst daraufhin IPC-Callbacks aus.

### 4.4 CSP-Stripping

Damit alle Websites unabhängig von deren Security-Headern vollständig laden, registriert `main.js` für jede Panel-Session einen `onHeadersReceived`-Handler, der folgende Response-Header entfernt:

- `X-Frame-Options`
- `Content-Security-Policy`
- `Content-Security-Policy-Report-Only`

### 4.5 Session-Isolation

Jeder Panel erhält eine eigene persistente Chromium-Session:

```js
session.fromPartition('persist:panel0')
session.fromPartition('persist:panel1')
// ...
```

Cookies, Cache und Storage sind damit vollständig zwischen Panels isoliert.

---

## 5. Voraussetzungen & Installation

```bash
node --version   # muss ≥ v18.0.0 ausgeben
npm --version

cd electron-version
npm install      # lädt alle Abhängigkeiten (~500 MB)
```

---

## 6. App starten (Entwicklung)

```bash
npm start
```

Startet Electron im Dev-Modus. Die Renderer-DevTools öffnen sich automatisch (so in `main.js` konfiguriert). `--no-sandbox` ist im Dev-Modus nicht erforderlich.

---

## 7. Tests ausführen

```bash
npm test
```

Führt `vitest run` im Verzeichnis `tests/` aus. Aktuell: **12 Unit-Tests** in `tests/navigateWv.test.js`, die die Pure-Function `navigateWvLogic()` aus `src/renderer/navLogic.js` testen.

**Versionshinweis:** Das Projekt setzt bewusst `vitest@2.1.9` ein. vitest@4+ erfordert Node.js ≥ 22; bei Node 18–21 schlägt die native `rolldown`-Binding-Installation fehl.

---

## 8. Distributionsbuild erstellen

### Windows (NSIS-Installer, x64)

```bash
npm run build:win
```

Ergebnis: `dist/Blickfang Setup <version>.exe`

Muss auf einer Windows-Maschine ausgeführt werden (Cross-Compile via Wine ist möglich, aber nicht zuverlässig). Benötigt `src/assets/icon.ico` (256×256 px), wenn der `icon`-Pfad in `package.json` gesetzt ist.

### Linux (AppImage, x64)

```bash
npm run build:linux
```

Ergebnis: `dist/Blickfang-<version>.AppImage`

`package.json` enthält bereits `"executableArgs": ["--no-sandbox"]` für das Linux-Build-Target. Das ist auf den meisten Linux-Systemen ohne Root-Rechte erforderlich, da SUID-Sandbox nicht verfügbar ist.

### Release mit Auto-Update veröffentlichen

```bash
GH_TOKEN=<token-mit-repo-scope> npm run build:linux -- --publish always
```

`electron-builder` lädt Artefakte und `latest-linux.yml` direkt als GitHub Release hoch.

---

## 9. Auto-Update-Mechanismus

- **Bibliothek:** `electron-updater` ^6.8.3
- **Aktiv:** Nur wenn `app.isPackaged === true` (nicht im Dev-Modus)
- **Prüfzeitpunkte:** Beim App-Start und anschließend alle 4 Stunden
- **Konfiguration:** `autoDownload: true`, `autoInstallOnAppQuit: true`

**Event-Flow:**

```
autoUpdater.checkForUpdates()
    ↓
update-available   → IPC: updater:available   → Renderer zeigt Info-Banner
    ↓ (Download im Hintergrund)
update-downloaded  → IPC: updater:downloaded  → Renderer zeigt Neustart-Banner
    ↓ (User klickt „Jetzt neu starten")
IPC: updater:install → main.js → autoUpdater.quitAndInstall()
```

---

## 10. Sicherheitskonzept

| Maßnahme | Detail |
|---|---|
| `contextIsolation: true` | Renderer hat keinen Zugriff auf Node.js-APIs |
| `nodeIntegration: false` | Explizit gesetzt (Electron-Standard seit v5) |
| `webviewTag: false` | `<webview>`-Tag deaktiviert; stattdessen `WebContentsView` |
| Session-Isolation | `session.fromPartition('persist:panelN')` pro Panel |
| CSP-Stripping | Ausschließlich für Panel-Sessions, nicht für die App-Shell |
| Permissions-Whitelist | `notifications`, `push`, `media`, `mediaKeySystem`, `geolocation`, `clipboard-read`, `clipboard-write`, `fullscreen`, `openExternal` — alle anderen abgelehnt |
| Linux AppImage | `--no-sandbox` in `executableArgs`; fehlende SUID-Sandbox wird durch `contextIsolation` und Permissions-Whitelist kompensiert |

---

## 11. Bekannte Probleme & Lösungen

### `rolldown`-Native-Binding-Fehler beim Test-Run

**Symptom:**
```
Error: Cannot find module '...rolldown-linux-x64-gnu.node'
```

**Ursache:** vitest@4+ wurde (versehentlich) installiert oder `node_modules` ist beschädigt. vitest@4 erfordert Node.js ≥ 22.

**Lösung:**
```bash
rm -rf node_modules package-lock.json
npm install
# installiert vitest@2.1.9 gemäß package.json
```

---

### AppImage startet nicht / Sandbox-Fehler (Linux)

**Symptom:** AppImage wirft beim Start einen Sandbox-Error.

**Hintergrund:** `executableArgs: ["--no-sandbox"]` ist bereits in `package.json` eingebettet. Falls der manuelle Start trotzdem fehlschlägt:
```bash
./Blickfang-<version>.AppImage --no-sandbox
```

---

### Build schlägt fehl: `Cannot find icon`

**Ursache:** In `package.json` ist ein Icon-Pfad konfiguriert, die Datei fehlt.

**Lösung A:** Icon-Dateien anlegen:
- `src/assets/icon.ico` – Windows (256×256 px)
- `src/assets/icon.png` – Linux (512×512 px)

**Lösung B:** Den `"icon"`-Key vorübergehend aus dem jeweiligen Build-Target in `package.json` entfernen.

---

### `ERR_ABORTED (-3)` in den DevTools-Logs

**Ursache:** Manche Websites lösen Auth-Redirects aus, die Chromium intern abbricht. **Harmlos** – `main.js` filtert `ERR_ABORTED` bereits heraus (kein Fehler-Toast für den Nutzer).

---

### Push-Notifications: `Registration failed - push service not available`

**Ursache:** Electron enthält keine eingebetteten Google-API-Schlüssel (im Gegensatz zu Chrome).

**Lösung:** Keys über den 🔑-Dialog hinterlegen (→ [Abschnitt 12](#12-push-notification-konfiguration)).

---

### Weiße/leere Panels nach URL-Eingabe

**Mögliche Ursachen:**
1. Bei lokalen Dev-Servern `http://` explizit angeben: `http://localhost:3000` statt `localhost:3000` (da `normalizeUrl()` `https://` – nicht `http://` – ergänzt)
2. Kein Netz → DevTools (Ctrl+Shift+I) → Network-Tab prüfen
3. Auth-Wall (Firmen-Intranet) → Chromium öffnet Auth-Dialog im WebContentsView-Kontext

---

## 12. Push-Notification-Konfiguration

Chromium benötigt Google-API-Schlüssel um Web-Push-Abonnements (`PushManager.subscribe()`) zu registrieren. Blickfang liefert diese Keys nicht mit.

| Schlüssel | Bezugsquelle |
|---|---|
| `apiKey` (`GOOGLE_API_KEY`) | Firebase Console → Projekteinstellungen → Allgemein → Web-App |
| `clientId` (`GOOGLE_DEFAULT_CLIENT_ID`) | Google Cloud Console → Anmeldedaten → OAuth 2.0-Client-ID (Typ: Desktop) |
| `clientSecret` (`GOOGLE_DEFAULT_CLIENT_SECRET`) | Google Cloud Console → Anmeldedaten → OAuth 2.0-Client-ID (Typ: Desktop) |

**Speicherort:** `<userData>/api-keys.json` (wird über den 🔑-Dialog gespeichert und geladen)

**Technisches Detail:** `main.js` liest die Keys via `app.commandLine.appendSwitch()` **vor** `app.isReady()` ein. Diese Reihenfolge ist zwingend – Chromium wertet die Switches ausschließlich beim Prozess-Start aus.

**Neustart** nach dem erstmaligen Speichern der Keys ist erforderlich.

---

*Technische Dokumentation – Blickfang · Viewport v1.1.0*
