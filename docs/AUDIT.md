# Nepos – Analyse und Prüfstand

Stand: 13. Oktober 2026. Referenz ist die Java-Codebasis im Elternordner, insbesondere die Hardware-/Netzwerkschichten und `src/main/resources/config/Desktop_de_DE.txt`. Der Arbeitsstand ist eine umfassende Überarbeitung mit überprüften Kernabläufen. Eine Garantie für Fehlerfreiheit, völlige Schuldenfreiheit oder sämtliche Browser-/Gerätekombinationen folgt daraus nicht.

## Behobene Schwächen

| Bereich | Problem und Umsetzung |
|---|---|
| Pakettransport | Direkte Zustellungen und vereinfachte Erreichbarkeitsabkürzungen durch Schnittstellenwarteschlangen, Kabeltransport, ARP, Switch-Lernen und Routerentscheidungen ersetzt. |
| TCP | Verwechslung von Nutzdaten und Steuerworten, fehlende Wiederholungen und Clientkollisionen behoben; eigene Verbindungen, Sequenznummern, Bestätigungen, Zeitüberschreitungen und verlusttoleranter FIN-Abbau. |
| Routing | Gateway-/ARP-Auflösung, TTL-Fehler und Rückpfade wirksam; NAT, Portweiterleitung, RIP-Ablauf und CIDR-Firewallregeln greifen im echten Paketablauf. |
| Zeit | Protokolltimer verwenden Simulationszeit; Pause hält Paketzustellung und zugehörige Zeitüberschreitungen an. |
| DHCP | Gleichzeitige Angebote reservieren unterschiedliche Adressen; ausgewählter Server, Absender und Lease werden geprüft. Erneuerung, Freigabe, Abbruch und Adressentzug bei Ablauf. |
| DNS/HTTP | Netzwerkgebundene Anfragen, Alias-/Delegationsbegrenzungen und TTL-Cache; UTF-8-Längen, eigene Ports, Fehlerstatus, Pfadprüfung und Abbruch. Webressourcen und Seitennavigation laufen durch den simulierten Client. |
| Mail | SMTP-Empfängerfehler, MX-Auflösung und echte Weiterleitung; auch entfernte Zustellfehler laufen über SMTP statt globaler Postfachsuche. POP3 nummeriert ab 1, sperrt Postfächer, setzt abgebrochene Löschungen zurück und löscht erst bei QUIT. |
| Dateiaustausch | Tatsächliche Suche über Peer-Verbindungen, Antworten über Rückpfade und Übertragung vorhandener Dateien über TCP. |
| Persistenz | Ein atomar gespeichertes, validiertes Nepos-Projektdokument mit Migration alter Browserstände; gemeinsame Diensteverwaltung, Wiederherstellung der Dateien vor Diensten, Erhalt gestoppter Dienste, tatsächlich wirksame Deinstallation und Konfigurationsrücksetzung. |
| Import | JSON sowie echte Filius-ZIP/XML-Dateien mit CRC-, Pfad- und Größenprüfung; sicherer Datendecoder ohne Ausführung von Java-Klassen. Schema-, Adress-, Anschluss-, Dienst- und Dateibaumprüfung vor Topologieübernahme; ungültige doppelt belegte Anschlüsse verändern das aktuelle Projekt nicht. |
| Modems | Echte geordnete WebRTC-Datenkanäle erhalten; eindeutige IDs, Nutzlastzerlegung, Grenzen, Verbindungs-/Signalisierungstimeouts und Schutz vor veralteten asynchronen Antworten. |
| Oberfläche | Einheitliche SVG-Geräte-/Anwendungssymbole, hochauflösende Arbeitsfläche, Touchbedienung, vergrößerte Bedienelemente, Vollbildanwendungen und Smartphonepanel. Native Eingabedialoge durch zugängliche Touchdialoge ersetzt. Mobile Ordnerleiste der Mailansicht korrigiert. |
| Wartbarkeit | Ungenutzte Protokollattrappen und Vorlagendateien entfernt; Modemsteuerung, Dialoge, Symbole und Dienstlebenszyklus ausgelagert; Anwendung und Tests unter striktem TypeScript. |

## Abgleich der Standardanwendungen

Die 13 Einträge des Java-Desktopkatalogs besitzen Implementierungen in der Webvariante. „Vorhanden“ bedeutet keine automatische Gleichheit jedes einzelnen Dialogs oder Randfalls.

