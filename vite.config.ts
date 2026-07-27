import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import http from 'http';
import https from 'https';

const JOY_COMPOSE_URL = 'https://5r0lrpa77tvw.joyapp.jd.com/compose.html';

function patchJoyComposeHtml(html: string) {
  const baseTag = '<base href="/joy-proxy/">';
  let patched = html.includes('<base ')
    ? html
    : html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);

  patched = patched.replace(
    'new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })',
    'new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true })',
  );

  // The embedded tool is an editor, so skip JOY's marketing home screen entirely.
  patched = patched.replace("setView('home');", "setView('gen');");

  // JOY uses absolute API paths. Once embedded under the local Vite origin,
  // those paths would hit the SPA and return Vite's public-base 404 page.
  // Route only the JOY API calls back through the existing upstream bridge.
  patched = patched.replaceAll('/api/user-proxy', '/joy-proxy/api/user-proxy');
  patched = patched.replaceAll('/api/agnes/chat', '/joy-proxy/api/agnes/chat');
  patched = patched.replaceAll('/api/agnes/image', '/joy-proxy/api/agnes/image');

  // Track JOY's live selection so the embedded controller and native panel share one state.
  patched = patched.replace(
    'let dogModel=null, baseScale=1, clips=[], mixer=null, currentAction=null, headMesh=null, grabProxy=null;',
    'let dogModel=null, baseScale=1, clips=[], mixer=null, currentAction=null, headMesh=null, grabProxy=null; let currentPoseName=null, currentFaceName=null;',
  );
  patched = patched.replace(
    'function setPose(name){\n  if(!mixer) return;',
    "function setPose(name){\n  currentPoseName=name;\n  document.querySelectorAll('#pose-grid button').forEach(b=>b.classList.toggle('active', b.textContent.trim()===name));\n  if(!mixer) return;",
  );
  patched = patched.replace(
    'function applyFace(name){\n  if(!headMesh) return;',
    'function applyFace(name){\n  currentFaceName=name;\n  if(!headMesh) return;',
  );

  const joyStateBridge = `
function getJoyState(){
  const num = id => {
    const el=document.getElementById(id);
    return el ? +el.value : null;
  };
  const checked = id => !!document.getElementById(id)?.checked;
  return {
    pose: currentPoseName,
    face: currentFaceName,
    hasBackground: !!scene.background?.isTexture,
    transform: {
      scale: dogGroup ? +dogGroup.scale.x.toFixed(2) : num('dog-scale'),
      yaw: dogGroup ? Math.round(THREE.MathUtils.radToDeg(dogGroup.rotation.y)) : num('dog-yaw'),
      pitch: dogGroup ? Math.round(THREE.MathUtils.radToDeg(dogGroup.rotation.x)) : num('dog-pitch'),
      roll: dogGroup ? Math.round(THREE.MathUtils.radToDeg(dogGroup.rotation.z)) : 0,
      x: dogGroup ? +dogGroup.position.x.toFixed(2) : num('dog-x'),
      y: dogGroup ? +dogGroup.position.y.toFixed(2) : num('dog-y'),
    },
    light: {
      exposure: num('exposure'),
      ambient: num('light-amb'),
      shadowOpacity: num('shadow-op'),
      shadowX: num('shadow-x'),
      shadowY: num('shadow-y'),
      shadowSize: num('shadow-size'),
      shadowEnabled: checked('shadow-on'),
      toneMatch: checked('tone-match'),
    },
    camera: {
      focalLength: camera?.isPerspectiveCamera
        ? +(12 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)).toFixed(1)
        : 85,
    },
  };
}
function getJoyCapabilities(){
  return {
    poses: [...document.querySelectorAll('#pose-grid button')].map(b => b.textContent.trim()),
    faces: [...document.querySelectorAll('#face-grid button')].map(b => ({
      label: b.textContent.trim(),
      value: b.dataset.face || b.textContent.trim(),
    })),
  };
}
let joyStateTimer=0;
function emitJoyState(includeCapabilities=false){
  clearTimeout(joyStateTimer);
  joyStateTimer=setTimeout(() => {
    window.parent.postMessage({
      _joy: true,
      type: 'stateChanged',
      state: getJoyState(),
      ...(includeCapabilities ? { capabilities: getJoyCapabilities() } : {}),
    }, '*');
  }, 16);
}
function setJoyInput(id, value, eventName='input'){
  const el=document.getElementById(id);
  if(!el || value == null) return;
  if(el.type==='checkbox') el.checked=!!value;
  else el.value=String(value);
  el.dispatchEvent(new Event(eventName, { bubbles:true }));
}
document.addEventListener('input', e => {
  if(e.target?.matches?.('#dog-scale,#dog-yaw,#dog-pitch,#dog-x,#dog-y,#exposure,#light-amb,#shadow-op,#shadow-x,#shadow-y,#shadow-size')) emitJoyState();
});
document.addEventListener('change', e => {
  if(e.target?.matches?.('#shadow-on,#tone-match')) emitJoyState();
  if(e.target?.matches?.('#bg-input')) {
    setTimeout(() => emitJoyState(), 250);
    setTimeout(() => emitJoyState(), 900);
  }
});
document.addEventListener('click', e => {
  if(e.target?.closest?.('#pose-grid button,#face-grid button')) emitJoyState();
  if(e.target?.closest?.('.bg-preset')) {
    setTimeout(() => emitJoyState(), 250);
    setTimeout(() => emitJoyState(), 900);
  }
});
document.addEventListener('pointerup', () => emitJoyState());

`;
  patched = patched.replace(
    '/* ===== postMessage API: 供外部 iframe 调用 3D 模型能力 ===== */',
    `${joyStateBridge}/* ===== postMessage API: 供外部 iframe 调用 3D 模型能力 ===== */`,
  );
  patched = patched.replace('buildPoseGrid();', 'buildPoseGrid(); emitJoyState(true);');

  // The upstream bridge calls an undefined setFace helper. Use its actual face loader.
  patched = patched.replace(
    "if (d.face && typeof setFace === 'function') { setFace(d.face); reply({ ok: true }); }",
    "if (d.face && typeof applyFace === 'function') { applyFace(d.face); emitJoyState(); reply({ ok: true, state: getJoyState() }); }",
  );

  patched = patched.replace(
    "if (d.pose && typeof setPose === 'function') { setPose(d.pose); reply({ ok: true }); }",
    "if (d.pose && typeof setPose === 'function') { setPose(d.pose); emitJoyState(); reply({ ok: true, state: getJoyState() }); }",
  );
  patched = patched.replace(
    '        syncXformPanel();\n        reply({ ok: true });',
    '        syncXformPanel();\n        emitJoyState();\n        reply({ ok: true, state: getJoyState() });',
  );
  patched = patched.replace(
    "    case 'setBackground':",
    `    case 'setLight':
      setJoyInput('exposure', d.exposure);
      setJoyInput('light-amb', d.ambient);
      setJoyInput('shadow-op', d.shadowOpacity);
      setJoyInput('shadow-x', d.shadowX);
      setJoyInput('shadow-y', d.shadowY);
      setJoyInput('shadow-size', d.shadowSize);
      setJoyInput('shadow-on', d.shadowEnabled, 'change');
      setJoyInput('tone-match', d.toneMatch, 'change');
      emitJoyState();
      reply({ ok: true, state: getJoyState() });
      break;
    case 'setCamera': {
      const focalLength = Math.min(200, Math.max(24, Number(d.focalLength) || 85));
      if (camera?.isPerspectiveCamera) {
        camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(12 / focalLength));
        camera.updateProjectionMatrix();
      }
      emitJoyState();
      reply({ ok: true, state: getJoyState() });
      break;
    }
    case 'getCapabilities':
      reply({ ok: true, capabilities: getJoyCapabilities(), state: getJoyState() });
      break;
    case 'setBackground':`,
  );
  patched = patched.replace(
    'if (existing) { existing.click(); reply({ ok: true }); }',
    "if (existing) { existing.click(); setTimeout(() => { emitJoyState(); reply({ ok: true, state: getJoyState() }); }, 300); }",
  );
  patched = patched.replace(
    'tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex;\n            matchToneToBackground(); reply({ ok: true });',
    'tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex;\n            if (tex.image?.width && tex.image?.height) { bgAspect = tex.image.width / tex.image.height; resize(); }\n            matchToneToBackground(); emitJoyState(); reply({ ok: true, state: getJoyState() });',
  );
  patched = patched.replaceAll(
    'bgAspect=tex.image.width/tex.image.height; resize(); matchToneToBackground();',
    'bgAspect=tex.image.width/tex.image.height; resize(); matchToneToBackground(); emitJoyState();',
  );

  // JOY only exposes a vertical shadow offset upstream. Add an independent
  // horizontal offset so the contact shadow can be aligned with perspective
  // and uneven ground without moving the character itself.
  patched = patched.replace(
    `<label class="lbl">Shadow Y</label>
  <div class="row"><input type="range" id="shadow-y" min="-2" max="2" step="0.01" value="0" /><span class="num" id="shadow-y-v">0.00</span></div>`,
    `<label class="lbl">Shadow X</label>
  <div class="row"><input type="range" id="shadow-x" min="-2" max="2" step="0.01" value="0" /><span class="num" id="shadow-x-v">0.00</span></div>
  <label class="lbl">Shadow Y</label>
  <div class="row"><input type="range" id="shadow-y" min="-2" max="2" step="0.01" value="0" /><span class="num" id="shadow-y-v">0.00</span></div>`,
  );
  patched = patched.replace(
    "bind('shadow-y',val=>{shadowYOff=val;},v=>v.toFixed(2));",
    "bind('shadow-x',val=>{shadowXOff=val;},v=>v.toFixed(2));\nbind('shadow-y',val=>{shadowYOff=val;},v=>v.toFixed(2));",
  );
  patched = patched.replace(
    `let shadowYOff=0, shadowSize=1;
function syncShadow(){ shadow.position.set(dogGroup.position.x+(shadowDirX||0),dogGroup.position.y+0.02+shadowYOff,dogGroup.position.z-0.1+(shadowDirZ||0)); const s=dogGroup.scale.x*shadowSize; shadow.scale.set(1.6*s,0.5*s,1); }`,
    `let shadowXOff=0, shadowYOff=0, shadowSize=1;
function syncShadow(){ shadow.position.set(dogGroup.position.x+(shadowDirX||0)+shadowXOff,dogGroup.position.y+0.02+shadowYOff,dogGroup.position.z-0.1+(shadowDirZ||0)); const s=dogGroup.scale.x*shadowSize; shadow.scale.set(1.6*s,0.5*s,1); }`,
  );

  // JOY's original layout reserves 1080px for standalone side panels. Inside
  // the embedded editor that collapses the canvas to 240px, so use nearly all
  // available iframe space while preserving the source image aspect ratio.
  patched = patched.replace(
    "const availW=Math.max(240, Math.min(innerWidth*0.6, innerWidth-1080)), availH=innerHeight-120-barH;",
    `const embedded = innerWidth < 1200;
  const availW = embedded
    ? Math.max(300, Math.min(innerWidth - 64, innerWidth * 0.82))
    : Math.max(480, Math.min(innerWidth * 0.68, innerWidth - 520));
  const availH = Math.max(300, innerHeight - (embedded ? 130 : 72) - barH);
  const stageWrap = document.getElementById('stage-wrap');
  if (stageWrap) {
    stageWrap.style.boxSizing = 'border-box';
    stageWrap.style.paddingTop = embedded ? '80px' : '0px';
  }`,
  );

  // Embedded right-drag is deliberately slower for precise placement. Commit
  // the final pointer position immediately so the host never restores stale XY.
  patched = patched.replace(
    'const k=0.0042*camera.position.z;',
    'const k=0.0016*camera.position.z;',
  );
  patched = patched.replace(
    "renderer.domElement.addEventListener('pointerup',e=>{ dragging=false; renderer.domElement.style.cursor = _hitsModel(e) ? 'grab' : 'default'; try{renderer.domElement.releasePointerCapture(e.pointerId);}catch(_){} });",
    "renderer.domElement.addEventListener('pointerup',e=>{ dragging=false; syncXformPanel(); emitJoyState(); renderer.domElement.style.cursor = _hitsModel(e) ? 'grab' : 'default'; try{renderer.domElement.releasePointerCapture(e.pointerId);}catch(_){} });",
  );
  patched = patched.replace(
    'if (d.pitch != null) dogGroup.rotation.x = (+d.pitch) * Math.PI / 180;',
    'if (d.pitch != null) dogGroup.rotation.x = (+d.pitch) * Math.PI / 180;\n        if (d.roll != null) dogGroup.rotation.z = (+d.roll) * Math.PI / 180;',
  );

  // Make direct bone posing easier inside the embedded editor. The upstream
  // controls are world-size spheres, which become difficult to hit when JOY is
  // scaled down. Use a screen-space hit radius and add a local-Z rotation ring
  // plus a precise slider for the selected joint.
  patched = patched.replace(
    '<div id="bone-sel-label" style="font-size:10px;color:var(--dim);margin-top:4px;">拖动任意关节球开始摆姿势</div>',
    `<div id="bone-rotation-row" style="margin-top:10px;padding:9px 10px;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:rgba(255,255,255,.035);">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <button type="button" class="gbtn" id="bone-mode-joint" style="height:30px;border-color:#ffd23f;color:#fff;">关节旋转</button>
        <button type="button" class="gbtn" id="bone-mode-overall" style="height:30px;">整体角色</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:11px;color:var(--muted);"><span id="bone-rotation-title">先选择一个关节</span><b id="bone-axis-val" style="color:#4da3ff;font-variant-numeric:tabular-nums;">0°</b></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:7px;">
        <button type="button" class="gbtn" data-bone-axis="x" style="height:26px;color:#ff4b55;">X</button>
        <button type="button" class="gbtn" data-bone-axis="y" style="height:26px;color:#49d77e;">Y</button>
        <button type="button" class="gbtn" data-bone-axis="z" style="height:26px;color:#4da3ff;border-color:#4da3ff;">Z</button>
      </div>
      <input id="bone-axis-rotation" type="range" min="-180" max="180" step="1" value="0" disabled style="width:100%;accent-color:#4da3ff;" />
      <div class="hint" style="margin-top:5px;">拖动红 X、绿 Y、蓝 Z 圆环旋转；滑杆用于精确调整</div>
    </div>
    <div id="bone-sel-label" style="font-size:11px;color:var(--dim);margin-top:7px;">点击或拖动任意关节球开始摆姿势</div>`,
  );
  patched = patched.replace(
    "let active=false, bonesMap=null, skel=null, dots=[], dotGroup=null, drag=null, hoverName=null, _dotR=0.05;",
    "let active=false, bonesMap=null, skel=null, dots=[], dotGroup=null, drag=null, hoverName=null, selectedHandle=null, rotationGizmo=null, rotationRings=[], gizmoMode='joint', activeAxis='z', _dotR=0.05;",
  );
  patched = patched.replace(
    'const _restQ={};      //',
    'const _restQ={}; const _restEuler={};      //',
  );
  patched = patched.replace(
    'for(const n in _restQ) delete _restQ[n]; for(const n in _restDirLocal) delete _restDirLocal[n];',
    'for(const n in _restQ) delete _restQ[n]; for(const n in _restEuler) delete _restEuler[n]; for(const n in _restDirLocal) delete _restDirLocal[n];',
  );
  patched = patched.replace(
    '_restQ[n]=b.quaternion.clone();',
    '_restQ[n]=b.quaternion.clone(); _restEuler[n]=b.rotation.clone();',
  );
  patched = patched.replace(
    "const resetBtn=document.getElementById('bone-reset');",
    "const resetBtn=document.getElementById('bone-reset');\n  const rotationRow=document.getElementById('bone-rotation-row'), axisInput=document.getElementById('bone-axis-rotation'), axisValue=document.getElementById('bone-axis-val'), rotationTitle=document.getElementById('bone-rotation-title'), modeJointBtn=document.getElementById('bone-mode-joint'), modeOverallBtn=document.getElementById('bone-mode-overall'), axisBtns=[...document.querySelectorAll('[data-bone-axis]')];",
  );
  patched = patched.replace(
    "_dotR=Math.max(0.015, (sz.y||1)*0.03);",
    "_dotR=Math.max(0.026, (sz.y||1)*0.045);",
  );
  patched = patched.replace(
    "const m=new THREE.Mesh(geo,mat); m.renderOrder=999; m.userData.h=h; dotGroup.add(m); dots.push(m);\n    });",
    `const m=new THREE.Mesh(geo,mat); m.renderOrder=999; m.userData.h=h; dotGroup.add(m); dots.push(m);
    });
    rotationGizmo=new THREE.Group(); rotationGizmo.renderOrder=1000; rotationGizmo.visible=false; dotGroup.add(rotationGizmo); rotationRings=[];
    const ringGeo=new THREE.TorusGeometry(1.7,0.055,10,64);
    [
      {axis:'x',color:0xff3545,rot:[0,Math.PI/2,0]},
      {axis:'y',color:0x27d86c,rot:[Math.PI/2,0,0]},
      {axis:'z',color:0x287dff,rot:[0,0,0]},
    ].forEach(def=>{
      const mat=new THREE.MeshBasicMaterial({color:def.color,depthTest:false,transparent:true,opacity:0.94,side:THREE.DoubleSide});
      const ring=new THREE.Mesh(ringGeo,mat); ring.rotation.set(...def.rot); ring.renderOrder=1001; ring.userData.axis=def.axis; rotationGizmo.add(ring); rotationRings.push(ring);
    });`,
  );
  patched = patched.replace(
    "dots.forEach(m=>{ const p=boneHead(m.userData.h.joint); if(!p){m.visible=false;return;} m.visible=true; m.position.copy(p); m.scale.setScalar(_dotR*(m.userData.h.name===hoverName?1.4:1)); m.material.color.setHex(m.userData.h.name===hoverName?0xffd23f:0x41d18c); });",
    `dots.forEach(m=>{ const p=boneHead(m.userData.h.joint); if(!p){m.visible=false;return;} m.visible=true; m.position.copy(p); const selected=selectedHandle===m.userData.h; m.scale.setScalar(_dotR*(selected?1.35:m.userData.h.name===hoverName?1.22:1)); m.material.color.setHex(selected?0xffd23f:m.userData.h.name===hoverName?0x9ff7d6:0x41d18c); });
    if(rotationGizmo){
      const target=rotationTarget(), isOverall=gizmoMode==='overall';
      const overallPoints=isOverall?dots.filter(d=>d.visible).map(d=>d.position.clone()):[];
      const overallBox=overallPoints.length?new THREE.Box3().setFromPoints(overallPoints):null;
      const p=isOverall&&overallBox ? overallBox.getCenter(new THREE.Vector3()) : selectedHandle&&boneHead(selectedHandle.joint);
      rotationGizmo.visible=!!(p&&target);
      if(p&&target){
        rotationGizmo.position.copy(p); target.getWorldQuaternion(rotationGizmo.quaternion);
        if(isOverall){ const size=overallBox.getSize(new THREE.Vector3()); rotationGizmo.scale.setScalar(Math.max(0.16,size.y*0.38)); }
        else rotationGizmo.scale.setScalar(_dotR);
        rotationRings.forEach(r=>{ const selected=r.userData.axis===activeAxis; r.material.opacity=selected?1:0.68; r.scale.setScalar(selected?1.08:1); });
      }
    }`,
  );
  patched = patched.replace(
    `function pickHandle(e){
    const r=renderer.domElement.getBoundingClientRect();
    _v.x=((e.clientX-r.left)/r.width)*2-1; _v.y=-((e.clientY-r.top)/r.height)*2+1;
    _ray.setFromCamera(_v,camera);
    const hit=_ray.intersectObjects(dots,false);
    return hit.length?hit[0].object:null;
  }`,
    `function screenPoint(world){
    const r=renderer.domElement.getBoundingClientRect(), p=world.clone().project(camera);
    return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
  }
  function pickHandle(e){
    let best=null, bestD=Infinity;
    dots.forEach(m=>{
      if(!m.visible) return;
      const p=screenPoint(m.position), d=Math.hypot(e.clientX-p.x,e.clientY-p.y);
      if(d<bestD){ bestD=d; best=m; }
    });
    return bestD<=20?best:null;
  }
  function ringHit(e){
    if(!rotationGizmo?.visible) return null;
    rotationGizmo.updateMatrixWorld(true);
    let best=null, bestD=Infinity;
    rotationRings.forEach(ring=>{
      const pts=[];
      for(let i=0;i<64;i++){
        const a=i/64*Math.PI*2;
        pts.push(screenPoint(new THREE.Vector3(Math.cos(a)*1.7,Math.sin(a)*1.7,0).applyMatrix4(ring.matrixWorld)));
      }
      pts.forEach((p,i)=>{
        const d=Math.hypot(e.clientX-p.x,e.clientY-p.y);
        if(d<bestD){
          const prev=pts[(i+63)%64], next=pts[(i+1)%64], tx=next.x-prev.x, ty=next.y-prev.y, len=Math.hypot(tx,ty)||1;
          bestD=d; best={axis:ring.userData.axis,tangent:{x:tx/len,y:ty/len}};
        }
      });
    });
    return bestD<=11?best:null;
  }`,
  );
  patched = patched.replace(
    `function applyDrag(e){
    if(!drag) return;
    const anchor=boneHead(drag.h.joint)||new THREE.Vector3();
    const p=screenToPlane(e, drag.anchor||anchor);
    if(drag.h.kind==='ik2') solveIK2(drag.h, p);
    else if(drag.h.kind==='hinge') solveHinge(drag.h, p);
    else if(drag.h.kind==='aim'){ solveAim(drag.h.aim, p); }
    updateDots();
  }

  function onDown(e){
    if(!active) return;
    const m=pickHandle(e); if(!m) return;             // 没点到关节球→放行给平移/旋转
    e.stopPropagation(); e.preventDefault();
    const h=m.userData.h;
    drag={h, anchor:boneHead(h.joint).clone()};
    renderer.domElement.setPointerCapture&&renderer.domElement.setPointerCapture(e.pointerId);
    selLabel.textContent='正在拖:'+h.name;
    renderer.domElement.style.cursor='grabbing';
  }
  function onMove(e){
    if(!active) return;
    if(drag){ applyDrag(e); return; }
    const m=pickHandle(e); const nm=m?m.userData.h.name:null;
    if(nm!==hoverName){ hoverName=nm; updateDots(); renderer.domElement.style.cursor=nm?'grab':'default'; }
  }
  function onUp(e){ if(drag){ drag=null; selLabel.textContent='松开。继续拖其它关节微调'; try{renderer.domElement.releasePointerCapture(e.pointerId);}catch(_){} } }`,
    `function rotationBone(h){
    if(!h) return null;
    if(h.kind==='aim') return bonesMap[h.aim];
    if(h.kind==='hinge') return bonesMap[h.mid];
    return bonesMap[h.end]||bonesMap[h.mid]||bonesMap[h.root];
  }
  function rotationTarget(){ return gizmoMode==='overall'?dogGroup:rotationBone(selectedHandle); }
  function axisColor(axis){ return axis==='x'?'#ff4b55':axis==='y'?'#49d77e':'#4da3ff'; }
  function setGizmoMode(mode){
    gizmoMode=mode==='overall'?'overall':'joint';
    const overall=gizmoMode==='overall';
    modeJointBtn.style.borderColor=overall?'':'#ffd23f'; modeOverallBtn.style.borderColor=overall?'#ffd23f':'';
    modeJointBtn.style.color=overall?'':'#fff'; modeOverallBtn.style.color=overall?'#fff':'';
    syncRotationUi(); updateDots();
    selLabel.textContent=overall?'整体角色旋转：拖动三色圆环':'关节旋转：先选择绿色控制点';
  }
  function setActiveAxis(axis){
    activeAxis=['x','y','z'].includes(axis)?axis:'z'; const color=axisColor(activeAxis);
    axisBtns.forEach(b=>b.style.borderColor=b.dataset.boneAxis===activeAxis?color:'');
    if(axisInput) axisInput.style.accentColor=color; if(axisValue) axisValue.style.color=color;
    syncRotationUi(); updateDots();
  }
  function syncRotationUi(){
    const target=rotationTarget(), isOverall=gizmoMode==='overall';
    if(axisInput) axisInput.disabled=!target;
    if(rotationTitle) rotationTitle.textContent=isOverall?'整体角色 · '+activeAxis.toUpperCase()+' 轴':target?(selectedHandle.name+' · '+activeAxis.toUpperCase()+' 轴'):'先选择一个关节';
    if(!target){ if(axisValue) axisValue.textContent='0°'; return; }
    const rest=isOverall?0:(_restEuler[target.name]?.[activeAxis]||0);
    const deg=Math.round(THREE.MathUtils.radToDeg(target.rotation[activeAxis]-rest));
    if(axisInput) axisInput.value=String(THREE.MathUtils.clamp(deg,-180,180));
    if(axisValue) axisValue.textContent=deg+'°';
  }
  function selectHandle(h){ selectedHandle=h||null; if(h) setGizmoMode('joint'); else{ syncRotationUi(); updateDots(); } }
  function applyDrag(e){
    if(!drag) return;
    if(drag.mode==='rotate'){
      const dx=e.clientX-drag.startX, dy=e.clientY-drag.startY;
      const angle=(dx*drag.tangent.x+dy*drag.tangent.y)*0.014;
      const axisVec=new THREE.Vector3(drag.axis==='x'?1:0,drag.axis==='y'?1:0,drag.axis==='z'?1:0);
      drag.target.quaternion.copy(drag.startQ).multiply(new THREE.Quaternion().setFromAxisAngle(axisVec,angle));
      if(drag.pivotLocal&&drag.startPosition&&drag.startPivot){
        dogGroup.position.copy(drag.startPosition); dogGroup.updateMatrixWorld(true);
        const movedPivot=dogGroup.localToWorld(drag.pivotLocal.clone());
        dogGroup.position.add(drag.startPivot.clone().sub(movedPivot));
      }
      dogGroup.updateMatrixWorld(true); if(gizmoMode==='overall') syncXformPanel(); syncRotationUi(); updateDots(); return;
    }
    const anchor=boneHead(drag.h.joint)||new THREE.Vector3();
    const p=screenToPlane(e, drag.anchor||anchor);
    if(drag.h.kind==='ik2') solveIK2(drag.h, p);
    else if(drag.h.kind==='hinge') solveHinge(drag.h, p);
    else if(drag.h.kind==='aim'){ solveAim(drag.h.aim, p); }
    syncRotationUi(); updateDots();
  }

  function onDown(e){
    if(!active) return;
    const ring=ringHit(e);
    if(ring){
      const target=rotationTarget(); if(!target) return;
      e.stopPropagation(); e.preventDefault();
      setActiveAxis(ring.axis);
      const overall=gizmoMode==='overall', pivot=overall?rotationGizmo.position.clone():null;
      drag={mode:'rotate',h:selectedHandle,target,axis:ring.axis,tangent:ring.tangent,startX:e.clientX,startY:e.clientY,startQ:target.quaternion.clone(),startPosition:overall?dogGroup.position.clone():null,startPivot:pivot,pivotLocal:overall?dogGroup.worldToLocal(pivot.clone()):null};
      renderer.domElement.setPointerCapture&&renderer.domElement.setPointerCapture(e.pointerId);
      selLabel.textContent='正在旋转:'+(gizmoMode==='overall'?'整体角色':selectedHandle.name)+'（'+ring.axis.toUpperCase()+' 轴）'; renderer.domElement.style.cursor='grabbing'; return;
    }
    const m=pickHandle(e); if(!m) return;
    e.stopPropagation(); e.preventDefault();
    const h=m.userData.h; selectHandle(h);
    drag={mode:'move',h,anchor:boneHead(h.joint).clone()};
    renderer.domElement.setPointerCapture&&renderer.domElement.setPointerCapture(e.pointerId);
    selLabel.textContent='正在拖:'+h.name+'；三色圆环可旋转';
    renderer.domElement.style.cursor='grabbing';
  }
  function onMove(e){
    if(!active) return;
    if(drag){ applyDrag(e); return; }
    const onRing=ringHit(e), m=onRing?null:pickHandle(e), nm=m?m.userData.h.name:null;
    if(nm!==hoverName){ hoverName=nm; updateDots(); }
    renderer.domElement.style.cursor=onRing?'crosshair':nm?'grab':'default';
  }
  function onUp(e){ if(drag){ const wasRotate=drag.mode==='rotate'; drag=null; selLabel.textContent=wasRotate?'旋转已应用，可继续拖动其它轴':'松开。三色圆环可做 X / Y / Z 旋转'; emitJoyState(); try{renderer.domElement.releasePointerCapture(e.pointerId);}catch(_){} } }`,
  );
  patched = patched.replace(
    "active=false; window.__boneEditActive=false; drag=null; hoverName=null;",
    "active=false; window.__boneEditActive=false; drag=null; hoverName=null; selectedHandle=null; if(rotationGizmo) rotationGizmo.visible=false;",
  );
  patched = patched.replace(
    "resetBtn.addEventListener('click',()=>{ if(skel){ skel.pose(); dogGroup.updateMatrixWorld(true); updateDots(); selLabel.textContent='已回到站姿'; } });",
    `resetBtn.addEventListener('click',()=>{
    if(gizmoMode==='overall'&&dogGroup){ dogGroup.rotation.set(0,0,0); syncXformPanel(); selLabel.textContent='整体旋转已重置'; }
    else if(skel){ skel.pose(); selLabel.textContent='骨骼已回到站姿'; }
    dogGroup.updateMatrixWorld(true); syncRotationUi(); updateDots(); emitJoyState();
  });
  modeJointBtn.addEventListener('click',()=>setGizmoMode('joint'));
  modeOverallBtn.addEventListener('click',()=>setGizmoMode('overall'));
  axisBtns.forEach(btn=>btn.addEventListener('click',()=>setActiveAxis(btn.dataset.boneAxis)));
  if(axisInput) axisInput.addEventListener('input',()=>{
    const target=rotationTarget(); if(!target) return;
    const rest=gizmoMode==='overall'?0:(_restEuler[target.name]?.[activeAxis]||0);
    target.rotation[activeAxis]=rest+THREE.MathUtils.degToRad(Number(axisInput.value)||0);
    dogGroup.updateMatrixWorld(true); if(gizmoMode==='overall') syncXformPanel(); if(axisValue) axisValue.textContent=Math.round(Number(axisInput.value)||0)+'°'; updateDots(); emitJoyState();
  });`,
  );

  patched = patched.replace(
    /    case 'getState':\s*reply\(\{\s*ok: true,\s*pose: typeof currentPoseName !== 'undefined' \? currentPoseName : null,\s*scale: dogGroup \? dogGroup\.scale\.x : null,\s*yaw: dogGroup \? Math\.round\(THREE\.MathUtils\.radToDeg\(dogGroup\.rotation\.y\)\) : null,\s*x: dogGroup \? \+dogGroup\.position\.x\.toFixed\(2\) : null,\s*y: dogGroup \? \+dogGroup\.position\.y\.toFixed\(2\) : null,\s*bg: scene\.background \? 'set' : null,\s*\}\);\s*break;/,
    `    case 'getState':
      reply({ ok: true, state: getJoyState(), capabilities: getJoyCapabilities() });
      break;`,
  );

  // Keep the current pose/transform and temporarily remove scene-only pixels for PNG capture.
  patched = patched.replace(
    /case 'capture':\s*setView\('gen'\);\s*requestAnimationFrame\(\(\) => \{\s*renderer\.render\(scene, camera\);\s*const dataUrl = renderer\.domElement\.toDataURL\('image\/png'\);\s*reply\(\{ ok: true, image: dataUrl \}\);\s*\}\);\s*break;/,
    `case 'capture': {
      const savedBackground = scene.background;
      const savedShadowVisible = shadow ? shadow.visible : false;
      const hasBackground = !!savedBackground?.isTexture;
      const transparent = d.transparent == null ? !hasBackground : d.transparent !== false;
      if (transparent) {
        scene.background = null;
        if (shadow) shadow.visible = false;
        renderer.setClearColor(0x000000, 0);
      }
      requestAnimationFrame(() => {
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');
        if (transparent) {
          scene.background = savedBackground;
          if (shadow) shadow.visible = savedShadowVisible;
          renderer.setClearColor(0x000000, 1);
          renderer.render(scene, camera);
        }
        reply({ ok: true, image: dataUrl, transparent, hasBackground });
      });
      break;
    }`,
  );

  // Surface the shared LottieKey library directly in JOY's background section.
  patched = patched.replace(
    '<label class="file-input" id="bg-label">Upload background image or video<input type="file" id="bg-input" accept="image/*,video/*,.ts,video/mp2t" hidden /></label>',
    `<label class="file-input" id="bg-label">Upload background image or video<input type="file" id="bg-input" accept="image/*,video/*,.ts,video/mp2t" hidden /></label>
  <button type="button" class="ghost" id="lk-bg-library" style="width:100%;margin-top:10px;" onclick="window.parent.postMessage({_joy:true,type:'requestBackgroundLibrary'},'*')">从素材仓库选择背景</button>`,
  );

  // Notify the host whenever JOY creates a new AI result so it can enter the same library.
  patched = patched.replace(
    "function addToHistory(url,type){ const h=loadHistory(); h.unshift({url, ts:Date.now(), type:type||'image'}); saveHistory(h); }",
    "function addToHistory(url,type,prompt,notify){ const asset={url, ts:Date.now(), type:type||'image', prompt:prompt||'JOY AI 合成结果'}; const h=loadHistory(); h.unshift(asset); saveHistory(h); if(notify!==false) window.parent.postMessage({_joy:true,type:'generatedAsset',asset},'*'); }",
  );
  patched = patched.replace(
    'addToHistory(localPath||imgUrl);',
    "addToHistory(localPath||imgUrl,'image',prompt,false);",
  );
  patched = patched.replace(
    "document.getElementById('gen-btn').addEventListener('click',async()=>{",
    "document.getElementById('gen-btn').addEventListener('click',async()=>{ window.parent.postMessage({_joy:true,type:'generationStarted'},'*');",
  );
  patched = patched.replace(
    "addToHistory(localPath||imgUrl,'image',prompt,false);",
    `addToHistory(localPath||imgUrl,'image',prompt,false);
    const adoptedUrl=localPath||imgUrl;
    const resultImg=resultEl.querySelector('img');
    if(resultImg){ resultImg.style.maxHeight='48vh'; resultImg.style.width='100%'; resultImg.style.objectFit='contain'; }
    let adoptBtn=document.getElementById('lk-adopt-generated-result');
    if(!adoptBtn){
      adoptBtn=document.createElement('button');
      adoptBtn.id='lk-adopt-generated-result';
      adoptBtn.type='button';
      adoptBtn.textContent='保存并制作动态图鉴  →';
      adoptBtn.style.cssText='align-items:center;justify-content:center;width:100%;height:48px;margin-top:12px;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#f20d18;color:#fff;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(242,13,24,.28);';
      resultEl.appendChild(adoptBtn);
    }
    window.__lkSyncWorkflowButton=()=>{ adoptBtn.style.display=window.__lkWorkflowMode?'flex':'none'; };
    window.__lkSyncWorkflowButton();
    adoptBtn.onclick=()=>window.parent.postMessage({_joy:true,type:'adoptGeneratedAsset',destination:'dynamic',asset:{url:adoptedUrl,type:'image',prompt}},'*');`,
  );
  patched = patched.replace(
    'resultEl.innerHTML=`<div class="hint">✓ 生成结果:</div><img src="${imgUrl}" style="max-width:100%;border-radius:8px;cursor:pointer;" onclick="window.open(this.src)">`;',
    `resultEl.innerHTML=\`<div class="hint">✓ 生成结果:</div><img src="\${imgUrl}" style="max-width:100%;border-radius:8px;cursor:pointer;" onclick="window.open(this.src)">\`;
    const immediateAsset={url:imgUrl,ts:Date.now(),type:'image',prompt:prompt||'JOY AI 合成结果'};
    window.parent.postMessage({_joy:true,type:'generatedAsset',asset:immediateAsset},'*');
    const immediateResultImg=resultEl.querySelector('img');
    if(immediateResultImg){ immediateResultImg.style.maxHeight='48vh'; immediateResultImg.style.width='100%'; immediateResultImg.style.objectFit='contain'; }
    let immediateBtn=document.getElementById('lk-adopt-generated-result');
    if(!immediateBtn){
      immediateBtn=document.createElement('button');
      immediateBtn.id='lk-adopt-generated-result';
      immediateBtn.type='button';
      immediateBtn.textContent='保存并制作动态图鉴  →';
      immediateBtn.style.cssText='align-items:center;justify-content:center;width:100%;height:48px;margin-top:12px;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#f20d18;color:#fff;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(242,13,24,.28);';
      resultEl.appendChild(immediateBtn);
    }
    window.__lkSyncWorkflowButton=()=>{ immediateBtn.style.display=window.__lkWorkflowMode?'flex':'none'; };
    window.__lkSyncWorkflowButton();
    immediateBtn.onclick=()=>window.parent.postMessage({_joy:true,type:'adoptGeneratedAsset',destination:'dynamic',asset:immediateAsset},'*');`,
  );

  patched = patched.replace(
    '</body>',
    `<script>
window.__lkWorkflowMode=false;
window.addEventListener('message',function(event){
  const data=event.data;
  if(data&&data._lottiekey&&data.type==='workflowMode'){
    window.__lkWorkflowMode=Boolean(data.enabled);
    if(window.__lkSyncWorkflowButton) window.__lkSyncWorkflowButton();
  }
});
</script></body>`,
  );

  const imagePreviewGuard = `
<style id="lottiekey-joy-image-preview-style">
  #lk-image-preview {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 54px 28px 32px;
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(10px);
  }
  #lk-image-preview.lk-open { display: flex; }
  #lk-image-preview img {
    max-width: min(100%, 1280px);
    max-height: calc(100vh - 110px);
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.48);
  }
  #lk-image-preview .lk-preview-actions {
    position: fixed;
    top: 16px;
    right: 18px;
    display: flex;
    gap: 10px;
    align-items: center;
  }
  #lk-image-preview button {
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 14px;
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 6px;
    background: rgba(22,24,30,0.82);
    color: rgba(255,255,255,0.88);
    font: 700 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-decoration: none;
    cursor: pointer;
  }
  #lk-image-preview button:hover {
    background: rgba(255,255,255,0.12);
    color: #fff;
  }
  #lk-image-preview .lk-preview-save {
    border-color: rgba(79,124,255,0.58);
    background: rgba(79,124,255,0.2);
  }
  #lk-image-preview button:disabled {
    opacity: 0.58;
    cursor: wait;
  }
  #lk-image-preview .lk-preview-close {
    width: 36px;
    padding: 0;
    font-size: 20px;
  }
</style>
<script id="lottiekey-joy-image-preview-guard">
(() => {
  if (window.__lottiekeyImagePreviewGuard) return;
  window.__lottiekeyImagePreviewGuard = true;

  const isImageUrl = (url) => {
    if (!url) return false;
    if (/^data:image\\//i.test(url) || /^blob:/i.test(url)) return true;
    try {
      const parsed = new URL(url, location.href);
      return /\\.(png|jpe?g|webp|gif|avif)(\\?|#|$)/i.test(parsed.pathname) ||
        /[?&](image|img|format|mime)=/i.test(parsed.search);
    } catch {
      return /\\.(png|jpe?g|webp|gif|avif)(\\?|#|$)/i.test(url);
    }
  };

  const looksLikeDownload = (node) => {
    if (!node) return false;
    const text = (node.textContent || '').trim().toLowerCase();
    const label = [
      node.getAttribute?.('title'),
      node.getAttribute?.('aria-label'),
      node.getAttribute?.('class'),
      node.getAttribute?.('download'),
    ].filter(Boolean).join(' ').toLowerCase();
    return text.includes('下载') || text.includes('download') || label.includes('下载') || label.includes('download');
  };

  const getImageUrlNear = (node) => {
    const anchor = node?.closest?.('a[href]');
    if (anchor && isImageUrl(anchor.href)) return anchor.href;
    for (let el = node; el && el !== document.body; el = el.parentElement) {
      const href = el.getAttribute?.('href');
      if (href && isImageUrl(href)) return new URL(href, location.href).href;
      const img = el.querySelector?.('img');
      const src = img && (img.currentSrc || img.src || img.getAttribute('src'));
      if (src && isImageUrl(src)) return new URL(src, location.href).href;
      const style = el.getAttribute?.('style') || '';
      const bg = style.match(/url\\(["']?([^"')]+)["']?\\)/i)?.[1];
      if (bg && isImageUrl(bg)) return new URL(bg, location.href).href;
    }
    return '';
  };

  const getPreviewUrl = (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (anchor && isImageUrl(anchor.href)) return anchor.href;
    const img = event.target?.closest?.('img');
    if (!img) return '';
    const inGeneratedArea = img.closest('#history,#hist-list,#result,#results,#panel-history,.history,.result,.results,.gallery,.output,.outputs,.generated,.card');
    if (!inGeneratedArea) return '';
    const src = img.currentSrc || img.src || img.getAttribute('src') || '';
    return isImageUrl(src) ? src : '';
  };

  const toDownloadUrl = (url) => {
    if (/^(data:|blob:)/i.test(url)) return url;
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin === location.origin) return parsed.href;
      return '/remote-asset?u=' + encodeURIComponent(parsed.href);
    } catch {
      return url;
    }
  };

  const directDownload = (url) => {
    const anchor = document.createElement('a');
    anchor.href = toDownloadUrl(url);
    anchor.download = 'joy-image-' + Date.now() + '.png';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const requestHostAction = (operation, url) => {
    if (!url) return;
    const overlay = document.getElementById('lk-image-preview');
    const button = overlay?.querySelector(operation === 'save' ? '.lk-preview-save' : '.lk-preview-download');
    const requestId = 'asset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    if (button) {
      button.disabled = true;
      button.textContent = operation === 'save' ? '正在保存...' : '正在下载...';
    }
    window.parent.postMessage({
      _joy: true,
      type: 'assetActionRequest',
      operation,
      requestId,
      asset: { url, type: 'image', prompt: 'JOY 图片素材' },
    }, '*');
  };

  const ensureOverlay = () => {
    let overlay = document.getElementById('lk-image-preview');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'lk-image-preview';
    overlay.innerHTML = '<div class="lk-preview-actions"><button type="button" class="lk-preview-download">下载到本地</button><button type="button" class="lk-preview-save">存入仓库</button><button type="button" class="lk-preview-back">返回编辑</button><button type="button" class="lk-preview-close" aria-label="关闭">×</button></div><img alt="preview" draggable="false" />';
    document.body.appendChild(overlay);
    const close = () => overlay.classList.remove('lk-open');
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector('.lk-preview-back')?.addEventListener('click', close);
    overlay.querySelector('.lk-preview-close')?.addEventListener('click', close);
    overlay.querySelector('.lk-preview-download')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      requestHostAction('download', overlay.dataset.url || overlay.querySelector('img')?.src || '');
    });
    overlay.querySelector('.lk-preview-save')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      requestHostAction('save', overlay.dataset.url || overlay.querySelector('img')?.src || '');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay.classList.contains('lk-open')) close();
    });
    return overlay;
  };

  const openPreview = (url) => {
    const overlay = ensureOverlay();
    const img = overlay.querySelector('img');
    const download = overlay.querySelector('.lk-preview-download');
    const save = overlay.querySelector('.lk-preview-save');
    img.src = url;
    overlay.dataset.url = url;
    if (download) { download.disabled = false; download.textContent = '下载到本地'; }
    if (save) { save.disabled = false; save.textContent = '存入仓库'; }
    overlay.classList.add('lk-open');
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data?._lottiekey || data.type !== 'assetActionResult') return;
    const overlay = document.getElementById('lk-image-preview');
    const button = overlay?.querySelector(data.operation === 'save' ? '.lk-preview-save' : '.lk-preview-download');
    if (!button) return;
    button.disabled = false;
    button.textContent = data.message || (data.ok ? '操作成功' : '操作失败');
    if (data.operation === 'download' || !data.ok) {
      setTimeout(() => {
        button.textContent = data.operation === 'save' ? '存入仓库' : '下载到本地';
      }, 1800);
    }
  });

  document.addEventListener('click', (event) => {
    const control = event.target?.closest?.('button,a,[role="button"]');
    if (looksLikeDownload(control)) {
      const url = control?.closest?.('#lk-image-preview')
        ? document.getElementById('lk-image-preview')?.dataset.url
        : getImageUrlNear(control);
      if (url && isImageUrl(url)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        requestHostAction('download', url);
        return;
      }
    }
    const url = getPreviewUrl(event);
    if (!url) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openPreview(url);
  }, true);
})();
</script>`;

  const adjustableGeneratePanel = `
<style id="lottiekey-joy-panel-ui">
  #topnav button[data-nav="home"] { display: none !important; }
  #pop-gen.lk-adjustable {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 320px;
    min-height: 180px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
  }
  #pop-gen.lk-adjustable > .pop-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex: 0 0 auto;
    cursor: move;
    user-select: none;
  }
  #pop-gen.lk-adjustable > #panel-gen {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }
  #pop-gen .lk-panel-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  #pop-gen .lk-panel-toggle {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 4px;
    background: rgba(255,255,255,0.05);
    color: rgba(255,255,255,0.72);
    font: 600 17px/1 monospace;
    cursor: pointer;
  }
  #pop-gen .lk-panel-toggle:hover {
    background: rgba(255,255,255,0.1);
    color: #fff;
  }
  #pop-gen .lk-resize-handle {
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 20px;
    height: 20px;
    z-index: 12;
    cursor: nwse-resize;
    opacity: 0.7;
    background:
      linear-gradient(135deg, transparent 0 48%, rgba(255,255,255,0.2) 49% 55%, transparent 56%),
      linear-gradient(135deg, transparent 0 66%, rgba(255,255,255,0.48) 67% 73%, transparent 74%);
  }
  #pop-gen .lk-resize-handle:hover { opacity: 1; }
  #pop-gen.lk-collapsed {
    width: 240px !important;
    height: 48px !important;
    min-width: 240px;
    min-height: 48px;
  }
  #pop-gen.lk-collapsed > #panel-gen,
  #pop-gen.lk-collapsed > .lk-resize-handle {
    display: none !important;
  }
  #edit-panel {
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }
  #edit-panel.lk-hidden { display: none !important; }
  #edit-panel .lk-edit-drag-handle {
    position: sticky;
    top: 0;
    z-index: 20;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: -4px 0 10px;
    padding: 0 2px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    background: linear-gradient(180deg, rgba(18,20,25,0.98), rgba(18,20,25,0.9));
    cursor: move;
    user-select: none;
    touch-action: none;
  }
  #edit-panel .lk-edit-drag-grip {
    width: 34px;
    height: 14px;
    opacity: 0.42;
    background-image: radial-gradient(circle, rgba(255,255,255,0.8) 0 1px, transparent 1.5px);
    background-size: 7px 7px;
  }
  #edit-panel .lk-edit-close {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 4px;
    background: #15171c;
    color: rgba(255,255,255,0.75);
    font: 500 18px/1 sans-serif;
    cursor: pointer;
  }
  #edit-panel .lk-edit-close:hover {
    color: #fff;
    background: #242730;
    border-color: rgba(255,255,255,0.3);
  }
</style>
<script id="lottiekey-joy-panel-controls">
(() => {
  const panel = document.getElementById('pop-gen');
  const title = panel && panel.querySelector('.pop-title');
  if (!panel || !title || panel.dataset.lkAdjustable === 'true') return;

  panel.dataset.lkAdjustable = 'true';
  panel.classList.add('lk-adjustable');
  title.title = '拖动标题栏移动面板';

  const actions = document.createElement('span');
  actions.className = 'lk-panel-actions';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'lk-panel-toggle';
  toggle.textContent = '-';
  toggle.title = '收起生成面板';
  toggle.setAttribute('aria-label', '收起生成面板');
  actions.appendChild(toggle);
  title.appendChild(actions);

  const handle = document.createElement('span');
  handle.className = 'lk-resize-handle';
  handle.title = '拖动调整面板大小';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', '拖动调整面板大小');
  panel.appendChild(handle);

  const anchorPanel = (rect) => {
    panel.style.transform = 'none';
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  let dragState = null;
  let resizeState = null;

  // Capture-phase delegation survives JOY rebuilding the panel contents.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('#pop-gen .lk-panel-toggle');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const now = Date.now();
    const lastToggle = Number(panel.dataset.lkToggleAt || 0);
    if (now - lastToggle < 250) return;
    panel.dataset.lkToggleAt = String(now);
    const collapsed = panel.classList.toggle('lk-collapsed');
    button.textContent = collapsed ? '+' : '-';
    button.title = collapsed ? '展开生成面板' : '收起生成面板';
    button.setAttribute('aria-label', button.title);
  }, true);

  document.addEventListener('pointerdown', (event) => {
    const currentHandle = event.target.closest('#pop-gen .lk-resize-handle');
    const currentTitle = event.target.closest('#pop-gen .pop-title');
    if (event.button !== 0 || (!currentHandle && !currentTitle)) return;

    if (currentHandle) {
      if (panel.classList.contains('lk-collapsed')) return;
      const rect = panel.getBoundingClientRect();
      anchorPanel(rect);
      resizeState = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
      };
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.target.closest('.lk-panel-actions')) return;
    const rect = panel.getBoundingClientRect();
    anchorPanel(rect);
    dragState = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.preventDefault();
    event.stopPropagation();
  }, true);

  document.addEventListener('pointermove', (event) => {
    if (dragState && event.pointerId === dragState.id) {
      const maxLeft = Math.max(8, innerWidth - panel.offsetWidth - 8);
      const maxTop = Math.max(8, innerHeight - panel.offsetHeight - 8);
      panel.style.left = Math.min(maxLeft, Math.max(8, event.clientX - dragState.dx)) + 'px';
      panel.style.top = Math.min(maxTop, Math.max(8, event.clientY - dragState.dy)) + 'px';
    }
    if (!resizeState || event.pointerId !== resizeState.id) return;
    const maxWidth = Math.max(320, innerWidth - resizeState.left - 8);
    const maxHeight = Math.max(180, innerHeight - resizeState.top - 8);
    panel.style.width = Math.min(maxWidth, Math.max(320, resizeState.width + event.clientX - resizeState.x)) + 'px';
    panel.style.height = Math.min(maxHeight, Math.max(180, resizeState.height + event.clientY - resizeState.y)) + 'px';
  }, true);

  const stopInteraction = (event) => {
    if (dragState && event.pointerId === dragState.id) dragState = null;
    if (resizeState && event.pointerId === resizeState.id) resizeState = null;
  };
  document.addEventListener('pointerup', stopInteraction, true);
  document.addEventListener('pointercancel', stopInteraction, true);
})();

(() => {
  const editPanel = document.getElementById('edit-panel');
  const generateNav = document.querySelector('#topnav button[data-nav="gen"]');
  if (!editPanel || !generateNav || editPanel.dataset.lkCollapsible === 'true') return;

  editPanel.dataset.lkCollapsible = 'true';
  const dragHandle = document.createElement('div');
  dragHandle.className = 'lk-edit-drag-handle';
  dragHandle.title = '拖动移动编辑面板';
  dragHandle.setAttribute('aria-label', '拖动移动编辑面板');
  const grip = document.createElement('span');
  grip.className = 'lk-edit-drag-grip';
  grip.setAttribute('aria-hidden', 'true');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'lk-edit-close';
  close.textContent = 'x';
  close.title = '收起编辑面板';
  close.setAttribute('aria-label', '收起编辑面板');
  dragHandle.appendChild(grip);
  dragHandle.appendChild(close);
  editPanel.insertBefore(dragHandle, editPanel.firstChild);

  const anchorEditPanel = (rect) => {
    editPanel.style.transform = 'none';
    editPanel.style.left = rect.left + 'px';
    editPanel.style.top = rect.top + 'px';
    editPanel.style.right = 'auto';
    editPanel.style.bottom = 'auto';
  };

  const clampEditPanel = () => {
    if (editPanel.classList.contains('lk-hidden') || getComputedStyle(editPanel).display === 'none') return;
    const margin = 12;
    const rect = editPanel.getBoundingClientRect();
    const maxLeft = Math.max(margin, innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, innerHeight - rect.height - margin);
    anchorEditPanel(rect);
    editPanel.style.left = Math.min(maxLeft, Math.max(margin, rect.left)) + 'px';
    editPanel.style.top = Math.min(maxTop, Math.max(margin, rect.top)) + 'px';
  };

  const scheduleClamp = () => requestAnimationFrame(() => requestAnimationFrame(clampEditPanel));
  let editDrag = null;
  dragHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.lk-edit-close')) return;
    clampEditPanel();
    const rect = editPanel.getBoundingClientRect();
    editDrag = {
      id: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    };
    dragHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });
  dragHandle.addEventListener('pointermove', (event) => {
    if (!editDrag || event.pointerId !== editDrag.id) return;
    const margin = 12;
    const maxLeft = Math.max(margin, innerWidth - editPanel.offsetWidth - margin);
    const maxTop = Math.max(margin, innerHeight - editPanel.offsetHeight - margin);
    editPanel.style.left = Math.min(maxLeft, Math.max(margin, event.clientX - editDrag.dx)) + 'px';
    editPanel.style.top = Math.min(maxTop, Math.max(margin, event.clientY - editDrag.dy)) + 'px';
  });
  const stopEditDrag = (event) => {
    if (editDrag && event.pointerId === editDrag.id) editDrag = null;
  };
  dragHandle.addEventListener('pointerup', stopEditDrag);
  dragHandle.addEventListener('pointercancel', stopEditDrag);

  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    editPanel.classList.add('lk-hidden');
  });

  generateNav.addEventListener('click', (event) => {
    const now = Date.now();
    const lastToggle = Number(generateNav.dataset.lkToggleAt || 0);
    if (now - lastToggle < 250) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    generateNav.dataset.lkToggleAt = String(now);
    const alreadyInGenerate = document.body.dataset.view === 'gen';
    if (alreadyInGenerate && !editPanel.classList.contains('lk-hidden')) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      editPanel.classList.add('lk-hidden');
      return;
    }
    editPanel.classList.remove('lk-hidden');
    scheduleClamp();
  }, true);

  new MutationObserver(() => {
    if (document.body.dataset.view !== 'gen') editPanel.classList.remove('lk-hidden');
    else scheduleClamp();
  }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
  addEventListener('resize', scheduleClamp);
  scheduleClamp();
})();
</script>`;

  patched = patched.replace(/<\/body>/i, `${imagePreviewGuard}${adjustableGeneratePanel}</body>`);

  return patched;
}

