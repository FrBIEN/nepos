import { HostApplication } from './HostApplication';
import { escapeHTML } from '../html';
export class EmailServerApplication extends HostApplication {
    mount(): void { this.element.innerHTML = this.createEmailServerUI(); this.setupEmailServer(this.element); }
    private createEmailServerUI(): string {
        const emailServer = this.deps.hostEmailServerManager.getServer(this.host.getId());
        const isRunning = emailServer?.isRunning() ?? false;
        const domain = emailServer?.getMailDomain() ?? 'filius.de';
        const accounts = emailServer?.getAccounts() ?? [];
        return `
      <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; gap: 12px; align-items: center;">
            <span style="font-size: 2rem;">📬</span>
            <div>
              <div style="font-weight: 600; font-size: 1rem;">E-Mail-Server</div>
              <div id="email-status" style="font-size: 0.75rem; color: ${isRunning ? 'var(--success)' : 'var(--text-secondary)'};">${isRunning ? '● Läuft (SMTP:25, POP3:110)' : '○ Gestoppt'}</div>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn ${isRunning ? 'btn-danger' : 'btn-success'}" id="email-toggle">${isRunning ? 'Stoppen' : 'Starten'}</button>

          </div>
        </div>

        <div style="display: flex; gap: 16px; flex: 1; overflow: hidden;">
          <div style="flex: 1; background: var(--bg-tertiary); border-radius: 8px; padding: 12px; display: flex; flex-direction: column;">
            <div style="font-weight: 600; font-size: 0.875rem; margin-bottom: 8px;">Konfiguration</div>
            <div class="form-group" style="margin-bottom: 12px;">
              <label style="font-size: 0.75rem;">Mail-Domain</label>
              <input type="text" id="email-domain" class="form-control" value="${escapeHTML(domain)}" style="font-size: 0.8rem;" />
            </div>
            <div style="flex: 1; overflow-y: auto;">
              <div style="font-weight: 600; font-size: 0.8rem; margin-bottom: 8px;">Benutzerkonten (${accounts.length})</div>
              <div id="email-accounts" style="font-size: 0.75rem;">
                ${this.renderEmailAccounts()}
              </div>
            </div>
          </div>

          <div style="width: 250px; background: var(--bg-tertiary); border-radius: 8px; padding: 12px; overflow-y: auto;">
            <div style="font-weight: 600; font-size: 0.875rem; margin-bottom: 12px;">Neues Konto</div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label style="font-size: 0.7rem;">Benutzername</label>
              <input type="text" id="email-new-user" class="form-control" placeholder="alice" style="font-size: 0.8rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label style="font-size: 0.7rem;">Passwort</label>
              <input type="password" id="email-new-pass" class="form-control" placeholder="••••••" style="font-size: 0.8rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label style="font-size: 0.7rem;">Vorname</label>
              <input type="text" id="email-new-first" class="form-control" placeholder="Alice" style="font-size: 0.8rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
              <label style="font-size: 0.7rem;">Nachname</label>
              <input type="text" id="email-new-last" class="form-control" placeholder="Schmidt" style="font-size: 0.8rem;" />
            </div>
            <button class="btn btn-primary btn-sm" id="email-add-account" style="width: 100%;">Konto erstellen</button>
          </div>
        </div>

        <div id="email-log" style="background: var(--bg-secondary); border-radius: 4px; padding: 8px; font-family: monospace; font-size: 0.7rem; height: 80px; overflow-y: auto;"></div>

      </div>
    `;
    }
    private renderEmailAccounts(): string {
        const emailServer = this.deps.hostEmailServerManager.getServer(this.host.getId());
        const accounts = emailServer?.getAccounts() ?? [];
        const domain = emailServer?.getMailDomain() ?? 'filius.de';
        if (accounts.length === 0) {
            return '<div style="color: var(--text-secondary);">Keine Konten vorhanden</div>';
        }
        return accounts.map(acc => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border-color);">
        <div>
          <div style="font-weight: 600;">${escapeHTML(acc.getUsername())}@${escapeHTML(domain)}</div>
          <div style="color: var(--text-secondary); font-size: 0.7rem;">${escapeHTML(acc.getFullName())} | ${acc.getMessages().length} Nachrichten</div>
        </div>
        <button class="email-del-account" data-user="${escapeHTML(acc.getUsername())}" style="border: none; background: none; color: var(--danger); cursor: pointer;">×</button>
      </div>
    `).join('');
    }
    private setupEmailServer(content: HTMLElement): void {
        const server = this.deps.hostEmailServerManager.getOrCreateServer(this.host);
        const toggleBtn = content.querySelector('#email-toggle') as HTMLButtonElement;
        const statusLabel = content.querySelector('#email-status') as HTMLElement;
        const domainInput = content.querySelector('#email-domain') as HTMLInputElement;
        const accountsDiv = content.querySelector('#email-accounts') as HTMLElement;
        const logDiv = content.querySelector('#email-log') as HTMLElement;
        const log = (msg: string) => {
            const div = document.createElement('div');
            div.textContent = msg;
            logDiv.appendChild(div);
            logDiv.scrollTop = logDiv.scrollHeight;
        };
        server.addObserver(log);
        this.scope.add(() => server.removeObserver(log));
        const refreshAccounts = () => {
            accountsDiv.innerHTML = this.renderEmailAccounts();
            this.setupAccountDeleteHandlers(content, refreshAccounts);
        };
        this.scope.listen(toggleBtn, 'click', () => {
            // Update domain before toggling
            const domain = domainInput.value.trim();
            if (domain)
                server.setMailDomain(domain);
            if (server.isRunning()) {
                server.stop();
                toggleBtn.textContent = 'Starten';
                toggleBtn.classList.remove('btn-danger');
                toggleBtn.classList.add('btn-success');
                statusLabel.textContent = '○ Gestoppt';
                statusLabel.style.color = 'var(--text-secondary)';
            }
            else {
                server.start();
                if (!server.isRunning()) {
                    void this.showNotice('Server konnte nicht starten. Port oder Konfiguration prüfen.');
                    return;
                }
                toggleBtn.textContent = 'Stoppen';
                toggleBtn.classList.remove('btn-success');
                toggleBtn.classList.add('btn-danger');
                statusLabel.textContent = '● Läuft (SMTP:25, POP3:110)';
                statusLabel.style.color = 'var(--success)';
            }
        });
        let domainTimeout: ReturnType<typeof setTimeout> | undefined;
        const applyDomain = () => {
            const domain = domainInput.value.trim();
            if (domain && domain !== server.getMailDomain()) {
                server.setMailDomain(domain);
                if (!this.scope.disposed)
                    refreshAccounts();
            }
        };
        this.flushPending = () => {
            if (domainTimeout !== undefined) {
                this.scope.cancelTimeout(domainTimeout);
                domainTimeout = undefined;
                applyDomain();
            }
        };
        this.scope.listen(domainInput, 'input', () => {
            if (domainTimeout !== undefined)
                this.scope.cancelTimeout(domainTimeout);
            domainTimeout = this.scope.timeout(() => { domainTimeout = undefined; applyDomain(); }, 500);
        });
        // Add account
        const addBtn = content.querySelector('#email-add-account') as HTMLButtonElement;
        this.scope.listen(addBtn, 'click', () => {
            const user = (content.querySelector('#email-new-user') as HTMLInputElement).value.trim();
            const pass = (content.querySelector('#email-new-pass') as HTMLInputElement).value;
            const first = (content.querySelector('#email-new-first') as HTMLInputElement).value.trim();
            const last = (content.querySelector('#email-new-last') as HTMLInputElement).value.trim();
            if (user && pass) {
                const success = server.addAccount(user, pass, first, last);
                if (success) {
                    (content.querySelector('#email-new-user') as HTMLInputElement).value = '';
                    (content.querySelector('#email-new-pass') as HTMLInputElement).value = '';
                    (content.querySelector('#email-new-first') as HTMLInputElement).value = '';
                    (content.querySelector('#email-new-last') as HTMLInputElement).value = '';
                    refreshAccounts();
                }
            }
        });
        this.setupAccountDeleteHandlers(content, refreshAccounts);
    }
    private setupAccountDeleteHandlers(content: HTMLElement, refreshCallback: () => void): void {
        content.querySelectorAll('.email-del-account').forEach(btn => {
            this.scope.listen(btn, 'click', async () => {
                const user = (btn as HTMLElement).dataset.user;
                if (user && await this.askConfirm(`Konto "${user}" wirklich löschen?`)) {
                    const server = this.deps.hostEmailServerManager.getServer(this.host.getId());
                    // Note: We need to add removeAccountByUsername or similar
                    // For now, we'll use a simple approach
                    const accounts = server?.getAccounts() ?? [];
                    const account = accounts.find(a => a.getUsername() === user);
                    if (account) {
                        server?.removeAccount(user, account.getPassword());
                        refreshCallback();
                    }
                }
            });
        });
    }
}
