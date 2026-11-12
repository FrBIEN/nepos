import { HostApplication } from './HostApplication';
import { escapeHTML } from '../html';
import { Terminal } from '../../apps/Terminal';
export class TerminalApplication extends HostApplication {
    private terminal: Terminal | null = null;
    mount(): void { this.element.innerHTML = this.createTerminalUI(); this.setupTerminal(this.element); }
    private createTerminalUI(): string {
        return `
      <div class="terminal-page">
      <button class="btn btn-secondary" id="terminal-stop" style="align-self:flex-end;flex-shrink:0" aria-label="Befehl abbrechen">Abbrechen</button>
      <div class="terminal" id="terminal-${this.host.getId()}">
        <div class="terminal-output" id="terminal-output-${this.host.getId()}"></div>
        <div class="terminal-input-line" style="margin-top: 0;">
          <span class="terminal-prompt">${escapeHTML(this.host.getName())}$</span>
          <input type="text" class="terminal-input" id="terminal-input-${this.host.getId()}"
                 placeholder="Befehl eingeben... (help für Hilfe)" autofocus />
        </div>
      </div>
      </div>
    `;
    }
    private setupTerminal(content: HTMLElement): void {
        this.terminal = new Terminal(this.host);
        const terminal = this.terminal;
        this.scope.add(() => terminal.interrupt());
        this.scope.listen(content.querySelector('#terminal-stop'), 'click', () => terminal.interrupt());
        const stopOnKey = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                terminal.interrupt();
            }
        };
        this.scope.listen(content, 'keydown', stopOnKey);
        this.scope.add(() => content.removeEventListener('keydown', stopOnKey));
        const output = content.querySelector(`#terminal-output-${this.host.getId()}`) as HTMLElement;
        const input = content.querySelector(`#terminal-input-${this.host.getId()}`) as HTMLInputElement;
        // Use current directory for initial prompt
        const initialPromptText = `${this.host.getName()}:${this.terminal.getCurrentDirectory()}$`;
        const promptSpan = content.querySelector('.terminal-input-line .terminal-prompt');
        if (promptSpan) {
            promptSpan.textContent = initialPromptText;
        }
        const terminalContainer = content.querySelector(`#terminal-${this.host.getId()}`) as HTMLElement;
        const inputLine = content.querySelector('.terminal-input-line') as HTMLElement;
        // Welcome message
        output.innerHTML = `<div>Filius Terminal - ${escapeHTML(this.host.getName())}</div>
<div>IP: ${this.host.getIP()} | MAC: ${this.host.getNetworkInterface().getMAC()}</div>
<div>Tippe 'help' für verfügbare Befehle.</div>
<div></div>`;
        this.terminal.onOutput((line) => {
            output.innerHTML += `<div>${escapeHTML(line)}</div>`;
            terminalContainer.scrollTop = terminalContainer.scrollHeight;
        });
        this.terminal.onClear(() => {
            output.innerHTML = '';
            const promptSpan = content.querySelector('.terminal-input-line .terminal-prompt');
            if (promptSpan && this.terminal) {
                promptSpan.textContent = `${this.host.getName()}:${this.terminal.getCurrentDirectory()}$`;
            }
        });
        // Click on terminal focuses input
        this.scope.listen(terminalContainer, 'click', (e) => {
            // Don't steal focus if user is selecting text
            if (window.getSelection()?.toString())
                return;
            if (e.target !== input) {
                input?.focus();
            }
        });
        this.scope.listen(input, 'keydown', async (e) => {
            if (!this.terminal)
                return;
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prev = this.terminal.getPreviousCommand(input.value);
                if (prev !== null) {
                    input.value = prev;
                    this.scope.timeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
                }
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = this.terminal.getNextCommand();
                if (next !== null)
                    input.value = next;
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                const completions = this.terminal.getCompletions(input.value);
                if (completions.length === 1) {
                    input.value = completions[0] + (completions[0].endsWith('/') ? '' : ' ');
                }
                else if (completions.length > 1) {
                    output.innerHTML += `<div style="color: var(--text-secondary);">${completions.join('  ')}</div>`;
                    terminalContainer.scrollTop = terminalContainer.scrollHeight;
                }
                return;
            }
            if (e.key === 'Enter') {
                const cmd = input.value.trim();
                if (cmd) {
                    // Use current CWD for the history prompt
                    const currentPromptText = `${this.host.getName()}:${this.terminal.getCurrentDirectory()}$`;
                    output.innerHTML += `<div><span class="terminal-prompt">${escapeHTML(currentPromptText)}</span> ${escapeHTML(cmd)}</div>`;
                    input.value = '';
                    // Hide input line while executing
                    inputLine.style.display = 'none';
                    try {
                        const result = await this.terminal.executeCommand(cmd);
                        if (result) {
                            output.innerHTML += `<pre style="margin:0;white-space:pre-wrap;font:inherit">${escapeHTML(result)}</pre>`;
                        }
                    }
                    catch (error) {
                        output.innerHTML += `<div>${escapeHTML(error instanceof Error ? error.message : error)}</div>`;
                    }
                    finally {
                        inputLine.style.display = 'flex';
                        if (promptSpan && this.terminal)
                            promptSpan.textContent = `${this.host.getName()}:${this.terminal.getCurrentDirectory()}$`;
                        terminalContainer.scrollTop = terminalContainer.scrollHeight;
                        if (input.isConnected)
                            input.focus();
                    }
                }
            }
        });
        input.focus();
    }
}
