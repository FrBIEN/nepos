import { Lifetime } from '../../core/Lifetime';
import { HostApplication } from './HostApplication';
import type { ApplicationContext } from '../../application/ApplicationContext';
import { escapeHTML } from '../html';
import { Email } from '../../apps/email';
import { Events } from '../../core/EventBus';
export class EmailClientApplication extends HostApplication {
    private mailScope: Lifetime | null = null;
    mount(): void { this.element.innerHTML = this.createEmailClientUI(); this.setupEmailClient(this.element); this.scope.add(() => this.cleanupEmailClientListener()); }
    private createEmailClientUI(): string {
        const client = this.deps.hostEmailClientManager.getOrCreateClient(this.host);
        const account = client.getAccount();
        const inbox = client.getInbox();
        const sent = client.getSent();
        const drafts = client.getDrafts();
        return `
      <div style="display: flex; flex-direction: column; height: 100%;">
        <div style="display: flex; padding: 12px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-color); gap: 8px; align-items: center;">
          <span style="font-size: 1.5rem;">✉️</span>
          <span style="font-weight: 600;">E-Mail</span>
          <div style="flex: 1;"></div>
          <button class="btn btn-sm btn-primary" id="email-compose">Neue E-Mail</button>
          <button class="btn btn-sm btn-secondary" id="email-fetch">Abrufen</button>
          <button class="btn btn-sm btn-secondary" id="email-settings">⚙️</button>

        </div>

        <div class="email-body" style="flex: 1; display: flex; overflow: hidden;">
          <div class="email-folders" style="width: 150px; background: var(--bg-tertiary); border-right: 1px solid var(--border-color); padding: 8px;">
            <div role="button" tabindex="0" class="email-folder ${!account ? 'disabled' : ''}" data-folder="inbox" style="padding: 8px; border-radius: 4px; cursor: pointer; background: var(--primary); color: white; margin-bottom: 4px;">
              📥 Posteingang (${inbox.filter(e => e.getIsNew()).length}/${inbox.length})
            </div>
            <div class="email-folder" data-folder="sent" style="padding: 8px; border-radius: 4px; cursor: pointer; margin-bottom: 4px;">
              📤 Gesendet (${sent.length})
            </div>
            <div role="button" tabindex="0" class="email-folder" data-folder="drafts" style="padding:8px;cursor:pointer">📝 Entwürfe (${drafts.length})</div>
          </div>

          <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
            <div id="email-list" style="flex: 1; overflow-y: auto; padding: 8px;">
              ${account ? this.renderEmailList('inbox') : '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Bitte zuerst ein Konto einrichten (⚙️)</div>'}
            </div>
          </div>
        </div>
      </div>
    `;
    }
    private renderEmailList(folder: 'inbox' | 'sent' | 'drafts'): string {
        const client = this.deps.hostEmailClientManager.getOrCreateClient(this.host);
        const emails = client.getFolder(folder);
        if (emails.length === 0) {
            return `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Keine E-Mails vorhanden</div>`;
        }
        return emails.map((email, index) => {
            const bodyPreview = email.getBody().trim();
            const previewText = bodyPreview.length > 0
                ? bodyPreview.substring(0, 80) + (bodyPreview.length > 80 ? '...' : '')
                : '';
            const fromAddr = email.getFrom()?.getMailAddress() || '';
            const toAddr = email.getTo()[0]?.getMailAddress() || '';
            const displayAddr = folder === 'inbox' ? (fromAddr || 'Unbekannt') : (toAddr || 'Unbekannt');
            const dateStr = email.getDateReceived()
                ? new Date(email.getDateReceived()).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '';
            return `
      <div role="button" tabindex="0" class="email-item" data-folder="${escapeHTML(folder)}" data-index="${index}" style="padding: 12px; border-bottom: 1px solid var(--border-color); cursor: pointer; ${email.getIsNew() ? 'font-weight: bold;' : ''}">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="font-size: 0.9rem;">${escapeHTML(displayAddr)}</span>
          <span style="font-size: 0.7rem; color: var(--text-secondary);">${dateStr}</span>
        </div>
        <div style="font-size: 0.85rem; color: var(--text-primary);">${escapeHTML(email.getSubject() || '(Kein Betreff)')}</div>
        ${previewText ? `<div style="font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(previewText)}</div>` : ''}
      </div>
    `;
        }).join('');
    }
    private setupEmailClient(content: HTMLElement): void {
        this.leaveGuard = null;
        this.setDismissAction(() => this.context.closeApp(), 'Anwendung schließen');
        const client = this.deps.hostEmailClientManager.getOrCreateClient(this.host);
        const composeBtn = content.querySelector('#email-compose') as HTMLButtonElement;
        const fetchBtn = content.querySelector('#email-fetch') as HTMLButtonElement;
        const settingsBtn = content.querySelector('#email-settings') as HTMLButtonElement;
        const listDiv = content.querySelector('#email-list') as HTMLElement;
        listDiv.innerHTML = this.renderEmailList('inbox');
        let currentFolder: 'inbox' | 'sent' | 'drafts' = 'inbox';
        const updateFolderCounts = () => {
            content.querySelectorAll('.email-folder').forEach(folderEl => {
                const folder = (folderEl as HTMLElement).dataset.folder;
                if (folder === 'inbox') {
                    const inbox = client.getInbox();
                    const unread = inbox.filter(e => e.getIsNew()).length;
                    folderEl.textContent = `📥 Posteingang (${unread}/${inbox.length})`;
                }
                else if (folder === 'sent') {
                    const sent = client.getSent();
                    folderEl.textContent = `📤 Gesendet (${sent.length})`;
                }
                else if (folder === 'drafts') {
                    folderEl.textContent = `📝 Entwürfe (${client.getDrafts().length})`;
                }
            });
        };
        const refreshList = () => {
            listDiv.innerHTML = this.renderEmailList(currentFolder);
            this.setupEmailItemHandlers(content, listDiv);
            updateFolderCounts();
        };
        // Auto-refresh on state change
        this.cleanupEmailClientListener();
        this.mailScope = this.scope.child();
        this.mailScope.add(this.deps.events.on(Events.SERVICE_STATE_CHANGED, event => {
            if (event.type === 'email-client')
                refreshList();
        }).unsubscribe);
        // Initial update
        updateFolderCounts();
        // Folder switching
        content.querySelectorAll('.email-folder').forEach(folder => {
            this.scope.listen(folder, 'keydown', event => {
                const key = (event as KeyboardEvent).key;
                if (key === 'Enter' || key === ' ') {
                    event.preventDefault();
                    (folder as HTMLElement).click();
                }
            });
            this.scope.listen(folder, 'click', () => {
                const folderName = (folder as HTMLElement).dataset.folder as 'inbox' | 'sent' | 'drafts';
                currentFolder = folderName;
                content.querySelectorAll('.email-folder').forEach(f => {
                    (f as HTMLElement).style.background = '';
                    (f as HTMLElement).style.color = '';
                });
                (folder as HTMLElement).style.background = 'var(--primary)';
                (folder as HTMLElement).style.color = 'white';
                refreshList();
            });
        });
        // Compose
        this.scope.listen(composeBtn, 'click', () => {
            this.cleanupEmailClientListener();
            this.showComposeEmail(content, client, () => {
                // setupEmailClient is called by showComposeEmail completion/cancel, so we don't need manual refresh here
            });
        });
        // Fetch emails
        this.scope.listen(fetchBtn, 'click', async () => {
            if (!client.getAccount()) {
                void this.showNotice('Bitte zuerst ein Konto einrichten (⚙️)');
                return;
            }
            fetchBtn.disabled = true;
            fetchBtn.textContent = 'Lädt...';
            const result = await client.retrieveEmails();
            fetchBtn.disabled = false;
            fetchBtn.textContent = 'Abrufen';
            if (result.success) {
                // Event listener will handle refresh
            }
            else {
                void this.showNotice('Fehler: ' + result.message);
            }
        });
        // Settings
        this.scope.listen(settingsBtn, 'click', () => {
            this.cleanupEmailClientListener();
            this.showEmailSettings(content, client);
        });
        this.setupEmailItemHandlers(content, listDiv);
    }
    private cleanupEmailClientListener(): void { this.mailScope?.dispose(); this.mailScope = null; }
    private setupEmailItemHandlers(content: HTMLElement, listDiv: HTMLElement): void {
        listDiv.querySelectorAll('.email-item').forEach(item => {
            this.scope.listen(item, 'keydown', event => {
                const key = (event as KeyboardEvent).key;
                if (key === 'Enter' || key === ' ') {
                    event.preventDefault();
                    (item as HTMLElement).click();
                }
            });
            this.scope.listen(item, 'click', () => {
                const folder = (item as HTMLElement).dataset.folder as 'inbox' | 'sent' | 'drafts';
                const index = parseInt((item as HTMLElement).dataset.index || '0');
                const client = this.deps.hostEmailClientManager.getOrCreateClient(this.host);
                const emails = client.getFolder(folder);
                const email = emails[index];
                if (email) {
                    if (folder === 'drafts') {
                        this.cleanupEmailClientListener();
                        this.showComposeEmail(content, client, () => { }, { to: email.getTo().map(a => a.getMailAddress()).join(', '), subject: email.getSubject(), body: email.getBody(), title: 'Entwurf bearbeiten' }, email);
                        return;
                    }
                    // Mark as read when opened
                    if (email.getIsNew()) {
                        email.setIsNew(false);
                        // Update folder count display
                        const inboxFolder = content.querySelector('[data-folder="inbox"]');
                        if (inboxFolder) {
                            const inbox = client.getInbox();
                            const unread = inbox.filter(e => e.getIsNew()).length;
                            inboxFolder.textContent = `📥 Posteingang (${unread}/${inbox.length})`;
                        }
                        // Persist the read state
                        this.deps.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'email-client' });
                    }
                    this.showEmailDetail(content, email);
                }
            });
        });
    }
    private showComposeEmail(content: HTMLElement, client: ReturnType<ApplicationContext['hostEmailClientManager']['getOrCreateClient']>, onSent: () => void, prefill?: {
        to?: string;
        subject?: string;
        body?: string;
        title?: string;
        returnToInbox?: boolean;
    }, existingDraft?: Email): void {
        const account = client.getAccount();
        const mainContent = content.querySelector('.desktop-window-content') || content;
        const title = prefill?.title || 'Neue E-Mail';
        const returnToInbox = prefill?.returnToInbox ?? false;
        const oldContent = mainContent.innerHTML;
        mainContent.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600; font-size: 1.1rem;">${escapeHTML(title)}</span>
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label style="font-size: 0.75rem;">An:</label>
          <input type="text" id="compose-to" class="form-control" placeholder="empfaenger@domain.de" style="font-size: 0.85rem;" value="${escapeHTML(prefill?.to || '')}" />
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label style="font-size: 0.75rem;">Betreff:</label>
          <input type="text" id="compose-subject" class="form-control" placeholder="Betreff" style="font-size: 0.85rem;" value="${escapeHTML(prefill?.subject || '')}" />
        </div>
        <div class="form-group" style="flex: 1; display: flex; flex-direction: column; margin-bottom: 0;">
          <label style="font-size: 0.75rem;">Nachricht:</label>
          <textarea id="compose-body" class="form-control" style="flex: 1; resize: none; font-size: 0.85rem;">${escapeHTML(prefill?.body || '')}</textarea>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary" id="compose-send">Senden</button>
          <button class="btn btn-secondary" id="compose-cancel2">Abbrechen</button>
        </div>
        <div id="compose-status" style="font-size: 0.8rem; color: var(--text-secondary);"></div>
      </div>
    `;
        let draft: Email | undefined = existingDraft;
        let sending = false;
        const updateDraft = () => {
            const to = content.querySelector<HTMLInputElement>('#compose-to')!.value;
            const subject = content.querySelector<HTMLInputElement>('#compose-subject')!.value;
            const body = content.querySelector<HTMLTextAreaElement>('#compose-body')!.value;
            if (!draft && !to && !subject && !body)
                return;
            const first = !draft;
            draft ??= new Email();
            draft.setFrom(account?.getEmailAddress() || '');
            draft.setTo([]);
            to.split(',').map(a => a.trim()).filter(Boolean).forEach(a => draft!.addTo(a));
            draft.setSubject(subject);
            draft.setBody(body);
            if (first)
                client.saveDraft(draft);
            else
                this.deps.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'email-client' });
        };
        const removeDraft = () => {
            if (draft) {
                const index = client.getDrafts().indexOf(draft);
                if (index >= 0)
                    client.deleteEmail('drafts', index);
            }
            draft = undefined;
        };
        content.querySelectorAll('#compose-to,#compose-subject,#compose-body').forEach(input => this.scope.listen(input, 'input', updateDraft));
        updateDraft();
        this.leaveGuard = async () => {
            if (sending) {
                await this.showNotice('Die E-Mail wird gerade gesendet. Bitte warten.');
                return false;
            }
            if (!draft)
                return true;
            const action = await this.askSaveChanges('E-Mail als Entwurf speichern?');
            this.leaveCommit = action === 'discard' ? removeDraft : null;
            return action === 'save' || action === 'discard';
        };
        const cancelHandler = () => {
            this.commitLeave();
            if (returnToInbox) {
                // Return to inbox list by regenerating the full email client UI
                mainContent.innerHTML = this.createEmailClientUI();
                this.setupEmailClient(content);
            }
            else {
                mainContent.innerHTML = oldContent;
                this.setupEmailClient(content);
            }
        };
        this.setDismissAction(cancelHandler, 'E-Mail schließen');
        this.scope.listen(content.querySelector('#compose-cancel2'), 'click', async () => {
            if (await this.prepareClose())
                cancelHandler();
        });
        const sendButton = content.querySelector<HTMLButtonElement>('#compose-send')!;
        this.scope.listen(sendButton, 'click', async () => {
            if (sendButton.disabled)
                return;
            const to = (content.querySelector('#compose-to') as HTMLInputElement).value.trim();
            const subject = (content.querySelector('#compose-subject') as HTMLInputElement).value.trim();
            const body = (content.querySelector('#compose-body') as HTMLTextAreaElement).value;
            const statusDiv = content.querySelector('#compose-status') as HTMLElement;
            if (!to) {
                statusDiv.textContent = 'Bitte Empfänger eingeben';
                return;
            }
            const email = new Email();
            email.setFrom(account?.getEmailAddress() || '');
            to.split(',').map(address => address.trim()).filter(Boolean).forEach(address => email.addTo(address));
            email.setSubject(subject);
            email.setBody(body);
            sendButton.disabled = true;
            sending = true;
            statusDiv.textContent = 'Sende...';
            const result = await client.sendEmail(email).catch(error => ({ success: false, message: error instanceof Error ? error.message : String(error) }));
            sending = false;
            if (!sendButton.isConnected)
                return;
            if (result.success) {
                removeDraft();
                this.leaveGuard = null;
                statusDiv.textContent = 'Gesendet!';
                const timer = this.scope.timeout(() => {
                    if (!sendButton.isConnected)
                        return;
                    if (returnToInbox) {
                        // Return to inbox list
                        mainContent.innerHTML = this.createEmailClientUI();
                        this.setupEmailClient(content);
                    }
                    else {
                        mainContent.innerHTML = oldContent;
                        this.setupEmailClient(content);
                    }
                    onSent();
                }, 1000);
                this.scope.add(() => clearTimeout(timer));
            }
            else {
                sendButton.disabled = false;
                statusDiv.textContent = 'Fehler: ' + result.message;
            }
        });
    }
    private showEmailDetail(content: HTMLElement, email: Email): void {
        const mainContent = content.querySelector('.desktop-window-content') || content;
        const oldContent = mainContent.innerHTML;
        const client = this.deps.hostEmailClientManager.getOrCreateClient(this.host);
        // Helper to escape HTML special characters
        const escapeHtml = (str: string): string => {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        };
        // Use getMailAddress() to get the plain email address without angle brackets
        const fromEntry = email.getFrom();
        const fromAddr = fromEntry
            ? (fromEntry.getDisplayName()
                ? `${escapeHtml(fromEntry.getDisplayName())} <${escapeHtml(fromEntry.getMailAddress())}>`
                : escapeHtml(fromEntry.getMailAddress()))
            : 'Unbekannt';
        // Format recipient list with HTML escaping
        const toAddresses = email.getTo();
        const toList = toAddresses.length > 0
            ? toAddresses.map(a => a.getDisplayName()
                ? `${escapeHtml(a.getDisplayName())} <${escapeHtml(a.getMailAddress())}>`
                : escapeHtml(a.getMailAddress())).join(', ')
            : 'Unbekannt';
        const dateStr = email.getDateReceived()
            ? new Date(email.getDateReceived()).toLocaleString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })
            : '-';
        mainContent.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="flex: 1;"></div>
          <button class="btn btn-primary btn-sm" id="detail-reply">↩️ Antworten</button>
          <button class="btn btn-secondary btn-sm" id="detail-forward">➡️ Weiterleiten</button>
        </div>
        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px;">
          <div style="font-size: 0.8rem; color: var(--text-secondary);">Von: ${escapeHTML(fromAddr)}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary);">An: ${escapeHTML(toList)}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary);">Datum: ${dateStr}</div>
          <div style="font-size: 1.1rem; font-weight: 600; margin-top: 8px;">${escapeHtml(email.getSubject() || '(Kein Betreff)')}</div>
        </div>
        <div style="flex: 1; overflow-y: auto; padding: 12px; background: var(--bg-secondary); border-radius: 8px; white-space: pre-wrap; font-size: 0.9rem;">
