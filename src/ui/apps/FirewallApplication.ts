import { HostApplication } from './HostApplication';
export class FirewallApplication extends HostApplication {
    mount(): void { this.setupFirewall(this.element); }
    private setupFirewall(content: HTMLElement): void {
        const config = this.host.getFirewall();
        content.innerHTML = `<div class="app-page" style="padding:20px;overflow:auto"><div class="app-heading"><h2>Persönliche Firewall</h2></div>
      <label><input type="checkbox" id="fw-enable" ${config.enabled ? 'checked' : ''}> Firewall aktivieren</label>
      <label><input type="checkbox" id="fw-icmp" ${config.blockICMP ? 'checked' : ''}> ICMP sperren</label>
      <p>Eingehende Verbindungen sind nur an freigegebenen Ports zulässig. Antworten auf eigene Verbindungen werden zugelassen.</p>
      <form id="fw-add" style="display:flex;gap:8px;flex-wrap:wrap"><select name="protocol"><option value="tcp">TCP</option><option value="udp">UDP</option></select><input name="port" type="number" min="1" max="65535" required placeholder="Port"><label><input name="local" type="checkbox">Nur im eigenen Subnetz</label><button class="btn">Freigeben</button></form>
      <div id="fw-rules"></div><pre id="fw-log" style="white-space:pre-wrap"></pre></div>`;
        const save = () => this.host.setFirewall(config);
        const render = () => {
            const list = content.querySelector('#fw-rules')!;
            list.replaceChildren();
            config.rules.forEach((rule, index) => {
                const row = document.createElement('div');
                row.textContent = `${rule.protocol.toUpperCase()} ${rule.port} – ${rule.localOnly ? 'eigenes Subnetz' : 'alle Netze'} `;
                const remove = document.createElement('button');
                remove.className = 'btn';
                remove.textContent = 'Entfernen';
                remove.onclick = () => { config.rules.splice(index, 1); save(); render(); };
                row.append(remove);
                list.append(row);
            });
            content.querySelector('#fw-log')!.textContent = this.host.getFirewallLog().join('\n');
        };
        this.scope.listen(content.querySelector('#fw-enable')!, 'change', e => { config.enabled = (e.target as HTMLInputElement).checked; save(); });
        this.scope.listen(content.querySelector('#fw-icmp')!, 'change', e => { config.blockICMP = (e.target as HTMLInputElement).checked; save(); });
        this.scope.listen(content.querySelector('#fw-add')!, 'submit', e => { e.preventDefault(); const form = e.target as HTMLFormElement; const data = new FormData(form); config.rules.push({ protocol: data.get('protocol') as 'tcp' | 'udp', port: Number(data.get('port')), localOnly: data.has('local') }); save(); render(); });
        render();
    }
}
