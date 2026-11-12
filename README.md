# Nepos

**Netzwerke erforschen – Protokolle online simulieren.**

Nepos setzt die Netzwerksimulation Filius als eigenständige Browseranwendung um. Dieses Repository enthält ausschließlich Nepos. Der Webclient arbeitet vollständig lokal; die optionalen Modems verbinden simulierte Ethernetsegmente über echte WebRTC-Datenkanäle. Java wird für die Webvariante nicht benötigt.

## Starten und prüfen

Benötigt Node.js 20.19+ innerhalb der 20er-Reihe oder Node.js ab 22.12 und npm.

```sh
npm ci
npm run dev
# Automatische Prüfungen (einmal Chromium installieren):
npx playwright install chromium
npm run verify
npm test
npm run build
```

`npm test` prüft Anwendung und Tests mit strengem TypeScript und führt anschließend die deterministischen Regressionstests aus. `npm run build` erzeugt `dist/index.html` mit eingebettetem JavaScript, CSS und den SVG-Symbolen. Diese Datei kann über einen statischen Webserver ausgeliefert werden; für WebRTC und Zwischenablage HTTPS oder localhost verwenden. Beispiele liegen zusätzlich in `public/examples/` und werden beim Build mitkopiert.

Installation als statische HTML-Seite, optionales PHP-Signaling und den schlüsselfertigen rootless-nginx/PHP-Container beschreibt [INSTALL.md](INSTALL.md). `npm run test:browser` startet headless Browserprüfungen über einen separaten lokalen Testserver. Testseiten und Testknöpfe werden nicht ausgeliefert.

## Lernnetz ausprobieren

Mit „Laden“ die Datei [`public/examples/lernnetz.json`](public/examples/lernnetz.json) wählen und in den Simulationsmodus wechseln. Das Netz enthält einen Tablet-Client und einen Schulserver am Switch.

- Terminal: `ping 192.168.0.20`, `arp`, `netstat`, `tcpdump -c 5`.
- Web-Browser: `http://web.schule.test/`; auch der Link zur zweiten Seite läuft durch das simulierte Netz.
- Einfacher Client: Schulserver `192.168.0.20`, TCP-Port `55555`.
- E-Mail: vorkonfiguriertes **simuliertes** Lernkonto `schueler@schule.test`, Kennwort `filius`. Nachrichten an dieses Konto senden und mit POP3 abrufen. Die Software versendet keine Internet-E-Mails.

## Bedienung auf Tablets und Smartphones

Gerät in der Palette auswählen und zum Platzieren auf die Arbeitsfläche tippen. Mit „Kabel“ anschließend Start- und Zielgerät antippen. Die Anwendung verwendet freie Anschlüsse und lehnt doppelt belegte Anschlüsse ab. Geräte durch Ziehen verschieben; die freie Fläche verschieben und mit zwei Fingern zoomen. Die Schaltflächen rechts unten verkleinern, passen das gesamte Netz ein oder vergrößern es. Langes Drücken öffnet das Kontextmenü.

Im Simulationsmodus ein Endgerät antippen und „Anwendungen öffnen“ wählen. Auf Tablets füllen Anwendungen die Arbeitsfläche; auf Smartphones öffnet sich die Gerätekonfiguration als unteres Panel. Das Menüsymbol öffnet bzw. schließt dieses Panel. Dateien können durch einfaches Auswählen und „Öffnen“ bedient werden; Doppelklick ist optional. Eigene Eingabedialoge, große Bedienelemente, Tastaturfokus, Safe-Area-Abstände und an die Bildschirmtastatur angepasste Fenster unterstützen Touchgeräte.

Die überprüften Ansichten und Grenzen sind in [`docs/AUDIT.md`](docs/AUDIT.md) aufgeführt. Physische iPad-/Android-Geräte wurden in dieser Umgebung noch nicht geprüft.

## Simulation und Anwendungen