| Java-Funktion | Webumsetzung / Prüfung |
|---|---|
| Befehlszeile | Terminal mit paketbasiertem Ping, Traceroute, ARP, Arpsend, Netstat und Live-Tcpdump; Dateibefehle einschließlich cp/mv und Windows-Aliasen getestet. |
| Bildbetrachter | Dateien aus dem simulierten Dateisystem anzeigen; lokale Bilddateien können über den Explorer geladen werden. |
| Datei-Explorer / Text-Editor | Gemeinsames Dateisystem; Anlegen, Lesen, Kopieren, Verschieben und Umbenennen; Unicode und gespeicherte Dateibäume geprüft. Smartphone-Anlegen/Umbenennen/Kopieren/Bearbeiten manuell geprüft. |
| DNS-Server | UDP, A/MX/CNAME/NS/PTR/TXT; geroutete Abfragen, Aliasauflösung, Delegation und MX-Nutzung geprüft. |
| E-Mail-Programm / E-Mail-Server | SMTP/POP3, Konten, Postfächer, Weiterleitung und Zustellfehler; Authentifizierung, Empfängerfehler, Abruf und Transaktionslöschung getestet. Versand/Abruf zusätzlich auf Smartphonegröße geprüft. |
| Echo-Server / Einfacher Client | Echte TCP-Sockets und Echo-Nutzlast; mehrere Clients und Steuerwort-ähnliche Daten im Transporttest. |
| Firewall | Host-Portfreigaben und Routerregeln; Erstanfragen, Antworten, Ports und CIDR-/0-Regeln geprüft. |
| Gnutella | Gnutella-artiger Peer-Dateiaustausch; Suche über Zwischenpeer und tatsächlicher Download getestet. Eigenes Webprotokoll. |
| Webserver / Webbrowser | HTTP über simuliertes TCP; DNS, Unicode, eigene Ports, Fehler, Dateien und Loopback getestet. Browseransicht und Linknavigation zusätzlich über UI geprüft. |

Hardware: PC/Notebook, Switch, Router und Kabel; WLAN/SSID-Zuordnung transportiert tatsächliche Ethernetframes. Router-Webverwaltung `/routes`, `/log`, `/konfig` einschließlich POST-Konfiguration ist getestet. WebRTC-Modems und der zusätzliche DHCP-Server bleiben erhalten. Beschriftungen, Projektdateien, automatisches Speichern und PNG-Ausgabe sind vorhanden.

## Nachweise

`npm test`: **39 bestandene Simulationstests plus Projekt-/FLS-Prüfungen**, einschließlich TypeScript-Prüfung aller Quellen und Tests. Die Tests treiben die Simulationszeit explizit voran und prüfen sowohl erfolgreiche Zustellung als auch Fehler: fehlende Kabel/Gateways, abgeschaltete Weiterleitung, Firewall, Paketverlust, unterbrochene Verbindungen, abgelaufene Routen/Leases, ungültige Imports und Mailfehler. Ein absichtlich getrennter SMTP-Pfad erzeugt im negativen Test eine erwartete Zeitüberschreitung im Log.

`npm run build`: erfolgreich; ein eigenständiges HTML-Bundle von rund **446 kB**, komprimiert rund **118 kB**. Gebaut mit den im Lockfile festgehaltenen Abhängigkeiten.

`/tests/browser.html`: fünf bestandene Prüfungen mit echten lokalen WebRTC-Peers: Kanalaufbau, ARP/ICMP, große Unicode-TCP-Nutzlast, Pause und Fortsetzen. [Screenshot](webrtc.jpg).

Browser-UI-Prüfung im Codex-Browser:

- Tablet 1024 × 768: Netzwerkeinpassung, Geräteauswahl, Anwendungsstart und HTTP-Seitenabruf mit DNS/Linknavigation.
- Smartphone 390 × 844: Arbeitsfläche und Menü, Dateierzeugung/Umbenennung/Kopie/Editor-Speicherung, E-Mail-Verfassen/SMTP-Zustellung/POP3-Abruf. Querformat 844 × 390: Maildetail und Fenstergrenzen geprüft. Kein horizontaler Seitenüberlauf bei diesen Ansichten; neuer Eingabedialog und Mailordnerleiste nach Befund korrigiert.
- Screenshots: [Tablet](tablet.jpg), [Anwendungssymbole](tablet-apps.jpg), [Smartphone](smartphone.jpg), [Dateibearbeitung](smartphone-editor.jpg), [E-Mail](smartphone-mail.jpg).

Diese Prüfungen emulieren Ansichtsgrößen; sie sind kein Nachweis für echte Mehrfingereingaben, Bildschirmtastaturen oder sämtliche Safari-/Android-Versionen.

## Offene Grenzen und nächste Prüfungen