${escapeHtml(email.getBody() || '(Kein Inhalt)')}
        </div>
      </div>
    `;
        this.setDismissAction(() => {
            mainContent.innerHTML = oldContent;
            this.setupEmailClient(content);
        }, 'Nachricht schließen');
        // Reply button
        this.scope.listen(content.querySelector('#detail-reply'), 'click', () => {
            const replyTo = email.getFrom()?.getMailAddress() || '';
            const originalSubject = email.getSubject() || '';
            const replySubject = originalSubject.startsWith('Re: ') ? originalSubject : `Re: ${originalSubject}`;
            const originalDate = email.getDateReceived()
                ? new Date(email.getDateReceived()).toLocaleString('de-DE')
                : '';
            const replyBody = `\n\n\n--- Ursprüngliche Nachricht ---\nVon: ${replyTo}\nDatum: ${originalDate}\nBetreff: ${originalSubject}\n\n${email.getBody() || ''}`;
            this.showComposeEmail(content, client, () => { }, {
                to: replyTo,
                subject: replySubject,
                body: replyBody,
                title: 'Antworten',
                returnToInbox: true
            });
        });
        // Forward button
        this.scope.listen(content.querySelector('#detail-forward'), 'click', () => {
            const originalSubject = email.getSubject() || '';
            const fwdSubject = originalSubject.startsWith('Fwd: ') ? originalSubject : `Fwd: ${originalSubject}`;
            const originalFrom = email.getFrom()?.getMailAddress() || '';
            const originalDate = email.getDateReceived()
                ? new Date(email.getDateReceived()).toLocaleString('de-DE')
                : '';
            const fwdBody = `\n\n\n--- Weitergeleitete Nachricht ---\nVon: ${originalFrom}\nDatum: ${originalDate}\nBetreff: ${originalSubject}\n\n${email.getBody() || ''}`;
            this.showComposeEmail(content, client, () => { }, {
                to: '',
                subject: fwdSubject,
                body: fwdBody,
                title: 'Weiterleiten',
                returnToInbox: true
            });
        });
    }
    private showEmailSettings(content: HTMLElement, client: ReturnType<ApplicationContext['hostEmailClientManager']['getOrCreateClient']>): void {
        const mainContent = content.querySelector('.desktop-window-content') || content;
        const account = client.getAccount();
        const oldContent = mainContent.innerHTML;
        mainContent.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600; font-size: 1.1rem;">Konto-Einstellungen</span>
        </div>
        <div class="form-group">
          <label style="font-size: 0.75rem;">E-Mail-Adresse</label>
          <input type="text" id="settings-email" class="form-control" value="${escapeHTML(account?.getEmailAddress() || '')}" placeholder="benutzer@domain.de" />
        </div>
        <div style="display: flex; gap: 12px;">
          <div class="form-group" style="flex: 1;">
            <label style="font-size: 0.75rem;">Benutzername</label>
            <input type="text" id="settings-user" class="form-control" value="${escapeHTML(account?.getUsername() || '')}" placeholder="benutzer" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label style="font-size: 0.75rem;">Passwort</label>
            <input type="password" id="settings-pass" class="form-control" value="${escapeHTML(account?.getPassword() || '')}" placeholder="••••••" />
          </div>
        </div>
        <div style="display: flex; gap: 12px;">
          <div class="form-group" style="flex: 1;">
            <label style="font-size: 0.75rem;">POP3-Server (Empfang)</label>
            <input type="text" id="settings-pop3" class="form-control" value="${escapeHTML(account?.getPop3Server() || '')}" placeholder="192.168.0.10" />
          </div>
          <div class="form-group" style="width: 80px;">
            <label style="font-size: 0.75rem;">Port</label>
            <input type="number" id="settings-pop3-port" class="form-control" value="${escapeHTML(account?.getPop3Port() || 110)}" />
          </div>
        </div>
        <div style="display: flex; gap: 12px;">
          <div class="form-group" style="flex: 1;">
            <label style="font-size: 0.75rem;">SMTP-Server (Versand)</label>
            <input type="text" id="settings-smtp" class="form-control" value="${escapeHTML(account?.getSmtpServer() || '')}" placeholder="192.168.0.10" />
          </div>
          <div class="form-group" style="width: 80px;">
            <label style="font-size: 0.75rem;">Port</label>
            <input type="number" id="settings-smtp-port" class="form-control" value="${escapeHTML(account?.getSmtpPort() || 25)}" />
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary" id="settings-save">Speichern</button>
          <button class="btn btn-secondary" id="settings-cancel2">Abbrechen</button>
        </div>
      </div>
    `;
        const inputs = [...content.querySelectorAll<HTMLInputElement>('input[id^="settings-"]')];
        let originalValues = inputs.map(input => input.value);
        const saveSettings = async (): Promise<boolean> => {
            const read = (id: string) => content.querySelector<HTMLInputElement>('#settings-' + id)!.value;
            const pop3Port = Number(read('pop3-port')), smtpPort = Number(read('smtp-port'));
            if (![pop3Port, smtpPort].every(port => Number.isInteger(port) && port >= 1 && port <= 65535)) {
                await this.showNotice('Bitte gültige Ports zwischen 1 und 65535 eingeben.');
                return false;
            }
            client.configureAccount(read('email').trim(), read('user').trim(), read('pass'), read('pop3').trim(), read('smtp').trim(), pop3Port, smtpPort);
            originalValues = inputs.map(input => input.value);
            return true;
        };
        this.leaveGuard = async () => {
            if (inputs.every((input, index) => input.value === originalValues[index]))
                return true;
            const action = await this.askSaveChanges('Geänderte Konto-Einstellungen speichern?');
            return action === 'save' ? saveSettings() : action === 'discard';
        };
        const closeSettings = () => {
            this.commitLeave();
            mainContent.innerHTML = oldContent;
            this.setupEmailClient(content);
        };
        this.setDismissAction(closeSettings, 'Einstellungen schließen');
        this.scope.listen(content.querySelector('#settings-cancel2'), 'click', async () => {
            if (await this.prepareClose())
                closeSettings();
        });
        this.scope.listen(content.querySelector('#settings-save'), 'click', async () => {
            if (await saveSettings())
                closeSettings();
        });
    }
}