Pakete werden in Schnittstellenwarteschlangen gestellt und über Kabel, Switches und Router transportiert. Fehlende Verbindungen, fehlende Gateways, deaktivierte Weiterleitung, Firewallregeln und abgelaufene DHCP-Leases wirken sich auf die tatsächliche Zustellung aus. Anwendungen kommunizieren über simulierte UDP- bzw. TCP-Sockets, einschließlich Loopback.

Enthalten sind Ethernet/Switch-Lernen, ARP, IPv4-Routing, ICMP/Ping/Traceroute, UDP, TCP-Verbindungsaufbau, Bestätigungen, Wiederholungen und geordneter Verbindungsabbau, NAT/Portweiterleitung, RIP und Router-/Host-Firewalls. WLAN verbindet passende SSIDs entsprechend dem Filius-Modell über virtuelle Ethernetverbindungen; ein freier Anschluss am Switch wird benötigt.

Die Standardanwendungen des Java-Desktops sind vorhanden: Terminal, Bildanzeige, Datei-Explorer, Text-Editor, DNS-Server, E-Mail-Client/-Server, Echo-Server, Einfacher Client, Firewall, Dateiaustausch sowie Web-Browser/-Server. Hinzu kommen ein DHCP-Server und die WebRTC-Modems. DNS unterstützt A, MX, CNAME, NS, PTR und TXT; DHCP verwaltet Angebote, Reservierungen, Erneuerung und Freigabe. Mail verwendet SMTP und POP3, einschließlich tatsächlicher DNS/MX-Weiterleitung. Der Dateiaustausch sucht über verbundene Peers und überträgt echte Dateiinhalte. Router stellen `/routes`, `/log` und `/konfig` über simuliertes HTTP bereit.

Es handelt sich um eine Lehrsimulation mit strukturierten Paketobjekten. Sie ist kein vollständiger binärer Implementierungsnachbau eines Betriebssystem-Netzwerkstacks: Ethernet-/IP-/TCP-Prüfsummen, TCP-Überlastungssteuerung, vollständige TCP-Fensterverwaltung, IP-Fragmentierung und Funkphysik werden nicht modelliert. Erfolgreiche Anwendungszustellung wird nicht durch direkte Aufrufe eines entfernten Dienstes ersetzt.

## Geräteübergreifende Zusammenarbeit

Ein Modem an das lokale Netz anschließen. Im Modemdialog entweder die erzeugten Verbindungsdaten manuell zwischen beiden Geräten austauschen oder einen eigenen Signalisierungsdienst konfigurieren. Danach überträgt der zuverlässige WebRTC-Datenkanal die simulierten Ethernetpakete. Große Nachrichten werden für den Datenkanal zerlegt und wieder zusammengesetzt. Verbindungscodes und aktive Peer-Verbindungen werden nicht als laufende Verbindung wiederhergestellt.

Standardmäßig sind keine externen STUN-/TURN-Dienste voreingestellt. Für unterschiedliche NATs müssen passende ICE-Server selbst konfiguriert werden; je nach Netz ist TURN erforderlich. Diese Einstellungen beziehen sich auf die reale WebRTC-Verbindung. Simulierte Gateway-/NAT-Einstellungen ändern den realen Internetanschluss nicht.

[`server/signaling.php`](public/examples/signaling.php) ist ein optionaler eigener Signalisierungsdienst mit zufälligen 128-Bit-Sitzungskennungen, begrenzten Eingaben, Dateisperren und Ablaufzeit. Er benötigt PHP mit beschreibbarem temporärem Verzeichnis. Der rootless-nginx/PHP-Container wurde mit echtem Offer/Answer-Austausch, Konfliktantworten und Größenlimits geprüft. Bei öffentlichem Betrieb müssen Hosting, Zugriffsschutz, Ratenbegrenzung und eigene TURN-Konfiguration zum Einsatzkontext passen.

## Filius-Dateien (.fls)

„Laden“ akzeptiert `.fls` und `.json`. „Speichern“ öffnet die Wahl des Zielformats; der Speicherdialog enthält den Downloadlink und mögliche Kompatibilitätshinweise. Für JSON steht zusätzlich eine Vorschau zum Kopieren zur Verfügung.