function joyComposeBridge(): Plugin {
  return {
    name: 'joy-compose-bridge',
    configureServer(server) {
      server.middlewares.use('/joy-proxy', (req, res) => {
        const target = new URL(req.url || '/', 'https://5r0lrpa77tvw.joyapp.jd.com/');
        const upstream = https.request(target, {
          method: req.method,
          headers: {
            ...(req.headers.range ? { range: req.headers.range as string } : {}),
            ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] as string } : {}),
            ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] as string } : {}),
            ...(req.headers.accept ? { accept: req.headers.accept as string } : {}),
            'user-agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
          },
        }, (upstreamRes) => {
          res.statusCode = upstreamRes.statusCode || 200;
          for (const [key, value] of Object.entries(upstreamRes.headers)) {
            if (value === undefined || /^access-control-/i.test(key)) continue;
            res.setHeader(key, value as string | string[]);
          }
          res.setHeader('access-control-allow-origin', '*');
          upstreamRes.pipe(res);
        });
        upstream.on('error', (err) => {
          console.error('[joy-proxy] error:', err.message);
          res.statusCode = 502;
          res.end('JOY asset unavailable');
        });
        req.pipe(upstream);
      });

      server.middlewares.use('/joy-compose', (_req, res) => {
        https.get(JOY_COMPOSE_URL, {
          headers: { 'user-agent': 'Mozilla/5.0' },
        }, (upstream) => {
          if ((upstream.statusCode || 500) >= 400) {
            res.statusCode = upstream.statusCode || 502;
            res.end('JOY upstream error');
            upstream.resume();
            return;
          }

          const chunks: Buffer[] = [];
          upstream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          upstream.on('end', () => {
            const html = patchJoyComposeHtml(Buffer.concat(chunks).toString('utf8'));
            res.statusCode = 200;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(html);
          });
        }).on('error', (err) => {
          console.error('[joy-compose] error:', err.message);
          res.statusCode = 502;
          res.end('JOY bridge unavailable');
        });
      });
    },
  };
}

