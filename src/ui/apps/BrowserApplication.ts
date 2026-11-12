import { HostApplication } from './HostApplication';
import { WebBrowser } from '../../apps/WebServer';
export class BrowserApplication extends HostApplication {
    private messageHandler?: (e: MessageEvent) => void;
    mount(): void { this.element.innerHTML = this.createBrowserUI(); this.setupBrowser(this.element); this.scope.add(() => this.cleanupBrowserListener()); }
    private createBrowserUI(): string {
        return `<div style="display:flex;flex-direction:column;height:100%;min-height:0">
      <div class="browser-toolbar" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <button class="btn" id="browser-back-nav" aria-label="Vorherige Seite" disabled>←</button><button class="btn" id="browser-forward-nav" aria-label="Nächste Seite" disabled>→</button>
        <button class="btn" id="browser-refresh" aria-label="Neu laden">↻</button><input class="form-control" id="browser-url-${this.host.getId()}" aria-label="Webadresse" placeholder="http://192.168.0.1/" style="flex:1;min-width:140px">
        <button class="btn btn-primary" id="browser-go">Los</button>
      </div><div id="browser-status" role="status"></div><iframe id="browser-frame-${this.host.getId()}" title="Simulierte Webseite" style="flex:1;min-height:200px;border:0;background:white" sandbox="allow-scripts"></iframe></div>`;
    }
    private setupBrowser(content: HTMLElement): void {
        const browser = new WebBrowser(this.host);
        const urlInput = content.querySelector(`#browser-url-${this.host.getId()}`) as HTMLInputElement;
        const frame = content.querySelector('iframe') as HTMLIFrameElement;
        const back = content.querySelector('#browser-back-nav') as HTMLButtonElement, forward = content.querySelector('#browser-forward-nav') as HTMLButtonElement;
        const status = content.querySelector('#browser-status')!;
        let generation = 0;
        this.scope.add(() => { generation++; browser.close(); });
        frame.srcdoc = '<html lang="de"><body style="font:18px system-ui;padding:24px"><h2>Nepos Webbrowser</h2><p>Webadresse eingeben. Alle Ressourcen werden aus dem simulierten Netz geladen.</p></body></html>';
        const navigate = async (method: 'GET' | 'POST' = 'GET', body = '') => {
            const current = ++generation;
            status.textContent = 'Seite wird über das simulierte Netz geladen…';
            try {
                const response = await browser.navigate(urlInput.value.trim(), method, body);
                if (generation !== current)
                    return;
                urlInput.value = browser.getCurrentURL() || urlInput.value;
                const baseURL = urlInput.value.startsWith('http://') ? urlInput.value : `http://${urlInput.value}`;
                const doc = new DOMParser().parseFromString(response.body, 'text/html');
                const fetch = async (path: string, binary = false): Promise<string> => {
                    if (path.startsWith('data:'))
                        return path;
                    const resource = await browser.fetchResource(new URL(path, baseURL).href);
                    if (resource.status !== 200)
                        return '';
                    if (binary && !resource.body.startsWith('data:'))
                        return `data:${resource.headers['Content-Type'] || 'application/octet-stream'};base64,${btoa(String.fromCharCode(...new TextEncoder().encode(resource.body)))}`;
                    return resource.body;
                };
                const css = async (text: string, url: string) => {
                    const matches = [...text.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g)];
                    for (const match of matches) {
                        try {
                            const data = await fetch(new URL(match[2], url).href, true);
                            text = text.replace(match[0], `url("${data}")`);
                        }
                        catch {
                            text = text.replace(match[0], 'url("")');
                        }
                    }
                    return text;
                };
                await Promise.all([...doc.querySelectorAll('img[src],audio[src],video[src],source[src]')].map(async (element) => {
                    try {
                        element.setAttribute('src', await fetch(element.getAttribute('src')!, true));
                    }
                    catch {
                        element.removeAttribute('src');
                    }
                    element.removeAttribute('srcset');
                }));
                await Promise.all([...doc.querySelectorAll('link[rel="stylesheet"]')].map(async (element) => {
                    const style = doc.createElement('style');
                    try {
                        const url = new URL(element.getAttribute('href')!, baseURL).href;
                        style.textContent = await css(await fetch(url), url);
                    }
                    catch { }
                    element.replaceWith(style);
                }));
                await Promise.all([...doc.querySelectorAll('style')].map(async (element) => { element.textContent = await css(element.textContent || '', baseURL); }));
                await Promise.all([...doc.querySelectorAll('[style*="url("]')].map(async (element) => { element.setAttribute('style', await css(element.getAttribute('style')!, baseURL)); }));
                await Promise.all([...doc.querySelectorAll('script[src]')].map(async (element) => {
                    try {
                        element.textContent = await fetch(element.getAttribute('src')!);
                    }
                    catch { }
                    element.removeAttribute('src');
                }));
                doc.querySelectorAll('base,meta[http-equiv],iframe,object,embed').forEach(element => element.remove());
                const policy = doc.createElement('meta');
                policy.httpEquiv = 'Content-Security-Policy';
                policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri http:";
                doc.head.prepend(policy);
                const base = doc.createElement('base');
                base.href = baseURL;
                doc.head.append(base);
                const intercept = doc.createElement('script');
                intercept.textContent = `document.addEventListener('click',event=>{const link=event.target.closest('a');if(link){event.preventDefault();parent.postMessage({type:'BROWSER_NAVIGATE',url:link.href,hostId:${JSON.stringify(this.host.getId())}},'*');}},true);document.addEventListener('submit',event=>{event.preventDefault();const f=event.target,url=new URL(f.getAttribute('action')||${JSON.stringify(baseURL)},${JSON.stringify(baseURL)}),data=new URLSearchParams(new FormData(f)),method=f.method.toUpperCase()==='POST'?'POST':'GET';if(method==='GET')url.search=data.toString();parent.postMessage({type:'BROWSER_NAVIGATE',hostId:${JSON.stringify(this.host.getId())},url:url.href,method,body:method==='POST'?data.toString():''},'*');},true);`;
                doc.head.append(intercept);
                if (generation !== current)
                    return;
                frame.srcdoc = doc.documentElement.outerHTML;
                status.textContent = `${response.status || 'Fehler'} ${response.statusText}`;
                back.disabled = !browser.canGoBack();
                forward.disabled = !browser.canGoForward();
            }
            catch (error) {
                if (generation === current)
                    status.textContent = String(error);
            }
        };
        this.messageHandler = e => {
            if (e.source === frame.contentWindow && e.data?.type === 'BROWSER_NAVIGATE' && e.data.hostId === this.host.getId() && typeof e.data.url === 'string') {
                urlInput.value = e.data.url;
                void navigate(e.data.method === 'POST' ? 'POST' : 'GET', typeof e.data.body === 'string' ? e.data.body : '');
            }
        };
        this.scope.listen(window, 'message', this.messageHandler);
        this.scope.listen(content.querySelector('#browser-go')!, 'click', () => void navigate());
        this.scope.listen(content.querySelector('#browser-refresh')!, 'click', () => void navigate());
        this.scope.listen(urlInput, 'keydown', e => {
            if (e.key === 'Enter')
                void navigate();
        });
        this.scope.listen(back, 'click', () => {
            const url = browser.goBack();
            if (url) {
                urlInput.value = url;
                void navigate();
            }
        });
        this.scope.listen(forward, 'click', () => {
            const url = browser.goForward();
            if (url) {
                urlInput.value = url;
                void navigate();
            }
        });
    }
    private cleanupBrowserListener(): void {
        if (this.messageHandler) {
            window.removeEventListener('message', this.messageHandler);
            this.messageHandler = undefined;
        }
    }
}