FLS ist ein echtes ZIP-Archiv mit `projekt/konfiguration.xml` im JavaBeans-Format des Originals. Nepos wertet das XML ausschließlich als Daten aus: Java-Klassen, eigene Programme, externe XML-Entitäten oder Code werden nicht ausgeführt. Archive haben Größen-, Struktur-, Pfad- und CRC-Prüfungen.

Der Export enthält außerdem `projekt/nepos.json`. Diese Erweiterung erhält den vollständigen Nepos-Zustand einschließlich WebRTC-, Firewall- und Peer-Einstellungen sowie Projekttitel und Beschreibung. Java-Filius liest die XML-Konfiguration und ignoriert die Erweiterung. Ändert Java diese Konfiguration, verwendet Nepos beim nächsten Import die geänderten Java-Daten statt veralteter Zusatzdaten. Beim erneuten Speichern durch Java kann die Erweiterung entfallen; Nepos-spezifische Eigenschaften bleiben dann nicht erhalten.

Die 14 Originalbeispiele werden bei einem separat vorhandenen Filius als Testmaterial importiert. `npm run test:fls-java` erzeugt daraus FLS-Exporte und prüft die XML-Konfiguration mit dem **echten Java-XMLDecoder und den Filius-Klassen**. Der Zusatztest benötigt Java und eine gebaute Originalversion mit `FILIUS_HOME=/pfad/zu/filius` (Klassen unter `target/classes`, Bibliotheken unter `target/lib`); die Browseranwendung benötigt weiterhin kein Java.

## Speichern und Grenzen

Topologie, Beschriftungen, Dateien, installierte Anwendungen, Dienstkonfigurationen und Mailzustände werden als ein vollständiges Dokument automatisch im Browserspeicher gesichert und lassen sich als Nepos-JSON oder Filius-`.fls`-Projekt exportieren. Laufende TCP-Verbindungen und WebRTC-Sitzungen werden nicht gespeichert. Vorhandene Filius-Web-Speicherstände werden automatisch in das Nepos-Dokumentformat übernommen. Der Entwurfsmodus stoppt Dienste; beim erneuten Simulationsstart werden nur die zuvor laufenden Dienste gestartet. Browser-Speichergrenzen können große Projekte begrenzen; deshalb zusätzlich als Datei speichern.

Ungespeicherte Textentwürfe gehören ebenfalls zum Projekt und werden nach einem Neuladen beim Öffnen des Editors wiederhergestellt. E-Mails werden während des Schreibens als Entwürfe gesichert und sind über „Entwürfe“ wieder zugänglich. Beim Schließen und Wechsel in den Entwurfsmodus schützen „Speichern“, „Verwerfen“ und „Abbrechen“ die offenen Änderungen; dies gilt auch für geänderte Mailkontoeinstellungen.

Unter „Gespeicherte Sicherungen“ können der aktuelle Stand, die vorherige gültige Autosicherung und das Projekt vor dem letzten Ersetzen heruntergeladen werden. Bei einer fehlgeschlagenen Wiederherstellung bleibt das automatische Speichern gesperrt, damit ein leeres Projekt die ursprünglichen Daten nicht überschreibt. Ist eine gültige Sicherung verfügbar, wird sie geladen und kann ausdrücklich weiterverwendet werden. Auch eine fehlgeschlagene Migration wegen Speicherknappheit verhindert nicht das Laden des alten Projekts. Beim Import werden Dienste vor dem Austausch der Arbeitsfläche übernommen und bei einem späteren Fehler zurückgesetzt.

FLS-Exporte mit Nepos-Erweiterungen weisen ausdrücklich auf den möglichen Verlust dieser Zusatzdaten beim erneuten Speichern in Java-Filius hin. Der Nepos-Export selbst erhält sie vollständig. Alle Hinweise, Fehlermeldungen und Rückfragen verwenden eigene Dialoge; native `alert`, `confirm` und `prompt` werden nicht verwendet.