1. **Java-Dateiformat:** FLS-Import und -Export sind implementiert und mit den 14 mitgelieferten Originalprojekten geprüft. Nepos-spezifische Funktionen werden in einer Archiv-Erweiterung erhalten. Java-Erweiterungsprogramme werden nicht ausgeführt; Funktionen mit abweichenden Java-/Nepos-Eigenschaften erzeugen Hinweise. Änderungen oder erneutes Speichern durch Java können Nepos-Zusatzdaten entfernen. Weitere Archive außerhalb dieses Beispielbestands brauchen zusätzliche Kompatibilitätstests.
2. **Modellumfang:** Strukturierte Paketobjekte, kein vollständiger binärer TCP/IP-Stack. Nicht modelliert sind Prüfsummen, vollständige TCP-Fenster-/Überlastungssteuerung, IP-Fragmentierung und Funkphysik. Der Peer-Dateiaustausch ist nicht Java-Gnutella-drahtformatkompatibel.
3. **Reale Geräte/Internet:** Tests auf physischem iPad/Android einschließlich Tastatur, Multitouch und langer Arbeitssitzungen stehen aus. WebRTC muss zusätzlich zwischen physischen Geräten, verschiedenen NATs und einem tatsächlich eingesetzten TURN-Dienst geprüft werden.
4. **Signalisierungsdienst:** Das PHP-Beispiel wurde statisch überarbeitet, aber mangels PHP-Runtime nicht ausgeführt. Öffentlicher Mehrbenutzerbetrieb benötigt einen passend abgesicherten und belastungsgeprüften Dienst.
5. **Weitere technische Schulden:** Oberfläche und Anwendungen sind inzwischen in getrennte Ansichten, Projekt-/Moduscontroller, einen expliziten Anwendungskontext und gemeinsame Lebenszyklen aufgeteilt (Details unten). Die vollständige Isolation der gemeinsamen Protokoll-/Dienstinstanzen bleibt ein eigener Schritt. Vollständige Lokalisierung, weitere UI-Randfälle sowie Fuzz-/Langzeittests für Importvalidierung und Protokollzustandsautomaten bleiben offen. Begrenzte Warteschlangen und Dateien grenzen sehr große Simulationen ein.

Die Anforderung „keine technischen Probleme oder Schulden“ und uneingeschränkte Originalparität ist deshalb noch nicht abschließend erfüllt. Die oben genannten Grenzen werden ausdrücklich sichtbar gehalten.

## Folgeüberarbeitung: Nepos, FLS und Architektur

Die Oberfläche, Browserfenstertitel und Paketmetadaten heißen **Nepos**. Der Untertitel „Netzwerke erforschen – Protokolle online simulieren.“ steht in Metadaten und Dokumentation; er beansprucht keinen Platz in der Oberfläche. Die Formatwahl liegt im Speicherdialog.

`ProjectCodec` konvertiert und validiert Daten ohne DOM-/Speicherzugriff. `ProjectFiles` übernimmt Dateiauswahl und Exportdialog; `ProjectStore` speichert einen vollständigen Projektzustand mit einer atomaren Browser-Speicheroperation. `ScenarioManager` konstruiert die Topologie und hat keine Browser-Datei-/Speicherzugriffe mehr. `ScenarioTypes` hält die gemeinsamen Datenverträge. Der FLS-Konverter ist in ZIP-Verarbeitung, JavaBeans-Datendecoder und Import-/Exportabbildung aufgeteilt.

Der DHCP-Dienst kann jetzt auf einem Router am ausgewählten Interface laufen. Ein Test prüft LAN-Zustellung, Ausschluss von WAN-Broadcasts und Wiederherstellung. Dies erhält den DHCP-Dienst des importierten Java-Heimrouters.

Zusätzliche Nachweise:

- Alle 14 Originalbeispiele werden als FLS gelesen und vor Übernahme validiert.
- Die Exporte dieser 14 Projekte, ein zusätzliches Unicode-/Steuerzeichenprojekt und die tatsächlich im Browser heruntergeladene FLS-Datei werden vom echten Java-XMLDecoder mit den gebauten Filius-Klassen ohne Decoderfehler eingelesen. Geräte, tatsächlich verbundene Kabel, Beschriftungen und Mailadressobjekte werden geprüft (`npm run test:fls-java`).
- Nepos-Zustände überstehen FLS-Rundreisen vollständig; die Java-Konfiguration wird auch ohne Nepos-Zusatzdaten geprüft. Veraltete Erweiterungen nach XML-Änderung, beschädigte ZIP-Daten, externe XML-Entitäten und unzulässige Klassenoperationen sind abgedeckt.
- Der Export tatsächlicher Dienstzustände mit absoluten Webdateipfaden ist getestet.
- Browser: `webserver.fls` importiert; Originalseite mit `200 OK` und vorhandenem PNG über das simulierte Netz geladen. FLS über den Speicherdialog heruntergeladen, tatsächlich gespeichertes ZIP geprüft, wieder importiert und nach Seitenneuladen erhalten. Der zuvor gesicherte Browser-Projektstand wurde danach wiederhergestellt.
- Neuer Speicherdialog auf 390 × 844 geprüft. [Exportdialog](nepos-export.jpg), [Original-FLS-Webseite](nepos-fls-http.jpg), [Smartphone-Export](nepos-mobile-export.jpg).
- Nach den Architekturänderungen bestehen erneut alle fünf Browserprüfungen mit echten WebRTC-Peers. [WebRTC-Nachweis](nepos-webrtc.jpg), [Nepos auf Tabletgröße](nepos.jpg).