// 移除 crossorigin 属性，兼容更多部署环境
function removeCrossorigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '');
    },
  };
}

// 强制下载远端图片，确保 iframe / 跨域资源不会退化成网页预览。
function downloadAssetProxy(): Plugin {
  return {
    name: 'download-asset-proxy',
    configureServer(server) {
      server.middlewares.use('/download-asset', (req, res) => {
        try {
          const raw = new URL(req.url || '', 'http://x').searchParams.get('u');
          if (!raw) {
            res.statusCode = 400;
            res.end('missing u');
            return;
          }
          const target = new URL(raw);
          const client = target.protocol === 'http:' ? http : https;
          const extension = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov'].includes(path.extname(target.pathname).toLowerCase())
            ? path.extname(target.pathname).toLowerCase()
            : '.bin';
          const upstream = client.request({
            method: req.method,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: target.pathname + target.search,
            headers: {
              'user-agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
            },
          }, (upRes) => {
            for (const [key, value] of Object.entries(upRes.headers)) {
              if (value === undefined || /^access-control-|^content-disposition$/i.test(key)) continue;
              res.setHeader(key, value as string | string[]);
            }
            res.statusCode = upRes.statusCode || 200;
            res.setHeader('access-control-allow-origin', '*');
            res.setHeader('content-disposition', `attachment; filename="joy-image-${Date.now()}${extension}"`);
            upRes.pipe(res);
          });
          upstream.on('error', (error) => {
            console.error('[download-asset] error:', error.message);
            res.statusCode = 502;
            res.end('download unavailable');
          });
          upstream.end();
        } catch (error: any) {
          res.statusCode = 400;
          res.end('bad url: ' + error?.message);
        }
      });
    },
  };
}

