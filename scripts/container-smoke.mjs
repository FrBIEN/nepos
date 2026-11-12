import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const image=process.argv[2]??'nepos:local';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:30000}).trim();
const id=docker('run','-d','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=64m,mode=1777','--cap-drop','ALL','--security-opt','no-new-privileges',image);
try {
    // The CI job and Docker host can use different network namespaces.
    // Probe the real nginx/PHP processes inside the target container.
    const url='http://127.0.0.1:8080';
    const request=async (target,options={})=>{
        const args=['exec','-i',id,'curl','--silent','--show-error','--max-time','3','--write-out','\\n%{http_code}','--request',options.method??'GET'];
        if(options.body!==undefined)args.push('--header','Content-Type: text/plain','--data-binary','@-');
        args.push(target);
        const output=execFileSync('docker',args,{encoding:'utf8',input:options.body??'',timeout:10000,stdio:['pipe','pipe','pipe']});
        const separator=output.lastIndexOf('\n'),status=Number(output.slice(separator+1));
        return new Response(status===204?null:output.slice(0,separator),{status});
    };
    let ready=false;for(let i=0;i<40;i++){try{if((await request(url+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}assert.ok(ready,'nginx starts');
    assert.equal(docker('exec',id,'id','-u'),'10001');docker('exec',id,'php','-l','/app/signaling.php');docker('exec',id,'nginx','-e','/dev/stderr','-t','-c','/etc/nepos/nginx.conf');
    const html=await (await request(url+'/')).text();assert.ok(html.includes('Nepos'));assert.ok(!html.includes('browserTests'));assert.ok(!html.includes('Tests starten'));
    assert.equal((await request(url+'/tests/browser.html')).status,404);
    const token=type=>Buffer.from(JSON.stringify({type,sdp:'v=0\r\n'})).toString('base64');
    const offer=token('offer'),answer=token('answer');const created=await request(url+'/signaling.php?action=offer',{method:'POST',body:offer});assert.equal(created.status,200);const session=await created.json();assert.match(session.id,/^[a-f0-9]{32}$/);
    assert.equal(await (await request(url+`/signaling.php?action=offer&id=${session.id}`)).text(),offer);
    assert.equal((await request(url+`/signaling.php?action=answer&id=${session.id}`)).status,204);
    assert.equal((await request(url+`/signaling.php?action=answer&id=${session.id}`,{method:'POST',body:answer})).status,200);
    assert.equal(await (await request(url+`/signaling.php?action=answer&id=${session.id}`)).text(),answer);
    assert.equal((await request(url+`/signaling.php?action=answer&id=${session.id}`,{method:'POST',body:answer})).status,409);
    assert.equal((await request(url+'/signaling.php?action=offer&id=invalid')).status,400);
    assert.equal((await request(url+'/signaling.php?action=offer',{method:'POST',body:'x'.repeat(262145)})).status,413);
    console.log('PASS: rootless nginx/PHP, read-only filesystem, static app without test UI, complete signaling exchange and limits');
} catch(error) { console.error(docker('logs',id));throw error; }
finally { docker('rm','--force',id); }
