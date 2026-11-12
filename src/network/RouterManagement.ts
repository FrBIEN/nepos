import { Vermittlungsrechner } from '../hardware/Vermittlungsrechner';

import { escapeHTML } from '../core/html';
import { Events } from '../core/EventBus';

/** The original router's /routes, /log and /konfig pages, served over simulated TCP. */
export function routerResponse(router: Vermittlungsrechner, request: string): string {
    const [header,body='']=request.split('\r\n\r\n'),[method,path]=header.split('\r\n')[0].split(' ');
    let status=200,title='Router',content='';
    const url=new URL(path||'/','http://router/');
    if(method!=='GET'&&method!=='POST'){status=405;content='Methode nicht unterstützt';}
    else if(url.pathname==='/routes'){
        title='Routing-Tabelle';content=`<table><tr><th>Netzwerk</th><th>Netzmaske</th><th>Gateway</th><th>Interface</th><th>Metrik</th></tr>${router.getRoutingTable().map(r=>`<tr>${[r.network,r.subnetMask,r.gateway,String(r.interfaceIndex+1),String(r.metric)].map(v=>`<td>${escapeHTML(v)}</td>`).join('')}</tr>`).join('')}</table>`;
    } else if(url.pathname==='/log'){
        title='Paket- und Firewall-Protokoll';content=`<pre>${escapeHTML(router.runtime.journal.getEntries().filter(e=>e.relatedDeviceId===router.getId()).slice(-100).map(e=>`${e.timestamp}ms ${e.transport} ${e.sourceIP}:${e.sourcePort} > ${e.destIP}:${e.destPort} ${e.info}`).join('\n'))}</pre>`;
    } else if(url.pathname==='/konfig'){
        title='Firewall';
        if(method==='POST'){
            const data=new URLSearchParams(body);router.setFirewallEnabled(data.get('enabled')==='on');
            const rule=data.get('rule'),action=data.get('action');if(rule&&['allow','deny'].includes(action||''))router.updateFirewallRule(rule,{action:action as 'allow'|'deny'});
            router.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED,{device:router});
        }
        content=`<form action="/konfig" method="post"><label><input type="checkbox" name="enabled" ${router.isFirewallEnabled()?'checked':''}>Firewall aktiv</label><p><label>Regel <select name="rule">${router.getFirewallRules().map(rule=>`<option value="${escapeHTML(rule.id)}">${escapeHTML(rule.description||rule.id)} (${rule.protocol})</option>`).join('')}</select></label> <select name="action"><option value="allow">Erlauben</option><option value="deny">Verwerfen</option></select></p><button>Übernehmen</button></form>`;
    } else if(url.pathname==='/')content='<p>Router verwalten und aktuelle Netzwerkinformationen abrufen.</p>';
    else {status=404;content='Seite nicht gefunden';}
    const html=`<!doctype html><html lang="de"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;margin:20px;color:#16324f;background:#f8fafc}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:#086880}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td,th{padding:12px;border:1px solid #94a3b8}input,select,button{font:inherit;min-height:44px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><nav><a href="/">Übersicht</a><a href="/routes">Routen</a><a href="/log">Protokoll</a><a href="/konfig">Firewall</a></nav><h1>${escapeHTML(router.getName())}: ${title}</h1>${content}</body></html>`;
    return `HTTP/1.1 ${status} ${status===200?'OK':status===404?'Not Found':'Method Not Allowed'}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${new TextEncoder().encode(html).length}\r\nConnection: close\r\n\r\n${html}`;
}
