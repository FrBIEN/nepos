# Nepos installieren

Nepos läuft als statische HTML-Seite. Docker, Node.js und PHP sind für den normalen Betrieb nicht erforderlich. Projekte und simulierte Dateien bleiben im Browser beziehungsweise in exportierten JSON/FLS-Projekten.

## Statisches Hosting

Die `index.html` aus dem geprüften Build (`dist/index.html`) in ein Verzeichnis eines beliebigen Webservers kopieren. Optional `dist/examples/lernnetz.json` als Unterrichtsbeispiel mitnehmen. Unterverzeichnisse werden unterstützt. Es gibt keine Datenbank und keinen Anwendungsserver.

Für Tablets und die Zusammenarbeit über WebRTC die Seite über HTTPS bereitstellen. Lokal funktionieren `localhost` und `127.0.0.1`. Manuelle Modemcodes benötigen keinen Signalisierungsserver. Eine heruntergeladene HTML-Datei lässt sich ebenfalls lokal öffnen; Browser können dabei WebRTC und Zwischenablage einschränken.

## Optionaler PHP-Signalisierungsserver

`server/signaling.php` zusätzlich als `signaling.php` in ein Webverzeichnis mit PHP-Unterstützung kopieren (PHP 8.2 oder neuer). Im Modem die Adresse angeben; Standard ist `./signaling.php` neben der HTML-Seite. Der Server vermittelt ausschließlich Angebot und Antwort für WebRTC. Simulierte Netzwerkpakete laufen über den Datenkanal direkt zwischen den Browsern.

Der PHP-Prozess benötigt einen beschreibbaren temporären Ordner. Sitzungen werden dort mit zufälligen IDs und einer Ablaufzeit von einer Stunde gespeichert. Keine persistenten Volumes erforderlich. PHP-Dateien ausschließlich mit aktiviertem PHP-Handler bereitstellen. Externe NAT-Konstellationen können zusätzlich STUN/TURN benötigen; dafür gibt es die ICE-Einstellungen des Modems.

## Fertiger Container mit rootless nginx und PHP

Der optionale Container enthält beide Bestandteile. nginx und PHP-FPM laufen als UID/GID `10001`, hören intern auf Port `8080` beziehungsweise `127.0.0.1:9000` und benötigen keine zusätzlichen Linux-Capabilities. Die Registry folgt dem bestehenden Forgejo-Schema:

```sh
docker run -d --name nepos -p 8080:8080 \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges \
  dev.spittank.org/daniel/nepos:latest
```

Ist das Registry-Paket privat, vorher `docker login dev.spittank.org` mit einem Benutzer und Token mit Paket-Leserechten ausführen.

Alternativ im ausgecheckten Repository:

```sh
docker compose up -d --build
```

Danach `http://localhost:8080/` öffnen. `http://localhost:8080/signaling.php` ist der Signalisierungsendpunkt; ohne gültige Aktion antwortet er absichtlich mit HTTP 400. Ein vorhandener HTTPS-Reverse-Proxy kann auf Port 8080 zeigen. Es werden keine Projekte auf dem Server gespeichert. `/healthz` prüft nginx; die Docker-Prüfung überwacht diesen Endpunkt.

Pushes nach `main` veröffentlichen `:dev` und `:dev-<Commit>`, Release-Tags wie `v0.1.0` veröffentlichen `:0.1.0` und `:latest`. Beide Architekturen `linux/amd64` und `linux/arm64` werden gebaut. Im Repository müssen Forgejo Actions und die Registry-Secrets `REGISTRY_USER` und `REGISTRY_TOKEN` verfügbar sein. Das Token benötigt Schreibrechte auf die Container-Registry. Pull Requests veröffentlichen nichts.

## Selbst bauen und prüfen

Node.js entsprechend `package.json` installieren (empfohlen: Node 24).

```sh
npm ci
npx playwright install chromium
npm run verify
```

`verify` führt Kern-, Datei-, Verlaufs- und echte headless Browser-/WebRTC-Tests aus und erzeugt die eigenständige HTML-Datei. Die Testlogik und der nur lokal gestartete Testserver gehören nicht zum produktiven Build. Nepos enthält keine Testseiten oder Testknöpfe für Benutzer.

Die optionalen Java-Kompatibilitätsprüfungen benötigen ein separat gebautes Filius. Die Filius-Quellen werden nicht mit Nepos ausgeliefert:

```sh
FILIUS_HOME=/pfad/zu/filius npm test
FILIUS_HOME=/pfad/zu/filius npm run test:fls-java
```

Dort müssen `beispiele/`, `target/classes/` und die Bibliotheken unter `target/lib/` vorhanden sein. Ohne Filius funktionieren die normalen Nepos-Prüfungen eigenständig; der Originalbeispiel-Vergleich wird nur bei vorhandenem Testmaterial ausgeführt.

Technische Referenzen: [Playwright-Testserver](https://playwright.dev/docs/test-webserver), [nginx-Prozesskonfiguration](https://nginx.org/en/docs/ngx_core_module.html), [offizielles PHP-Containerimage](https://hub.docker.com/_/php).
