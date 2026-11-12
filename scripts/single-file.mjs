import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
// Vite emits one module and one stylesheet. Inline them without a glob dependency.
const root=resolve('dist');let html=await readFile(resolve(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
for(const match of scripts){const name=match[1].replace(/^\.\//,'');if(!/^assets\/[\w.-]+\.js$/.test(name))throw new Error('Unexpected build script '+name);
    const js=(await readFile(resolve(root,name),'utf8')).replace(/<\/script/gi,'<\\/script');html=html.replace(match[0],`<script type="module">${js}</script>`);
}
for(const match of [...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)"[^>]*>/g)]){const name=match[1].replace(/^\.\//,'');if(!/^assets\/[\w.-]+\.css$/.test(name))throw new Error('Unexpected stylesheet '+name);
    const css=(await readFile(resolve(root,name),'utf8')).replace(/<\/style/gi,'<\\/style');html=html.replace(match[0],`<style>${css}</style>`);
}
if(scripts.length!==1 || /(?:src|href)="\.\/assets\//.test(html))throw new Error('Build is not standalone');
await writeFile(resolve(root,'index.html'),html);await rm(resolve(root,'assets'),{recursive:true,force:true});
console.log('Standalone Nepos HTML generated');