## Gerätebilder und Schließen-Bedienung

- Switches mit einer aktivierten WLAN-Zuordnung eines Endgeräts zur jeweiligen SSID erscheinen als Accesspoint. Eine SSID allein reicht nicht, weil auch kabelgebundene Switches bisher eine Standard-SSID besitzen. Die Darstellung wechselt ohne Änderung des Gerätemodells; die eigenen Gerätenamen bleiben erhalten. Der PNG-Export verwendet jetzt dieselbe Symbolauswahl wie die Arbeitsfläche (zuvor griff er auf falsche Bildschlüssel zu). [Accesspoint und Notebook](accesspoint-tablet.jpg).
- Das Notebook-Symbol zeigt einen Bildschirm ohne Richtungspfeil.
- `DismissButton` liefert eine gemeinsame runde Schaltfläche mit 44 × 44 Pixeln, zugänglicher Beschriftung und sichtbarem Tastaturfokus. Sie liegt außerhalb der Werkzeugleisten und scrollbaren Inhalte. Die Fensterüberschrift reserviert ihren Platz; Dialoge scrollen nur ihren Inhalt. Anwendungen und Mail-Unteransichten nutzen eine zentrale Schließen-Aktion, statt eigene Schließen-Buttons in ihren Symbolleisten zu erzeugen. Auch Paketansicht, Projekt-/Eingabedialoge und Router-Konfigurationsdialoge verwenden diese Darstellung.
- Browserprüfung: Alle 15 Anwendungen auf 1024 × 768 geöffnet und über die zentrale Schaltfläche zum Desktop zurückgekehrt; jeweils genau eine Schaltfläche ohne Überschneidung mit dem Anwendungsinhalt. Auf 390 × 844 Mail-Verfassen, Einstellungen und Nachrichtendetail geschlossen, Eingabedialog abgebrochen sowie Paketansicht und Speicherdialog geprüft. Kein horizontaler Seitenüberlauf in der geprüften Mail-Verfassen-Ansicht. Der Projektstand vor den temporären WLAN-/Anwendungstests wurde anschließend aus der UI-Sicherung wiederhergestellt. [Tablet-Editor](close-overlay-tablet.jpg), [Smartphone-Mail](close-overlay-smartphone.jpg), [Speicherdialog](close-overlay-dialog.jpg).
- `npm test` und `npm run build` bestehen nach diesen Änderungen; 39 Simulationstests und die vorhandenen FLS-/Projektspeichertests, Bundle rund 445 kB / 118 kB komprimiert.


## Datensicherheit, Router-TCP und eigene Hinweise

Die priorisierte Folgearbeit behebt die konkret gefundenen Datenverlust- und Transportfehler. Der große Umbau von `main.ts` und `DesktopWindow.ts` bleibt ein eigener Folgeschritt. Vollständige Java-Funktionsgleichheit ist kein Abnahmekriterium; wichtig sind echte Paketabläufe, der Erhalt vorhandener Nepos-Funktionen und transparente Formatgrenzen für den Schuleinsatz. Zusätzliche TCP-/Funkmodellierung wird ohne konkreten Unterrichtsbedarf nicht ausgebaut.

