// Test-only server. No route, bundle or control is included in the application build.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'nepos-browser-'));
await build({entryPoints:['tests/browser/entry.ts'],outfile:join(directory,'test.js'),bundle:true,format:'esm',loader:{'.svg':'dataurl'}});
const script=await readFile(join(directory,'test.js')),css=await readFile(join(directory,'test.css'));
const html='<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nepos</title><link rel="stylesheet" href="/test.css"><div id="app"></div><script type="module" src="/test.js"></script></html>';
const server=createServer((req,res)=>{
    const routes={'/':['text/html; charset=utf-8',html],'/test.js':['text/javascript',script],'/test.css':['text/css',css]};
    const resource=routes[req.url]; if(!resource){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':resource[0],'Cache-Control':'no-store'});res.end(resource[1]);
});
server.listen(Number(process.env.NEPOS_TEST_PORT ?? 5178),'127.0.0.1');
const close=()=>server.close(async()=>{await rm(directory,{recursive:true,force:true});process.exit(0);});
process.on('SIGTERM',close);process.on('SIGINT',close);