Der Projektimport validiert die Topologie und Dienstzustände vor der Übernahme. Importgrößen, Warteschlangen, Peer-Anfragen und WebRTC-Nachrichten sind begrenzt. Filius-`.fls`-Archive lassen sich importieren und exportieren. Der Konverter liest Geräte, Anschlüsse, Routen, NAT-Portweiterleitungen, Beschriftungen, Dateien, installierte Standardanwendungen sowie DNS-/HTTP-/Mail-/DHCP-Konfigurationen. Java-Erweiterungsprogramme werden nicht ausgeführt. Hinweise zeigen Funktionen an, die in Java und Nepos unterschiedliche Bedeutung haben. Der Gnutella-artige Dateiaustausch ist zwischen Webinstanzen nutzbar, aber nicht drahtformatkompatibel zum Java-Original. Java-spezifische Erweiterungsprogramme sind nicht vorgesehen. Eine vollständige sprachliche Gleichheit aller Oberflächendialoge ist ebenfalls noch nicht erreicht.

## Struktur

- `src/core`: Ereignisse, Simulationszeit und Timer.
- `src/hardware`: Geräte, Schnittstellen, Kabel, SSID-Zuordnung und WebRTC-Modem.
- `src/runtime`: pro Projekt isolierter Simulationskern und Abbruch laufender Protokollarbeit.
- `src/network/NetworkStack.ts`: maßgeblicher paketbasierter Netzwerk- und Transportablauf.
- `src/transport/Socket.ts`: Socket-Schnittstelle für die Anwendungen.
- `src/apps`: simulierte Dienste, Dateisystem und gemeinsame Speichergrenze `Services.ts` (ohne UI-Ansichten).
- `src/scenario`: unabhängige Projekttypen, Importvalidierung, JSON/FLS-Konvertierung und atomarer Projektspeicher.
- `src/scenario/fls`: ZIP-Verarbeitung, sicherer JavaBeans-Datendecoder und Filius-Konverter.
- `src/application`: Anwendungskontext, Projektverwaltung, Modussteuerung und typisierte UI-Ereignisse.
- `src/ui/apps`: die 15 getrennten Anwendungsansichten mit gemeinsamer Lebenszyklus-/Schließen-Schnittstelle.
- `src/ui/config`: getrennte Geräteansichten für Hosts, Switches, Router und Modems.
- `src/ui/ProjectFiles.ts`: Browser-Dateiauswahl, Exportdialog und Kompatibilitätshinweise; `ProjectFileActions` verbindet sie mit der Projektverwaltung.
- `src/ui`: Arbeitsfläche, Anwendungen, Paketansicht, Symbole, Dialoge und Modemsteuerung.
- `tests`: Simulationstests und echter Browser-WebRTC-Test.

Das Projekt folgt den Lizenzbedingungen des separat verfügbaren Filius-Originals: [GPLv2](GPLv2.txt) oder [GPLv3](LICENSE).


## Anwendungsarchitektur und Regressionen

Die Oberfläche bleibt bei TypeScript/DOM; der Build bleibt eine einzelne HTML-Datei. `main.ts` startet lediglich `NeposApplication` mit einem expliziten `ApplicationContext`. Der Koordinator verbindet Arbeitsfläche und Ansichten. `ProjectController` verwaltet Projektmetadaten, Wiederherstellung, Speichersperre und den kontrollierten Austausch eines Projekts ohne DOM-Zugriffe. `SimulationController` übernimmt Moduswechsel, Dienste und DHCP; `ModeControls` stellt den Zustand dar.

`DesktopWindow` ist die Fensterhülle. Die Registry erzeugt pro Anwendung eine `HostApplication` mit eigenem `Lifetime`, Schließen-Prüfung und direkter Dateiübergabe vom Explorer. Eingabedialoge gehören zum jeweiligen Besitzer und werden beim Aufräumen abgebrochen. Listener, Timer, Beobachter und Unteransichten werden abgemeldet; ausstehende Maildomain-Eingaben werden vor einer Speicherung übernommen. Die Paketaufzeichnung liegt im UI-unabhängigen `PacketJournal`; Netzwerkstack, Routerprotokoll und Paketansicht greifen auf dasselbe Journal zu.