- Texteditor: zentrale Schließen-Prüfung und Prüfung vor dem Modus-/Projektwechsel; Speichern, Verwerfen oder Abbrechen. Ungespeicherte Tabs werden einschließlich Inhalt im Projekt gespeichert, über JSON/FLS erhalten und beim erneuten Öffnen wiederhergestellt. Fehlgeschlagene Dateischreibvorgänge markieren Dateien nicht als gespeichert. Beim Schließen eines Tabs wird der Text des Nachbartabs nicht mehr überschrieben.
- Mail: automatische Entwürfe während der Eingabe, zugänglicher Entwurfsordner, Bearbeiten vorhandener Entwürfe, explizites Speichern/Verwerfen und Löschung des Entwurfs nach erfolgreichem Versand. Geänderte Konto-Einstellungen erhalten ebenfalls eine Schließen-Prüfung; ungültige Ports werden abgewiesen.
- Projektspeicher: vorherige gültige Version vor atomarem Austausch, separate Sicherung vor bewusstem Projektwechsel, Erhalt beschädigter Rohdaten und alter Speicherfragmente. Ein fehlgeschlagener Migrationsschreibvorgang verhindert nicht das Laden gültiger Altdaten. Wiederherstellungsfehler sperren automatisches Speichern einschließlich `pagehide`; kein stilles Überschreiben durch ein leeres Projekt. Sicherungen sind im Projektbereich zugänglich und können als Dateien gesichert werden.
- Import: Dateidatum, MIME-Typ, Dateisystemwurzel, Webdateipfade und Editorentwürfe werden vor der Übernahme geprüft. Kandidaten verändern den aktiven `ScenarioManager` erst nach erfolgreicher Übernahme. Dienste besitzen eine Rücksetzung auf den vorherigen vollständigen Zustand bei einem späteren Wiederherstellungsfehler. Die alte Arbeitsfläche wird erst danach ausgetauscht; alte Geräteeinstellungen werden abgewählt. Identische Webdateien werden nicht erneut geschrieben, damit ihre Änderungsdaten erhalten bleiben.
- Router-TCP: SYN, Datenwiederholungen und FIN wählen den Anschluss anhand der Zielroute. Eine gebundene Quell-IP bleibt erhalten, auch wenn die Zielroute über einen anderen Anschluss führt. Neue Pakettests prüfen HTTP nach verlorenem Antwortsegment, aktive TCP-Verbindungen und einen verlorenen FIN an Anschluss 1 sowie Quelladressbindung über einen anderen Anschluss.
- FLS: konkrete Kompatibilitätshinweise bei WebRTC, Peer-Konfiguration, erweiterten/deaktivierten Firewallregeln, abweichenden Router-/DHCP-Einstellungen, nicht abbildbaren Anwendungen, Beschreibung und Textentwürfen. Der Exportdialog erklärt zusätzlich, dass die Daten in Nepos erhalten bleiben, aber bei erneutem Java-Speichern entfallen können. JSON ist eine zusätzliche vollständige Sicherungsmöglichkeit.
- Native Browser-Alerts vollständig aus `web/src` entfernt. Eigene Dialoge verwenden denselben runden Schließen-Overlay, Escape als Abbruch und Textknoten für Fehlermeldungen.

Nachweise: `npm test` besteht mit **42 Simulationstests**, allen **14 Original-FLS-Beispielen** sowie Codec-, Speicher-, Rücksetzungs- und Entwurfstests. Speicherknappheit, beschädigte aktuelle Speicherung, unveränderte Rohdaten, ein absichtlich später Dienstfehler und der Erhalt der Sicherung vor Projektwechsel sind gezielt geprüft. `npm run test:fls-java` besteht für die 14 Beispiele und das Unicode-Projekt. `npm run build` besteht unter strengem TypeScript; Einzeldatei rund 458 kB / 122 kB komprimiert.

Browsernachweise: Schließen abbrechen erhält Text; Moduswechsel abbrechen erhält den geöffneten Editor; Seitenneuladen erhält Text- und E-Mail-Entwürfe; Speichern beim Schließen schreibt die tatsächliche Textdatei; Schließen des zweiten Tabs erhält den Inhalt des ersten. Import mit ungültigem Dateidatum wird vor Übernahme abgewiesen und erhält Geräte, Kabel und die vorhandene Textdatei. Eigener Fehlerdialog für ungültigen Mailport und Schutz der Kontoeinstellungen geprüft. Der ursprüngliche Browser-Projektstand wurde nach allen temporären Tests wieder aus der vorher angelegten UI-Sicherung geladen. [Schließen-Prüfung](save-changes-dialog.jpg), [Exporthinweis](export-compatibility.jpg), [Eigener Hinweisdialog](custom-notice-dialog.jpg), [Sicherungen](project-recovery.jpg).


## Architekturumbau von Oberfläche und Anwendung

Die vereinbarte Variante behält TypeScript/DOM und den Einzeldatei-Build bei. Projektverwaltung, UI-Zuständigkeiten und Lebenszyklus wurden umgebaut; die vollständige Isolation des Simulationskerns bleibt separat.