// 通用远端资源代理: /remote-asset?u=<encodedUrl>
// 用于绕过第三方素材/视频/图片站点的 CORS（Agnes / TOS / imgbb 等)
function remoteAssetProxy(): Plugin {
  return {
    name: 'remote-asset-proxy',
    configureServer(server) {
      server.middlewares.use('/remote-asset', (req, res) => {
        try {
          const raw = new URL(req.url || '', 'http://x').searchParams.get('u');
          if (!raw) {
            res.statusCode = 400;
            res.end('missing u');
            return;
          }
          const target = new URL(raw);
          const client = target.protocol === 'http:' ? http : https;
          console.log('[remote-asset] ->', req.method, target.href);
          const upstream = client.request(
            {
              method: req.method,
              hostname: target.hostname,
              port: target.port || (target.protocol ==='https:' ? 443 : 80),
              path: target.pathname + target.search,
              headers: {
                // 转发必要 header，剥离 host/origin/referer 避免签名冲突
                ...(req.headers.range ? { range: req.headers.range as string } : {}),
                'user-agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
              },
            },
            (upRes) => {
              console.log('[remote-asset] <-', upRes.statusCode, target.href);
              // 关键：加上 CORS 允许头
              res.setHeader('access-control-allow-origin', '*');
              res.setHeader('access-control-allow-methods', 'GET,HEAD,OPTIONS');
              res.setHeader('access-control-allow-headers', '*');
              // 透传 content-type / content-length / accept-ranges 等
              for (const [k, v] of Object.entries(upRes.headers)) {
                if (v === undefined) continue;
                if (/^access-control-/i.test(k)) continue;
                res.setHeader(k, v as any);
              }
              res.statusCode = upRes.statusCode || 200;
              upRes.pipe(res);
            }
          );
          upstream.on('error', (err) => {
            console.error('[remote-asset] error:', err.message, target.href);
            res.statusCode = 502;
            res.end('upstream error: ' + err.message);
          });
          upstream.end();
        } catch (e: any) {
          res.statusCode = 400;
          res.end('bad url: ' + e?.message);
        }
      });
    },
  };
}