`npm test` enthält neben den Simulation-/FLS-Tests zehn Architekturtests für Eigentümerschaft, Ereignisverträge, Fehlerisolation und Projektwechsel sowie 14 Runtime-Regressionen. Diese verwenden gleichzeitig zwei echte paketbasierte Netze mit identischen IDs, IPs und MACs und prüfen außerdem Abbruch, Neustart, WLAN/P2P sowie JSON/FLS-Wiederherstellung. `npm run test:browser` führt die 14 DOM-Abläufe sowie echte lokale WebRTC-Prüfungen und neue Datei-/Undo-/Redo-Tests ohne Benutzer-Testoberfläche aus. Der separate Testserver verwendet ausschließlich eigenen Projektspeicher und wird nach dem Lauf beendet.

`createApplicationContext` erzeugt einen eigenen `SimulationRuntime`: Ereignisbus, Simulationszeit/Timer, Netzwerkstack, Paketjournal, alle Dienstmanager, Dateisysteme, Entwürfe sowie IDs und Gerätenamen. Geräte, Anschlüsse und Kabel erhalten diesen Besitzer ausdrücklich; Sockets und Dienste beziehen ihre Abhängigkeiten vom Gerät. Topologien und Kabel aus unterschiedlichen Projekten werden abgewiesen. Beim Projektwechsel werden offene Protokollvorgänge und Timer abgebrochen; nach `dispose` können Uhr und Sockets nicht wieder starten. Mehrfaches Stoppen erhält die Aktivierung der Dienste für den nächsten Start.

Die bisher exportierten Standardinstanzen bleiben als expliziter `LegacyRuntime`-Adapter für eigenständige Beispiele und ältere Tests erhalten. Die produktive Anwendung und die neuen parallelen Simulationen verwenden ihn nicht. Gemeinsame Spracheinstellungen und Fensteranordnung sind weiterhin UI-Einstellungen.

Der echte WebRTC-Browsertest verbindet jetzt zwei getrennte Runtime-Instanzen. Er prüft ARP/ICMP, große Unicode-TCP-Daten, Pause/Fortsetzen, getrennte Journale und Abbruch eines laufenden Verbindungsaufbaus. Die automatische Internet-Signalisierung gehört zum Modem; Entfernen oder Aufräumen des Geräts bricht offene Anfragen und Wartezeiten ab. Das Schließen der Konfigurationsansicht beendet eine gewünschte Verbindung nicht.


## Dateien und Entwurfsverlauf

Uploads erhalten sämtliche Bytes, auch ungültiges UTF-8 und Byte-Order-Marks. Binärdateien lassen sich verlustfrei herunterladen, kopieren, verschieben und über JSON/FLS in Nepos wiederherstellen; der Texteditor verhindert versehentliches Bearbeiten ihrer Kodierung. Namenskonflikte benötigen eine ausdrückliche Bestätigung. Dateien dürfen beim Upload bis zu 16 MiB umfassen; Browser-Speichergrenzen gelten zusätzlich.

Rückgängig/Wiederholen erfasst Geräte, Kabel, Beschriftungen, Gerätekonfiguration und Projektmetadaten im Entwurfsmodus. Gelöschte Geräte werden einschließlich gespeicherter Anwendungen und Dateien wiederhergestellt. Tastatur: Strg/⌘ Z, Strg/⌘ Umschalt Z oder Strg Y. Texteingaben behalten ihr eigenes Rückgängig. Der Verlauf ist auf 50 Schritte beziehungsweise 32 MiB begrenzt und beginnt bei Projektwechsel und Simulationsstart neu. Unveränderte Modemverbindungen bleiben beim Rückgängigmachen anderer Entwurfsänderungen erhalten; eine gelöschte aktive Sitzung lässt sich nur neu verbinden.