| Grenze | Ergebnis |
|---|---|
| Start / Zusammensetzung | `main.ts` umfasst 12 Zeilen und startet `NeposApplication` mit `ApplicationContext`. Der Koordinator bündelt die Arbeitsflächeninteraktion; Metadaten, Dateiformate und Anwendungen liegen außerhalb. |
| Projekt | `ProjectController` kennt keine DOM-Elemente. Metadaten und der ursprüngliche Projektzeitpunkt liegen im Zustand; Wiederherstellung, Speichersperre, Vorher-Sicherung, Schließen-Prüfung und Austausch sind über Schnittstellen prüfbar. Eine laufende Übernahme blockiert konkurrierende Übernahmen. |
| Modus | `SimulationController` koordiniert Dienste, Topologie und DHCP. `ModeControls` zeichnet die Bedienoberfläche. Ein Generationenzähler verhindert die Übernahme veralteter DHCP-Antworten nach einem Wechsel. |
| Desktop | Die Fensterhülle `DesktopWindow` wurde von 2.728 auf rund 235 Zeilen reduziert. Registry und Anwendungsansichten besitzen klar benannte Mount-/Flush-/Schließen-/Dispose-Schritte. |
| Anwendungen | Alle 15 Anwendungen haben eigene Module unter `ui/apps`. Der Software-Assistent und der App-Katalog gehören jetzt zur UI. Editor und Bildbetrachter erhalten Dateipfade direkt als Navigationsargument; der `localStorage`-Umweg ist entfernt. |
| Gerätekonfiguration | Host-, Switch-, Router- und Modemansichten unter `ui/config`, mit eigenen Lebenszyklen. Router-Dialoge werden mit ihrer Ansicht geschlossen. Bestehende WebRTC-Steuerung bleibt erhalten. |
| Ereignisse | UI-Ereignisse haben einen typisierten Vertrag. Der Anwendungskontext übergibt Dienstzugriffe ausdrücklich. Die Ansichten importieren keine globalen Dienstmanager. |
| Aufräumen | `Lifetime` besitzt Listener, Timer, Beobachter und Unteransichten. Abbruch ist idempotent, fehlgeschlagene Aufräumaktionen verhindern die übrigen Aktionen nicht. Dialoge erhalten den Abbruch des Besitzers; Mail-/Peer-/Echo-Beobachter werden abgemeldet. |
| Paketaufzeichnung | `PacketJournal` ist ohne DOM nutzbar. Netzwerkstack und Routerprotokoll importieren keine UI. Fehler einer Paketansicht unterbrechen weder die Aufzeichnung noch andere Abonnenten. Echte Nutzdaten wie „SYN“ bleiben in der Anzeige sichtbar; TCP-Header/TTL bleiben im Journal erhalten. |

Die Regressionen haben zusätzlich zwei Lebenszyklusfälle abgesichert: Aufräumen während laufender Simulation setzt den Modus und die CSS-Anzeige zurück; eine noch ausstehende Maildomain-Eingabe wird vor dem Erfassen des Projekts übernommen. Bei ausdrücklich fortgesetzter Wiederherstellung zeigt die Oberfläche wieder aktiviertes Speichern an.

Nachweise:

- `npm test`: **42 Simulationstests**, alle **14 Original-FLS-Beispiele**, vorhandene Codec-/Speichertests sowie **10 neue Architekturtests**.
- **13 automatische Browser-Regressionen**: alle 15 Ansichten dreimal montiert und aufgeräumt, ohne zusätzliche Ereignisabonnements; abgemeldete Editor-Listener verändern Entwürfe nicht; Besitzerabbruch schließt offene Rückfragen ohne Verwerfen; direkte Explorer-Dateiübergabe; Save/Cancel und Tabwechsel; Mailentwürfe; Portfehlerdialog; verzögerte Maildomain; Paketansicht; zweimaliger Gesamtstart mit Moduswechsel/Aufräumen, auch aus laufender Simulation; Wiederherstellung mit Erhalt beschädigter Rohdaten. [UI-Regressionen](architecture-browser-tests.jpg).
- Alle **fünf echten WebRTC-Prüfungen** bestehen nach dem Umbau. [WebRTC](architecture-webrtc.jpg).
- UI bei gemessenen **1024 × 768** und **390 × 844** geprüft. Über die ausgelagerte Browseransicht wird `http://web.schule.test/` mit `200 OK` über das simulierte Netz geladen; die Paketansicht zeigt den tatsächlichen ARP-/DNS-/TCP-Ablauf. [Tablet-HTTP](architecture-tablet-http.jpg), [Smartphone-Mail](architecture-smartphone-mail.jpg).
- Das im Browser gespeicherte Nutzerprojekt wurde vor den UI-Prüfungen gesichert und anschließend über den tatsächlichen JSON-Export verglichen: inhaltlich unverändert (ausgenommen neu gesetztes Exportdatum), weiterhin vier Geräte und drei Kabel. Temporäre Testtabs wurden geschlossen; der Viewport wurde zurückgesetzt.
- `npm run test:fls-java`: 14 Originalbeispiele und Unicode-Projekt werden vom echten Java-Decoder gelesen. `npm run build` besteht; rund **468 kB / 127 kB** komprimiert, ohne zusätzliche Abhängigkeiten.

