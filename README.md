# Blickfang · Viewport – Dokumentation

> Websites gleichzeitig auf Desktop, Tablet und Smartphone präsentieren.

---

## Inhaltsverzeichnis

1. [Was ist Blickfang · Viewport?](#1-was-ist-blickfang--viewport)
2. [Installation & Ersteinrichtung](#2-installation--ersteinrichtung)
3. [App starten](#3-app-starten)
4. [Bedienungsanleitung](#4-bedienungsanleitung)
   - 4.1 [Eine Website öffnen](#41-eine-website-öffnen)
   - 4.2 [Geräteansichten auswählen](#42-geräteansichten-auswählen)
   - 4.3 [Panels verschieben und in der Größe ändern](#43-panels-verschieben-und-in-der-größe-ändern)
   - 4.4 [Panels maximieren und schließen](#44-panels-maximieren-und-schließen)
   - 4.5 [Automatisch anordnen](#45-automatisch-anordnen)
   - 4.6 [Eigene Bildschirmgröße hinzufügen](#46-eigene-bildschirmgröße-hinzufügen)
   - 4.7 [Screenshots erstellen](#47-screenshots-erstellen)
   - 4.8 [Tastaturkürzel](#48-tastaturkürzel)
5. [Installer erstellen (für Weitergabe)](#5-installer-erstellen-für-weitergabe)
6. [Offene Aufgaben & Ideen (TODOs)](#6-offene-aufgaben--ideen-todos)
7. [Troubleshooting](#7-troubleshooting)
8. [Push-Notifications einrichten](#8-push-notifications-einrichten)
9. [Technischer Hintergrund](#9-technischer-hintergrund)

---

## 1. Was ist Blickfang?

**Blickfang · Viewport** ist eine Desktop-Applikation für Windows und Linux, mit der du **jede beliebige Website gleichzeitig in mehreren Gerätegrößen** anzeigen kannst – zum Beispiel Desktop (1920×1080) und Smartphone (390×844) nebeneinander.

Typische Einsatzzwecke:
- Präsentationen zeigen, wie eine Website auf verschiedenen Endgeräten aussieht
- Responsive Design live vergleichen
- Kunden oder Jugendlichen erklären, warum Mobiloptimierung wichtig ist

**Besonderheit:** Im Gegensatz zu Browser-Entwicklertools lädt Blickfang die Seite tatsächlich in echten, unabhängigen Browser-Fenstern. Blockierungen durch `X-Frame-Options` oder Content-Security-Policy spielen keine Rolle.

---

## 2. Installation & Ersteinrichtung

### Voraussetzungen

| Software | Version | Download |
|---|---|---|
| **Node.js** | 18 oder neuer | https://nodejs.org (LTS empfohlen) |
| **npm** | kommt mit Node.js | – |

Ob Node.js bereits installiert ist, kann man in einem Terminal prüfen:

```bash
node --version   # sollte v18.x.x oder höher zeigen
npm --version
```

### Abhängigkeiten installieren

Einmalig im Projektordner ausführen:

```bash
cd electron-version
npm install
```

Das dauert etwa 30–60 Sekunden und lädt alle benötigten Pakete herunter (Electron, electron-builder).

> **Hinweis:** Nach diesem Schritt muss `npm install` nicht erneut ausgeführt werden, außer wenn neue Pakete zum Projekt hinzugefügt wurden.

---

## 3. App starten

```bash
cd electron-version
npm start
```

Das Hauptfenster öffnet sich automatisch. Beim ersten Start erscheint der **Willkommen-Bildschirm** mit einer kurzen Schritt-für-Schritt-Anleitung.

---

## 4. Bedienungsanleitung

### 4.1 Eine Website öffnen

1. Klicke in das **Adressfeld** oben in der Mitte.
2. Gib die gewünschte Adresse ein, z. B. `www.example.com` oder `https://google.com`.  
   - Ein `https://` vorne muss **nicht** eingetippt werden – die App ergänzt es automatisch.
3. Drücke **Enter** oder klicke auf **„Website laden"**.

Wenn noch kein Gerätepanel offen ist, öffnet sich automatisch eine **Desktop-Ansicht (1920×1080)**.

Alle bereits geöffneten Panels navigieren automatisch zur neuen Adresse mit.

---

### 4.2 Geräteansichten auswählen

Direkt unter der Adressleiste befindet sich die **Geräteleiste**. Dort stehen fünf vordefinierte Geräte als Schaltflächen:

| Schaltfläche | Bildschirmbreite × Höhe | Beschreibung |
|---|---|---|
| **Desktop** | 1920 × 1080 px | Standard-Monitor |
| **Laptop** | 1366 × 768 px | Notebook-Bildschirm |
| **Tablet** | 768 × 1024 px | z. B. iPad |
| **iPhone** | 390 × 844 px | iPhone 14 |
| **Android** | 360 × 800 px | Typisches Android-Handy |

**Klick auf einen Chip:**
- Ist die Ansicht noch nicht offen → Panel wird geöffnet (blau markiert)
- Ist die Ansicht bereits offen → Panel wird geschlossen (Chip wird grau)

Es können **mehrere Ansichten gleichzeitig** offen sein.

---

### 4.3 Panels verschieben und in der Größe ändern

**Verschieben:**  
Die dunkelgraue **Titelleiste** (oben am Panel) fassen und bei gedrückter Maustaste ziehen.

- Sobald das Panel einem Rand, einer Mittellinie oder einem anderen Panel nahe kommt, **rastet es automatisch ein** (blaue Hilfslinien erscheinen kurz).

**Größe ändern:**  
Am unteren rechten Eck befindet sich ein kleines **Pfeil-Symbol**. Dieses fassen und ziehen.

---

### 4.4 Panels maximieren und schließen

In der Titelleiste jedes Panels befinden sich drei farbige Punkte (wie bei macOS):

| Punkt | Farbe | Aktion |
|---|---|---|
| Schließen | 🔴 Rot | Panel schließen |
| Minimieren | 🟡 Gelb | (derzeit ohne Funktion) |
| Maximieren | 🟢 Grün | Panel auf die volle Workspace-Größe ausdehnen. Nochmaliger Klick stellt die ursprüngliche Größe wieder her. |

---

### 4.5 Automatisch anordnen

Der Button **„Anordnen"** unten rechts in der Toolbar sortiert alle geöffneten Panels automatisch in einem gleichmäßigen Raster – nützlich, wenn die Panels durcheinandergeschoben wurden.

**Tastaturkürzel:** `Strg + Shift + A`

---

### 4.6 Eigene Bildschirmgröße hinzufügen

Klicke ganz rechts in der Geräteleiste auf **„+ Eigene Größe"** (gestrichelte Schaltfläche).

Im Dialog:
1. **Breite** und **Höhe** in Pixeln eingeben.
2. Eine **Bezeichnung** vergeben (z. B. „Surface Pro").
3. Optional: auf einen **Schnellauswahl-Button** klicken (iPad Air, iPhone SE, Pixel 7 …) um fertige Werte zu übernehmen.
4. **„Ansicht hinzufügen"** klicken oder Enter drücken.

---

### 4.7 Screenshots erstellen

1. Stelle sicher, dass mindestens eine Ansicht geöffnet ist.
2. Klicke unten links auf den Button **„Screenshot"** (Kamera-Symbol).
3. Die App macht von **allen geöffneten Panels** gleichzeitig einen Screenshot.

#### Option „Alles kombiniert" (Toggle neben dem Screenshot-Button)

| Zustand | Ergebnis |
|---|---|
| ✅ Eingeschaltet | Alle Panels werden auf **einem einzigen Bild** nebeneinander dargestellt, mit Gerätebezeichnung und Auflösung als Beschriftung. Die Datei heißt `blickfang_kombiniert.png`. |
| ☐ Ausgeschaltet | Jedes Panel wird als **separate Datei** gespeichert, z. B. `Desktop_1920x1080.png`. |

Die Dateien werden automatisch über den Browser-Download-Dialog gespeichert.

---

### 4.8 Tastaturkürzel

| Kürzel | Funktion |
|---|---|
| `Strg + Shift + A` | Alle Panels automatisch anordnen |
| `Strg + P` | Screenshot auslösen |
| `Escape` | Adressfeld leeren / Dialog schließen |

---

## 5. Installer erstellen (für Weitergabe)

Die App kann als eigenständiger Installer gebaut werden – dann braucht der Empfänger **kein Node.js** zu installieren.

### Für Windows (`.exe` Installer)

```bash
cd electron-version
npm run build:win
```

Ergebnis: `dist/Blickfang Setup 1.0.0.exe`  
Dies ist ein Standard-Windows-Installer (NSIS), der eine normale Windows-Installation durchführt.

### Für Linux (AppImage)

```bash
cd electron-version
npm run build:linux
```

Ergebnis: `dist/Blickfang-1.0.0.AppImage`  
Das AppImage ist eine einzelne portable Datei, die ohne Installation direkt ausgeführt werden kann:

```bash
chmod +x Blickfang-1.0.0.AppImage
./Blickfang-1.0.0.AppImage
```

### Hinweise zum Build

- Der Build muss auf dem jeweiligen Betriebssystem ausgeführt werden (Windows-Build auf Windows, Linux-Build auf Linux).
- Ausnahme: Für den Windows-Build unter Linux kann `wine` installiert sein – das funktioniert aber nicht immer zuverlässig.
- Der Build dauert 2–5 Minuten und benötigt ca. 500 MB freien Speicher.
- Das `dist/`-Verzeichnis kann nach dem Build bei Bedarf gelöscht werden.

#### App-Icon hinzufügen (optional)

Damit der Installer ein eigenes Icon erhält, folgende Dateien anlegen:

```
src/assets/icon.ico    ← Windows (256×256 px empfohlen)
src/assets/icon.png    ← Linux   (512×512 px empfohlen)
```

Ohne diese Dateien wird das Standard-Electron-Icon verwendet. Der Build schlägt fehl, wenn die Pfade in `package.json` angegeben sind, die Dateien aber fehlen (→ Lösung: Pfad aus `package.json` entfernen oder Icon-Dateien anlegen).

---

## 6. Offene Aufgaben & Ideen (TODOs)

### 🔴 Wichtig / Fehler

- [ ] **Gelber Punkt (Minimieren)** hat noch keine Funktion – sinnvoll wäre: Panel auf die Titelleiste reduzieren (wie bei klassischen Desktops).
- [ ] **App-Icons fehlen** (`src/assets/icon.ico`, `src/assets/icon.png`). Ohne Icons baut `electron-builder` mit einem Warnung / Fehler. Icon-Pfade in `package.json` anpassen oder Icons ergänzen.
- [ ] **Kein Ladeanzeiger im Panel**: Wenn eine Seite lädt, sieht man keinen Fortschrittsbalken. Via `webContents.on('did-start-loading')` und `did-stop-loading` könnte ein Spinner eingeblendet werden.

### 🟡 Verbesserungen

- [ ] **URL-validierung verbessern**: Bei sehr ungewöhnlichen Eingaben (z. B. nur `google`) könnte ein Hinweis erscheinen statt direkt zu navigieren.
- [ ] **Panel-Namen editierbar machen**: Doppelklick auf die Bezeichnung im Titelbalken zum Umbenennen.
- [ ] **Fenster-Layout speichern**: Beim Beenden die geöffneten Panels mit ihren Positionen und der aktuellen URL speichern, beim nächsten Start wiederherstellen (über `electron-store` oder eine einfache JSON-Datei realisierbar).
- [ ] **Mehrere URLs**: Aktuell navigieren alle Panels zur gleichen URL. Eine Option, um einzelnen Panels unterschiedliche URLs zuzuweisen, wäre nützlich.
- [ ] **Zoom-Faktor pro Panel**: Manche Seiten sind sehr groß – ein Schieberegler für den Zoom-Level wäre hilfreich.
- [ ] **Eigene Geräte dauerhaft speichern**: Benutzerdefinierte Größen gehen beim Beenden verloren.
- [ ] **Automatische Updates**: `electron-updater` einbinden, damit neue Versionen out-of-the-box eingespielt werden.

### 🟢 Ideen für später

- [ ] **Export als PDF**: Alle Ansichten in ein mehrseitiges PDF exportieren.
- [ ] **Vergleichsmodus**: Zwei Panels nebeneinander mit einem Trennbalken, der verschoben werden kann.
- [ ] **Dark-Mode-Toggle**: Für die App-Oberfläche selbst (die Website-Inhalte sind davon unabhängig).
- [ ] **Vorschau-Miniatur**: Kleine Thumbnails aller offenen Panels in der Toolbar.
- [ ] **macOS-Unterstützung**: Im Moment ist DMG-Build nicht konfiguriert; `electron-builder` würde es aber prinzipiell unterstützen.

---

## 7. Troubleshooting

### Die App startet nicht / schwarzes Fenster erscheint

**Mögliche Ursache 1: Node.js-Version**  
Prüfen:
```bash
node --version
```
Es wird mindestens **Node.js 18** benötigt. Ältere Versionen wie 14 oder 16 können Probleme mit Electron 29 verursachen.

**Mögliche Ursache 2: node_modules fehlt**  
Prüfen, ob der Ordner `electron-version/node_modules/` existiert. Falls nicht:
```bash
npm install
```

**Mögliche Ursache 3: Electron-Binary beschädigt**  
```bash
# node_modules löschen und neu installieren
rm -rf node_modules
npm install
```

---

### Eine Website wird nicht geladen (weißes/leeres Panel)

**Mögliche Ursache 1: Falsche URL**  
Sicherstellen, dass die Adresse korrekt ist. Tipp: Die URL zunächst im normalen Browser öffnen und dann in Blickfang eingeben.

**Mögliche Ursache 2: Kein Internetzugang**  
Blickfang braucht wie ein normaler Browser eine aktive Internetverbindung. Für lokale Seiten `http://localhost:PORT` eingeben.

**Mögliche Ursache 3: Seite braucht sehr lange**  
Einfach kurz warten. Seiten mit vielen externen Ressourcen (Skripten, Schriften, Bildern) können mehrere Sekunden laden.

---

### `npm install` schlägt fehl

**Proxy/Firewall:** In Unternehmens-/Schul-Netzwerken blockieren Firewalls manchmal den npm-Download. Lösung: VPN deaktivieren oder das Heimnetzwerk nutzen.

**Festplattenplatz:** Der Ordner `node_modules` wird ca. 500–700 MB groß. Sicherstellen, dass ausreichend Platz vorhanden ist.

**Fehler bei `electron` PostInstall:** Manchmal schlägt das Herunterladen des Electron-Binaries fehl. Erneut versuchen:
```bash
npm install
```
Bei hartnäckigen Fehlern kann man die Electron-Cache-Dateien löschen:
```bash
# Linux
rm -rf ~/.cache/electron

# Windows (in PowerShell)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron\Cache"
```
Dann erneut `npm install`.

---

### `npm run build:win` / `npm run build:linux` schlägt fehl

**Fehlermeldung: `Cannot find icon`**  
Die in `package.json` angegebenen Icon-Dateien (`src/assets/icon.ico` / `icon.png`) fehlen.  
Lösung A: Icon-Dateien erstellen und in `src/assets/` ablegen.  
Lösung B: Die `icon`-Zeilen in `package.json` vorübergehend entfernen:
```json
"win":   { "target": [...] },
"linux": { "target": [...] }
```

**Fehlermeldung: `ENOENT: no such file or directory`**  
Sicherstellen, dass der Build aus dem Ordner `electron-version/` heraus gestartet wird (nicht aus dem übergeordneten Ordner).

---

### Screenshot funktioniert nicht / Datei wird nicht gespeichert

**Browser-Downloadblock:** Einige Linux-Desktops blockieren automatische Downloads. Ein Dialogfenster sollte erscheinen – falls nicht, im Terminal auf Fehlermeldungen achten (App mit `npm start` starten und die Ausgabe beobachten).

**Panels nicht cacht sichtbar:** Der Screenshot-Mechanismus greift nur auf Panels zurück, die tatsächlich im sichtbaren Bereich des Fensters liegen. Panels, die außerhalb des Fensterrahmens liegen, werden möglicherweise nicht korrekt erfasst – mit „Anordnen" sicherstellen, dass alle Panels im Workspace liegen.

---

### Panels springen nach dem Verschieben

Das Snap-Verhalten rastet Panels bei Näherung an Kanten oder andere Panels ein. Falls das stört: Das Panel einfach schneller/weiter wegziehen (über den 14-px-Schwellwert hinaus), dann rastet es nicht mehr ein.

---

### Unter Linux: App öffnet sich, aber kein Fenster erscheint

Bei einigen Linux-Konfigurationen ohne installierten Display-Server (z. B. in einer reinen SSH-Sitzung) startet Electron zwar, aber kann kein Fenster öffnen.  
Lösung: Sicherstellen, dass eine grafische Desktopumgebung aktiv ist (GNOME, KDE, XFCE etc.).

---

### Fehlermeldung: `Sandbox not supported on this system`

Bei sehr alten Kerneln oder bestimmten Container-Umgebungen kann die Electron-Sandbox Probleme machen.  
Temporäre Lösung – in `src/main.js` die Zeile ändern:
```js
// vorher:
app.enableSandbox();

// nachher (weniger sicher, aber lauffähig):
// app.enableSandbox();  ← auskommentieren
```
> **Achtung:** Dies sollte nur in kontrollierten Umgebungen gemacht werden, nicht für öffentliche Verteilung.

---

## 8. Push-Notifications der geladenen Webseiten aktivieren

Die in Blickfang geladenen Webseiten können intern Push-Notifications versenden – über die Web Push API des Browsers (`PushManager.subscribe()`). **Blickfang selbst versendet keine Push-Nachrichten.** Blickfang stellt lediglich die Chromium-Infrastruktur bereit, die die Webseiten für ihre Push-Registrierung benötigen.

Electron liefert – im Gegensatz zu Google Chrome – keine eingebetteten Google-API-Schlüssel mit. Ohne diese verweigert Chromium die Push-Registrierung:

```
Registration failed - push service not available
```

### Schritt 1: Google-API-Zugangsdaten beschaffen

1. **Firebase Console** öffnen: <https://console.firebase.google.com>
2. Ein (eigenes) Firebase-Projekt auswählen oder neu anlegen – muss nicht das Projekt der Ziel-Website sein.
3. **Projekteinstellungen** → Reiter **Allgemein** → Web-App → `apiKey` = **GOOGLE_API_KEY**
4. **Projekteinstellungen** → Reiter **Cloud Messaging** → `Sender-ID` = **GOOGLE_DEFAULT_CLIENT_ID**
5. **Google Cloud Console** (<https://console.cloud.google.com>) → **APIs & Dienste** → **Anmeldedaten** → OAuth 2.0-Client-ID (Typ: Desktop) anlegen → Client-Secret = **GOOGLE_DEFAULT_CLIENT_SECRET**

### Schritt 2: Zugangsdaten in der App hinterlegen

Klicke in der Werkzeugleiste auf das **Schlüssel-Symbol** (🔑). Es öffnet sich ein Dialog mit drei Eingabefeldern. Die Werte werden lokal in `<Benutzerverzeichnis>/google-keys.json` gespeichert und beim nächsten Start automatisch geladen.

> **Nach dem Speichern die App neu starten**, damit die Zugangsdaten wirksam werden. Chromium liest sie beim Programmstart ein.

> **Hinweis:** Die Zugangsdaten erlauben Chromium ausschließlich, Push-Abonnements für die geladenen Webseiten zu registrieren. Das Versenden von Push-Nachrichten liegt vollständig beim Server der jeweiligen Website.

---

## 9. Technischer Hintergrund

### Warum Electron und nicht einfach ein Browser?

Normale Webseiten können in `<iframe>`-Tags nur dann eingebettet werden, wenn die Zielseite das ausdrücklich erlaubt. Die meisten modernen Websites schicken HTTP-Header wie `X-Frame-Options: DENY`, die das verhindern. Deshalb würde ein browser-basierter Ansatz mit iframes bei fast allen populären Seiten (Google, ARD, YouTube usw.) **leer bleiben**.

Electron verwendet `WebContentsView` – das sind vollwertige, eigenständige Chromium-Browser-Prozesse, die direkt ins App-Fenster eingebettet werden. Diese unterliegen diesen Einschränkungen **nicht**, weil sie keinen Cross-Origin-Kontext haben.

### Architektur

```
BrowserWindow (Hauptfenster)
├── renderer/index.html  ← Die sichtbare UI (HTML/CSS/JS)
│   ├── Header (URL-Leiste)
│   ├── DeviceBar (Gerätechips)
│   ├── Workspace (nur Dekorations-Divs = Rahmen & Titelleisten)
│   └── Toolbar (Screenshot, Anordnen)
│
└── WebContentsView #1  ← echter Chromium-Prozess (website)
└── WebContentsView #2  ← echter Chromium-Prozess (website)
└── ...
```

Die Dekoration (Titelleiste, Rahmen) ist normales HTML und liegt *über* dem WebContentsView. Der eigentliche Website-Inhalt wird vom Chromium-Prozess direkt ins Fenster gemalt.

### Kommunikation (IPC)

Der Renderer-Prozess (`app.js`) kann nicht direkt auf Electron-APIs zugreifen. Die Kommunikation läuft über einen sicheren Kanal:

```
app.js  →  preload.js (contextBridge)  →  main.js  →  WebContentsView
```

### Sicherheit

- **Context Isolation** ist aktiviert: Renderer-Code hat keinen Zugriff auf Node.js-APIs.
- **Sandbox** ist für den Renderer aktiviert.
- Pro Panel wird eine **separate Session** (`session.fromPartition`) verwendet: Cookies und Cache werden nicht zwischen Panels geteilt.
- Für jedes Panel werden `X-Frame-Options`- und `Content-Security-Policy`-Header serverseitig entfernt, damit alle Seiten vollständig laden.

---

*Dokumentation erstellt am 18. März 2026 – Blickfang · Viewport v1.1.0*