function googleGeminiProxy(apiKey: string): Plugin {
  return {
    name: 'google-gemini-proxy',
    configureServer(server) {
      server.middlewares.use('/google-api', (req, res) => {
        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: { message: 'GEMINI_API_KEY is not configured' } }));
          return;
        }

        const target = new URL(req.url || '/', 'https://generativelanguage.googleapis.com/');
        const upstream = https.request(target, {
          method: req.method,
          headers: {
            'x-goog-api-key': apiKey,
            'content-type': (req.headers['content-type'] as string) || 'application/json',
            accept: (req.headers.accept as string) || 'application/json',
          },
        }, (upstreamRes) => {
          res.statusCode = upstreamRes.statusCode || 502;
          for (const [key, value] of Object.entries(upstreamRes.headers)) {
            if (value === undefined || /^access-control-/i.test(key)) continue;
            res.setHeader(key, value as string | string[]);
          }
          res.setHeader('access-control-allow-origin', '*');
          upstreamRes.pipe(res);
        });

        upstream.on('error', (error) => {
          console.error('[google-gemini-proxy] error:', error.message);
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: { message: 'Google Gemini API unavailable' } }));
        });
        req.pipe(upstream);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const geminiApiKey = env.GEMINI_API_KEY;
  const jdApiKey = env.JD_API_KEY;

  return {
  base: env.VITE_BASE_PATH || (mode === 'development' ? '/Lottie-key/' : '/JOYFlow/'),
  plugins: [react(), tailwindcss(), removeCrossorigin(), joyComposeBridge(), downloadAssetProxy(), remoteAssetProxy(), googleGeminiProxy(geminiApiKey)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    watch: {
      ignored: ['**/public/atlas-style/**'],
    },
     proxy: {
      // JD GPT-Image-2 代理，解决 CORS 跨域问题
        '/jd-api': {
          target: 'http://llm-gw.jd.local',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/jd-api/, ''),
          timeout: 600000,
          proxyTimeout: 600000,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (jdApiKey && !proxyReq.getHeader('authorization')) {
              proxyReq.setHeader('authorization', `Bearer ${jdApiKey}`);
            }
            console.log('[vite-proxy][jd-api] ->', req.method, req.url);
          });
          proxy.on('error', (err, req) => {
            console.error('[vite-proxy][jd-api] error:', err.message, '->', req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[vite-proxy][jd-api] <-', proxyRes.statusCode, req.url);
          });
        },
      },
      // 火山引擎 TOS（豆包生成结果视频/图片）代理，解决 <video>/fetch 跨域
      '/tos-proxy': {
        target: 'https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/tos-proxy/, ''),
        timeout: 300000,
        proxyTimeout: 300000,
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.error('[vite-proxy][tos-proxy] error:', err.message, '->', req.url);
          });
          proxy.on('proxyReq', (_proxyReq, req) => {
            console.log('[vite-proxy][tos-proxy] ->', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[vite-proxy][tos-proxy] <-', proxyRes.statusCode, req.url);
          });
        },
      },
      // 火山引擎 Ark（豆包 Seedream/Seedance）代理，解决 CORS 跨域
      '/ark-api': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/ark-api/, ''),
        timeout: 300000,
        proxyTimeout: 300000,
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.error('[vite-proxy][ark-api] error:', err.message, '->', req.url);
          });
          proxy.on('proxyReq', (_proxyReq, req) => {
            console.log('[vite-proxy][ark-api] ->', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[vite-proxy][ark-api] <-', proxyRes.statusCode, req.url);
          });
        },
      },
    },
  },
  build: {
    modulePreload: false,
  },
  };
});