Zum Abschluss dieses UI-Umbaus war die Isolation des Protokoll-/Socket-Runtimes noch offen. Sie wurde im folgenden Schritt umgesetzt. Weiterhin offen bleiben vollständig lokalisierte Oberflächentexte und weitergehende Langzeit-/Fuzz-Prüfungen.


## Projektgebundener Simulationskern und Datei-Explorer (14.10.2026)

`SimulationRuntime` besitzt Ereignisbus, Simulationsuhr und Timer, Netzwerkstack, Paketjournal, Dienstmanager, Dateisysteme, DHCP-Clients, Editorentwürfe sowie ID-/Namensgeneratoren. Die Anwendung erzeugt eine eigene Instanz. Geräte und Anschlüsse erhalten denselben Besitzer; Kabel und Topologien dürfen keine fremden Geräte übernehmen. Sockets, Terminal, DNS/DHCP, Web, Mail, Echo, Peer und Routerverwaltung beziehen Dienste aus diesem Besitzer. Der `LegacyRuntime`-Adapter erhält die älteren eigenständigen Test-/Beispielzugriffe; er ist kein gemeinsamer Zustand der produktiven Projektinstanzen.

Offene DNS-, HTTP-, SMTP-, POP3-, Peer- und Terminalvorgänge werden vor Stop/Projektwechsel beendet. Die Simulationsuhr entfernt auch im bereits gestoppten Zustand ausstehende Timer. Generationenprüfungen verhindern neue Abfragen nach veralteten asynchronen Fortsetzungen. Entfernte Modems beenden Datenkanal, ICE-/Verbindungsaufbau und automatische Signalisierung. Ein expliziter Abbruch umfasst auch native WebRTC-Promises, die nach dem Schließen eines PeerConnections sonst offen bleiben können. Mehrfaches Stoppen erhält die zuvor aktivierten Dienste. Dispose ist idempotent, entfernt Beobachter und Verbindungen und verhindert neue Uhr-/Socket-Aktivität.

Datei-Explorer: Enter bestätigte vorher den ersten Submit-Button „Abbrechen“. Dieser ist jetzt eine ausdrückliche Abbruchaktion; OK ist die einzige Submit-Aktion. Namen werden geprüft, Fehler werden im eigenen Dialog angezeigt, und das Anlegen überschreibt keine vorhandenen Inhalte. Die Ordnererstellung folgt denselben Regeln. Datei-/Ordnererstellung wurde zusätzlich bei gemessenen 1024 × 768 und 390 × 844 geprüft. Neu gerenderte Dateilisten räumen ihre Listener auf; die Aktionsleiste erhält in schmalen Fenstern ihre Touch-Ziele durch Umbruch und Scrollen.

Nachweise:

- `npm test`: **42 vorhandene Simulationstests**, **10 Architekturtests**, alle **14 Original-FLS-Beispiele** und bestehende Codec-/Speichertests sowie **14 neue Runtime-Regressionen**. Zwei gleichzeitig laufende Netze mit gleichen IDs/IPs/MACs bleiben getrennt: ICMP/ARP, geroutetes DNS/HTTP, unterschiedliche DHCP-Leases, SMTP/POP3, Dateien/Entwürfe, WLAN und Peer-Downloads. Weitere Fälle prüfen offene Vorgänge beim Stop, verspätete DNS-Fortsetzungen, Projektwechsel mit wiederverwendeten IDs, mehrfaches Stoppen/Neustart, Dispose und vollständige JSON/FLS-Wiederherstellung in einem anderen Runtime.
- **14 Browser-Regressionen** bestehen mit eigenen Projektinstanzen. Neu geprüft sind Dateierstellung in einem Unterordner, Unicode-Namen, ungültige Namen, Erhalt vorhandenen Inhalts und Ordnererstellung. [UI-Regressionen](runtime-ui-tests.jpg).
- **7 echte WebRTC-Prüfungen** verbinden zwei getrennte Runtime-Instanzen, einschließlich großer Unicode-TCP-Übertragung, Pause/Fortsetzen, eigener Journale und Dispose während Verbindungsaufbau. [WebRTC](runtime-webrtc-tests.jpg).
- Eine Datei wurde im Browser tatsächlich durch Namenseingabe und **Enter** angelegt. Der Nachweis verwendet ausschließlich den temporären Test-Projektspeicher. [Datei-Explorer](runtime-file-explorer.jpg), [Smartphone](runtime-smartphone-explorer.jpg).
- `npm run test:fls-java`: alle 14 Originalbeispiele und das Unicode-Projekt bestehen mit dem echten Java-Decoder. `npm run build` besteht unter strengem TypeScript: rund **482 kB / 128 kB** komprimiert, ohne zusätzliche Abhängigkeiten.

