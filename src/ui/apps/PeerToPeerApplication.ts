import { Lifetime } from '../../core/Lifetime';
import { HostApplication } from './HostApplication';
export class PeerToPeerApplication extends HostApplication {
    private renderScope = new Lifetime();
    mount(): void { this.setupPeerToPeer(this.element); }
    private setupPeerToPeer(content: HTMLElement): void {
        this.renderScope.dispose();
        this.renderScope = this.scope.child();
        const app = this.deps.peerToPeerManager.getOrCreate(this.host);
        content.innerHTML = `<div class="p2p-app" style="padding:20px;overflow:auto;height:100%">
      <div class="app-heading"><h2>Dateiaustausch</h2></div>
      <p>Dateien freigeben, andere Rechner verbinden und im Netzwerk suchen.</p>
      <button class="btn btn-primary" id="p2p-start">${app.isRunning() ? 'Stoppen' : 'Starten'}</button>
      <label>Freigabe (Dateipfad)<input id="p2p-share" class="form-control" value="/home/" /></label>
      <button class="btn btn-secondary" id="p2p-add">Freigeben</button><div id="p2p-shares"></div>
      <label>Partner (IP-Adresse)<input id="p2p-peer" class="form-control" /></label><button class="btn btn-secondary" id="p2p-connect">Verbinden</button>
      <label>Dateiname suchen<input id="p2p-query" class="form-control" /></label><button class="btn btn-secondary" id="p2p-search">Suchen</button>
      <p id="p2p-status" role="status"></p><div id="p2p-results"></div></div>`;
        const input = (id: string) => (content.querySelector(`#${id}`) as HTMLInputElement).value;
        const status = content.querySelector('#p2p-status')!;
        this.renderScope.add(app.onStatus(text => status.textContent = text));
        const renderShares = () => {
            const list = content.querySelector('#p2p-shares')!;
            list.replaceChildren();
            app.getShares().forEach(path => { const button = document.createElement('button'); button.className = 'btn btn-secondary'; button.textContent = `${path} ×`; button.onclick = () => { app.unshare(path); renderShares(); }; list.append(button); });
        };
        renderShares();
        this.renderScope.listen(content.querySelector('#p2p-start')!, 'click', () => {
            if (app.isRunning())
                app.stop();
            else
                app.start();
            this.setupPeerToPeer(content);
        });
        this.renderScope.listen(content.querySelector('#p2p-add')!, 'click', () => {
            try {
                app.share(input('p2p-share'));
                renderShares();
            }
            catch (error) {
                status.textContent = String(error);
            }
        });
        this.renderScope.listen(content.querySelector('#p2p-connect')!, 'click', () => app.connect(input('p2p-peer')));
        this.renderScope.listen(content.querySelector('#p2p-search')!, 'click', () => { content.querySelector('#p2p-results')!.replaceChildren(); app.search(input('p2p-query')); });
        this.renderScope.add(app.onHit(hit => {
            const button = document.createElement('button');
            button.className = 'btn btn-secondary';
            button.textContent = `${hit.name} · ${hit.size} Bytes · ${hit.ip}`;
            button.onclick = async () => {
                try {
                    status.textContent = `Gespeichert: ${await app.download(hit)}`;
                }
                catch (error) {
                    status.textContent = String(error);
                }
            };
            content.querySelector('#p2p-results')!.append(button);
        }));
    }
}