Die geprüften Browser-Modems verwenden einen echten lokalen WebRTC-Kanal. Externe Signalisierungsserver und NAT/TURN-Netzkonstellationen erfordern weiterhin Tests mit den beteiligten Geräten. Die vereinbarten schulischen Modellgrenzen bleiben erhalten; es wurden keine zusätzlichen physikalischen Funk-/TCP-Modelle eingeführt.

## Dateisicherheit, Entwurfsverlauf und automatische Prüfung (14.10.2026)

Uploads erhalten sämtliche Bytes einschließlich BOM und ungültigem UTF-8. Kodierung und MIME-Typ bleiben im Dateisystem, in JSON/FLS und beim echten Peer-Download erhalten. Download gibt die ursprünglichen Bytes zurück. Kopieren, Verschieben, Umbenennen und Upload fragen vor dem Ersetzen einer Datei; die Grundoperationen verweigern Überschreiben ohne ausdrückliches Argument. Ordnerkonflikte werden abgewiesen. Geschlossene Ansichten und entfernte Zielordner erhalten keine verspäteten Uploads; Binärdateien werden im Texteditor geschützt. Uploadgrenze: 16 MiB je Datei.

Der Entwurfsverlauf erfasst Geräte, Kabel, Beschriftungen, Einstellungen und Metadaten. Gelöschte Geräte werden mit gespeicherten Anwendungen und Dateien wiederhergestellt. Ein begrenzter Verlauf mit 50 Schritten/32 MiB verhindert unbegrenztes Speicherwachstum. Simulationsstart und Projektwechsel beginnen einen neuen Verlauf, sodass spätere Simulationsergebnisse und Dateien nicht versehentlich durch alte Entwurfsschritte überschrieben werden. Unveränderte Modems bleiben bei anderen Undo-Operationen als laufende Objekte erhalten. Löschen trennt die zugehörigen Anschlüsse korrekt. Texteingaben und offene Dialoge behalten ihr eigenes Rückgängig.

Die bisherigen Benutzer-Testseiten und die alte öffentliche WebRTC-Diagnoseseite sind entfernt. `npm run test:browser` führt die Prüfungen headless auf einem separaten lokalen Testserver aus. `npm run verify` verbindet Kernprüfungen, Browser und Einzeldatei-Build. Neben 42 Netzwerk-, 10 Architektur- und 14 Runtime-Tests bestehen sechs gezielte Datei-/Verlaufsprüfungen. Vier Browserfälle enthalten die 14 bisherigen DOM- und sieben echten lokalen WebRTC-Prüfungen sowie native Enter-Bestätigung, Upload/Download, Überschreibschutz und Undo/Redo mit Geräten, Kabeln und gespeicherten Dateien.

Die bestehenden Build-Abhängigkeiten wurden kompatibel aktualisiert. Ein betroffener Glob-Build-Plugin wurde durch einen kleinen eigenen Inlining-Schritt ersetzt; der Build bleibt eine eigenständige HTML-Datei mit eingebetteten Symbolen und Styles. npm meldet nach der Bereinigung keine bekannten Schwachstellen.

`INSTALL.md` beschreibt statisches Hosting, optionales PHP und den Container. Der Container läuft mit UID/GID 10001, nginx auf Port 8080, PHP-FPM nur auf Loopback, ohne zusätzliche Capabilities und mit schreibgeschütztem Dateisystem und temporärem `/tmp`. Der echte Laufzeittest prüft HTML ohne Testoberfläche, PHP, vollständigen Offer/Answer-Austausch, Konfliktantworten und Größenlimits. Forgejo prüft den Stand vor Veröffentlichung der amd64/arm64-Images; Credentials entsprechen dem vorhandenen Registry-Secret-Schema. Nepos wird allein aus dem bereits eigenständigen `web`-Repository veröffentlicht. Originales Filius bleibt eine externe optionale Testabhängigkeit.

Die sichtbaren Rückgängig-/Wiederholen-Schaltflächen wurden zusätzlich durch tatsächliches Anlegen, Entfernen und Wiederherstellen eines PCs in der Oberfläche geprüft. [Entwurfsverlauf](nepos-undo-redo.jpg).
