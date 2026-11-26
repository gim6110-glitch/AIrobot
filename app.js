import {
  AXES, SLOTS, SHAPES, POSE_NAMES, DEFAULT_ANGLES,
  parseLocalIntent, normalizeIntent, normalizeShape, shapeLabel, findSource,
  buildPickSequence, buildReturnSequence, resolveBinReturn, validAngles, poseLine, axisLine, messageLine, serialWhitelist
} from "./protocol.js";
import { mountCameraWorkspace } from "./guided-setup.js";
import { needsPhysicalVerification, targetForStep, visualArmGeometry, manualVisualTip, SIM_WAYPOINTS, WORLD_WAYPOINTS, worldTargetForStep, lerpWorld } from "./simulator-motion.js";
import { create3DScene } from "./three-scene.js";

const $ = id => document.getElementById(id);
const labels = ["베이스", "어깨", "팔꿈치", "집게"];
const angleLimits = [[20,160], [30,150], [30,150], [25,150]];
const SIM_POSES = {
  HOME:[90,90,90,90],
  HOVER_A:[58,98,86,75], PICK_A:[58,112,103,75],
  HOVER_B:[90,100,86,75], PICK_B:[90,114,105,75],
  HOVER_C:[122,98,86,75], PICK_C:[122,112,103,75],
  HOVER_BIN:[151,90,82,75], PLACE_BIN:[151,112,104,75]
};
const state = {
  mode:"sim", angles:[...DEFAULT_ANGLES], simTip:{...SIM_WAYPOINTS.HOME}, simTarget3d:{...WORLD_WAYPOINTS.HOME}, carriedShape:null, view3d:null, view:"3d", observations:{ A:"circle", B:"triangle", C:"cross" },
  sourceBySlot:{A:"manual",B:"manual",C:"manual"}, predicted:{}, boardModel:null,
  transferred:[], hiddenBinIndex:null, workspaces:{real:{observations:{A:'circle',B:'triangle',C:'cross'},transferred:[]}},
  running:false, cancelled:false, stopped:false,
  pending:null, connected:false, armed:false, port:null, writer:null, reader:null,
  decoder:new TextDecoder(), rx:"", waiters:[], heartbeat:null, pump:null,
  stream:null, model:null, modelUrl:"", calibration:{}, lastSentAngles:null, cameraLabels:[]
};
const HISTORY_KEY="davibot-log-v1", CAL_KEY="davibot-poses-v1";

function log(message, type="info") {
  const time = new Date().toLocaleTimeString("ko-KR",{hour12:false});
  const item=document.createElement("div");
  item.className=type;
  item.textContent="["+time+"] "+message;
  $("log").prepend(item);
  while($("log").children.length>80) $("log").lastChild.remove();
}
function say(text,who="assistant") {
  const el=document.createElement("div");
  el.className="bubble "+who; el.textContent=text;
  $("messages").append(el);
  $("messages").scrollTop=$("messages").scrollHeight;
}
function status(text) { $("sceneStatus").textContent=text; }
function sleep(ms){return new Promise(ok=>setTimeout(ok,ms));}
function notifyError(err){ const message=err instanceof Error?err.message:String(err);log(message,"error");say("실행 보류: "+message);status("실행 보류");}
function sync3D(includeObjects=false) {
  if(!state.view3d)return;
  const details={
    angles:state.angles,
    target:state.mode==="sim"?state.simTarget3d:null
  };
  if(includeObjects){
    details.observations=state.observations;
    details.transferred=state.transferred;
    details.hiddenIndex=state.hiddenBinIndex;
    details.carrying=state.carriedShape;
  }
  state.view3d.update(details);
}
function changeViewport(view) {
  const target=view==="2d"?"2d":"3d";
  if(target==="3d"&&!state.view3d){
    log("3D WebGL 초기화가 완료되지 않아 2D로 보여줍니다.","warning");
    view="2d";
  }else view=target;
  state.view=view;
  $("scene2dPanel").hidden=view!=="2d";
  $("scene3dPanel").hidden=view!=="3d";
  $("view2D").classList.toggle("active",view==="2d");
  $("view3D").classList.toggle("active",view==="3d");
  $("view2D").setAttribute("aria-pressed",String(view==="2d"));
  $("view3D").setAttribute("aria-pressed",String(view==="3d"));
  $("resetCamera3D").disabled=view!=="3d";
  if(view==="3d")state.view3d?.resize();
}
function initialize3D() {
  try{
    state.view3d=create3DScene($("scene3d"),{
      onWarning:message=>{const el=$("scene3dStatus");if(el)el.textContent=message;}
    });
    sync3D(true);
    $("scene3dStatus").textContent="3D 입체 시연 · 마우스로 회전/확대 가능 · 실물 좌표 검증 아님";
    changeViewport("3d");
    log("3D 장면을 시작했습니다. 화면의 링크 치수는 참고 형상이며 실제 서보 관측값이 아닙니다.");
  }catch(err){
    $("scene3dStatus").textContent="WebGL 사용 불가 · 2D 화면으로 전환됩니다.";
    log("3D 표시 초기화 실패: "+String(err?.message||err),"warning");
    changeViewport("2d");
  }
}
function setRunMode() {
  if(state.running){
    $("runMode").value=state.mode;
    log("동작 중에는 실행 모드를 변경할 수 없습니다.","warning");
    return;
  }
  const next=$("runMode").value;
  if(next!==state.mode){
    state.workspaces[state.mode]={
      observations:{...state.observations},
      transferred:state.transferred.map(x=>({...x}))
    };
    const saved=state.workspaces[next]||{observations:{A:"circle",B:"triangle",C:"cross"},transferred:[]};
    state.observations={...saved.observations};
    state.transferred=saved.transferred.map(x=>({...x}));
    state.hiddenBinIndex=null;
    state.mode=next;
    clearSimCarry();
    renderWorkspace();
    $("visionConfirmed").checked=false;
    setProposal(null);
    log("작업 기록을 "+(next==="sim"?"시뮬레이터":"실물")+" 작업대로 전환했습니다. 서로의 기록은 섞이지 않습니다.");
  }
  state.simTip=state.mode==="sim"?{...SIM_WAYPOINTS.HOME}:null;
  state.simTarget3d=state.mode==="sim"?{...WORLD_WAYPOINTS.HOME}:null;
  renderRobot();
  $("modeBadge").innerHTML='<span class="dot"></span>'+(state.mode==="real"?"실물 Arduino 모드":"시뮬레이션");
  if(state.mode==="real")log("실물 모드: 보관함에서 반환하기 전 실제 물체와 비어 있는 도착 칸을 확인해야 합니다.","warning");
  $("confirmLabel").textContent=state.mode==="real"?"보관함·도착 칸·로봇 주변 안전을 현장에서 직접 확인했습니다.":"시뮬레이터의 대상과 목적지를 확인했습니다.";
  status(state.mode==="real"?"실물 모드 준비":"시뮬레이션 준비");
}function resetObservations() {
  if(state.running){
    log("진행 중인 동작을 중지한 후 초기화해 주세요.","warning");return;
  }
  if(state.mode==="real" && !window.confirm("실물 작업대의 기록만 초기화합니다.\n실제 물체나 모터는 움직이지 않습니다. 물체 위치 기록을 삭제할까요?"))return;
  state.observations={A:"circle",B:"triangle",C:"cross"};
  state.simTip={...SIM_WAYPOINTS.HOME};
  state.simTarget3d={...WORLD_WAYPOINTS.HOME};
  state.angles=[...DEFAULT_ANGLES];
  state.transferred=[];
  state.hiddenBinIndex=null;
  refreshSliders();
  clearSimCarry();
  renderWorkspace();
  $("visionConfirmed").checked=false;
  setProposal(null);
  status("작업대 기록 초기화 (실물 이동 아님)");
}function svgEl(name,attrs={}){const el=document.createElementNS("http://www.w3.org/2000/svg",name);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el;}
function iconForShape(shape){
  const outer=svgEl("circle",{cx:0,cy:0,r:25,fill:"#e1e7ea",stroke:"#8199a6","stroke-width":3});
  let mark;
  if(shape==="circle") mark=svgEl("circle",{cx:0,cy:0,r:12,fill:"none",stroke:"#173c53","stroke-width":5});
  else if(shape==="triangle")mark=svgEl("path",{d:"M0 -16 L17 13 H-17Z",fill:"#14384f"});
  else if(shape==="cross")mark=svgEl("path",{d:"M-5 -16H5V-5H17V5H5V16H-5V5H-17V-5H-5Z",fill:"#14384f"});
  return shape==="empty"?[]:[outer,mark];
}
function syncSlots() {
  for(const slot of SLOTS) {
    const val=$("mark"+slot).value;
    state.observations[slot]=val==="empty"?null:val;
    state.sourceBySlot[slot]="manual";
    const obj=$("object"+slot);
    obj.replaceChildren(...iconForShape(val));
    obj.style.opacity=val==="empty"?"0":"1";
  }
  $("visionMode").textContent="수동 확인";
  $("visionConfirmed").checked=false;
  setProposal(null);
  sync3D(true);
}
function renderBinInventory() {
  const g=$("binItems");g.replaceChildren();
  state.transferred.forEach((item,i)=>{
    if(i===state.hiddenBinIndex)return;
    const marker=svgEl("g",{transform:"translate("+(641+27*(i%4))+" "+(190+((i/4)|0)*24)+") scale(.48)"});
    for(const c of iconForShape(item.shape))marker.appendChild(c);
    g.appendChild(marker);
  });
  if($("binSummary"))$("binSummary").textContent=state.transferred.length
    ? "보관함 "+state.transferred.length+"개 · "+state.transferred.map(item=>shapeLabel(item.shape)+"("+item.origin+"칸 출발)").join(", ")
    : "보관함 비어 있음";
  sync3D(true);
}
function renderWorkspace() {
  for(const slot of SLOTS){
    const shape=state.observations[slot];
    $("mark"+slot).value=shape||"empty";
    const node=$("object"+slot);
    node.replaceChildren(...iconForShape(shape||"empty"));
    node.style.opacity=shape?"1":"0";
  }
  renderBinInventory();
}
function transferObject(slot) {
  const shape=state.observations[slot];
  if(!shape)throw new Error(slot+"칸에 이동할 물체가 없습니다.");
  state.transferred.push({shape,origin:slot});
  state.observations[slot]=null;
  state.hiddenBinIndex=null;
  renderWorkspace();
  $("visionConfirmed").checked=false;
}
function returnObject(index,destination) {
  const item=state.transferred[index];
  if(!item)throw new Error("보관함 물체 기록을 찾지 못했습니다.");
  if(state.observations[destination])throw new Error(destination+"칸에 이미 물체가 있습니다.");
  state.transferred.splice(index,1);
  state.observations[destination]=item.shape;
  state.hiddenBinIndex=null;
  renderWorkspace();
  $("visionConfirmed").checked=false;
}
function clearSimCarry(){
  state.carriedShape=null;
  const previous=document.getElementById("simCarried");
  if(previous)previous.remove();
  sync3D(true);
}
function attachSimCarry(shape){
  clearSimCarry();
  state.carriedShape=shape;
  const g=svgEl("g",{id:"simCarried",transform:"translate(0 28) scale(.42)"});
  for(const c of iconForShape(shape))g.appendChild(c);
  $("gripper").appendChild(g);
  sync3D(true);
}
function renderRobot(angles=state.angles) {
  // Illustration only. This is not physical inverse kinematics or collision checking.
  const {shoulder,joint,tip}=visualArmGeometry(state.simTip||manualVisualTip(angles));
  const d1="M"+shoulder.x+" "+shoulder.y+" L"+joint.x+" "+joint.y;
  const d2="M"+joint.x+" "+joint.y+" L"+tip.x+" "+tip.y;
  $("arm1").setAttribute("d",d1);
  $("arm1Shadow").setAttribute("d",d1);
  $("arm2").setAttribute("d",d2);
  $("armBrace").setAttribute("d","M"+(shoulder.x+8)+" "+(shoulder.y-20)+" L"+(joint.x+8)+" "+(joint.y-20));
  $("armJoint").setAttribute("cx",joint.x);
  $("armJoint").setAttribute("cy",joint.y);
  $("gripper").setAttribute("transform","translate("+tip.x+" "+tip.y+")");
  const wide=12+Math.abs(angles[3]-90)*.2;
  $("finger1").setAttribute("d","M-21 0 L-"+wide+" 22 L-8 22");
  $("finger2").setAttribute("d","M21 0 L"+wide+" 22 L8 22");
  sync3D(false);
}
function refreshSliders(){
  document.querySelectorAll(".joint input").forEach((el,i)=>{
    el.value=state.angles[i]; $("out"+i).textContent=state.angles[i]+"°";
  });
  renderRobot();
}
function buildSliders(){
  const root=$("sliders");root.replaceChildren();
  labels.forEach((label,i)=>{
    const div=document.createElement("div");div.className="joint";
    const title=document.createElement("strong");title.textContent=(i+1)+". "+label;
    const input=document.createElement("input");input.type="range";input.min=angleLimits[i][0];input.max=angleLimits[i][1];input.step="1";input.value=state.angles[i];input.id="joint"+i;input.setAttribute("aria-label",label+" 각도");
    const out=document.createElement("output");out.id="out"+i;out.textContent=state.angles[i]+"°";
    input.addEventListener("input",()=>{if(state.running){refreshSliders();return;}state.angles[i]=Number(input.value);state.simTip=null;state.simTarget3d=null;out.textContent=input.value+"°";renderRobot();});
    div.append(title,input,out);root.append(div);
  });
}
function setProposal(p) {
  state.pending=p;
  $("proposal").classList.toggle("hidden",!p);
  $("confirmAction").checked=false;
  if(p){$("proposalText").textContent=p.text;$("execute").disabled=false;
    $("confirmLabel").textContent=state.mode==="real"?"실물 작업대 대상·위치·로봇 주변 안전을 직접 확인했습니다.":"시뮬레이터에서 옮길 대상과 목적지를 확인했습니다.";}
}
async function parseChat(text){
  if($("aiMode").value==="rule"){
    return { source:"rule",intent:parseLocalIntent(text)};
  }
  const response=await fetch("/api/intent",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
  const payload=await response.json();
  if(!response.ok)throw new Error(payload.error||"LLM 연결 실패");
  return {source:"llm",intent:normalizeIntent(payload.intent)};
}
async function onChat(event){
  event.preventDefault();
  if(state.running)return log("진행 중인 작업부터 끝내세요.","warning");
  const text=$("chatInput").value.trim();
  if(!text)return;
  $("chatInput").value="";say(text,"user");
  setProposal(null);
  const button=document.querySelector("#chatForm button");button.disabled=true;
  try {
    const {source,intent}=await parseChat(text);
    if(intent.kind==="return_place"){
      const selection=resolveBinReturn(intent,state.transferred,state.observations);
      say((source==="llm"?"LLM 결과":"규칙 기반 해석")+
        "\n출발: 보관함 · 대상: "+shapeLabel(selection.shape)+
        " · 도착: "+selection.destination+"칸"+(intent.target==="ORIGINAL"?"(원래 자리)":"")+
        "\n아직 실행하지 않았습니다. 아래에서 대상·목적지를 확인하고 승인해 주세요.");
      setProposal({kind:"return",...selection,
        text:"보관함 · "+shapeLabel(selection.shape)+" → "+selection.destination+"칸. "+
          (state.mode==="real"?"실물 물체가 보관함 집기 지점에 있는지 직접 확인해야 합니다.":"시뮬레이터에서 원래 위치로 반환합니다.")});
      return;
    }
    if(intent.kind!=="pick_place"){say(intent.explanation);return;}
    const slot=findSource(intent,state.observations);
    const observed=state.observations[slot];
    if(!observed)throw new Error(slot+"칸에 물체가 없습니다.");
    say((source==="llm"?"LLM 결과":"규칙 기반 해석")+
      "\n대상: "+shapeLabel(observed)+" / 출발: "+slot+"칸 / 목적지: 보관함"+
      "\n아직 실행하지 않았습니다. 아래에서 확인하고 승인해 주세요.");
    setProposal({kind:"forward",slot,shape:observed,
      text:slot+"칸 · "+shapeLabel(observed)+" → 보관함. "+
        (state.mode==="real"?"실물 작업대를 직접 확인해야 합니다.":"시뮬레이터의 이동을 확인하세요.")});
  }catch(err){notifyError(err);}
  finally{button.disabled=false;}
}
function showModeWarning(){
  if(state.mode==="real" && !state.connected)throw new Error("실제 모드에서는 USB로 Arduino를 연결해야 합니다.");
  if(state.mode==="real" && !state.armed)throw new Error("아직 실물 제어가 허용되지 않았습니다.");
}
async function simulatedMove(angles,label,token){
  const startAngles=[...state.angles];
  const from=state.simTip||manualVisualTip(startAngles);
  const target=targetForStep(label);
  const from3D=state.simTarget3d||WORLD_WAYPOINTS.HOME;
  const target3D=worldTargetForStep(label);
  const duration=660,begin=performance.now();
  while(true) {
    if(state.cancelled || token!==state.runToken)throw new Error("동작이 중단되었습니다.");
    const t=Math.min(1,(performance.now()-begin)/duration);
    const eased=t*t*(3-2*t);
    state.angles=startAngles.map((v,i)=>Math.round(v+(angles[i]-v)*eased));
    state.simTip={x:from.x+(target.x-from.x)*eased,y:from.y+(target.y-from.y)*eased};
    state.simTarget3d=lerpWorld(from3D,target3D,eased);
    refreshSliders();
    if(t>=1)break;
    await new Promise(ok=>requestAnimationFrame(ok));
  }
  log("SIM "+label+" · 가상 집게 위치 이동");
  await sleep(90);
}
async function physicalPose(angles,label){
  showModeWarning();
  if(state.cancelled)throw new Error("작업 중지됨");
  const waiter=waitForLine(line=>/^DONE POSE\b/.test(line),12000);
  await writeLine(poseLine(angles));
  try {await waiter;} catch(err){if(state.connected)await writeLine("STOP\n").catch(()=>{});throw err;}
  state.angles=[...angles];state.lastSentAngles=[...angles];refreshSliders();log("ARDUINO "+label+" (모터 명령 완료 — 집기 성공 아님)");
}
async function runPick(){
  const p=state.pending;
  if(!p)throw new Error("먼저 채팅 명령을 해석하세요.");
  if(state.running)throw new Error("현재 다른 작업이 실행 중입니다.");
  if(!$("confirmAction").checked)throw new Error("대상과 목적지를 확인한 뒤 실행 승인란을 체크하세요.");
  if(needsPhysicalVerification(state.mode) && !$("visionConfirmed").checked)
    throw new Error("실물 모드에서는 A·B·C와 보관함의 물체 위치를 직접 확인한 후 체크해 주세요.");

  const reverse=p.kind==="return";
  let slot,selected;
  if(reverse){
    const current=state.transferred[p.index];
    if(!current || current.shape!==p.shape || current.origin!==p.origin)
      throw new Error("보관함 내용이 변경되었습니다. 명령을 다시 입력해 주세요.");
    if(state.observations[p.destination])
      throw new Error(p.destination+"칸에 이미 물체가 있어 반환할 수 없습니다.");
    selected={index:p.index,shape:p.shape,origin:p.origin,destination:p.destination};
    slot=selected.destination;
  }else {
    slot=findSource({kind:"pick_place",shape:p.shape,source:p.slot,target:"BIN"},state.observations);
    if(slot!==p.slot)throw new Error("물체 위치가 변경되었습니다. 다시 명령해 주세요.");
  }
  let sequence;
  const open=state.mode==="real"?Number($("openGrip").value):75;
  const close=state.mode==="real"?Number($("closeGrip").value):110;
  if(state.mode==="real"){
    showModeWarning();
    // One calibrated PICK_BIN/PLACE_BIN location cannot safely locate
    // multiple objects piled in a real storage box.
    if(reverse && state.transferred.length!==1)
      throw new Error("실물 보관함의 집기 위치는 1개 물체용입니다. 보관함에 물체가 1개 있을 때만 반환할 수 있습니다.");
    if(!reverse && state.transferred.length>0)
      throw new Error("실물 고정 보관함에는 한 번에 물체 1개만 놓도록 제한했습니다. 먼저 기존 물체를 반환해 주세요.");
    sequence=reverse?buildReturnSequence(slot,state.calibration,open,close)
      :buildPickSequence(slot,state.calibration,open,close);
    for(const step of sequence)ensurePhysicalLimits(step.angles);
    const action=reverse?"보관함의 물체를 "+slot+"칸으로 반환":"물체를 "+slot+"칸에서 보관함으로 이동";
    if(!window.confirm("실물 로봇 실행 확인\n\n"+action+
      "\n물체 집기 위치, 빈 도착 칸, 전원 차단 장치 및 주변 안전을 확인했습니까?\n이 작업은 실제 서보모터를 움직입니다."))return;
  }else {
    sequence=reverse?buildReturnSequence(slot,SIM_POSES,open,close)
      :buildPickSequence(slot,SIM_POSES,open,close);
  }
  state.running=true;state.cancelled=false;state.runToken=(state.runToken||0)+1;
  const token=state.runToken;
  $("execute").disabled=true;
  log((state.mode==="real"?"REAL":"SIM")+(reverse?" 보관함 → "+slot+"칸 반환 시작":" "+slot+"칸 → 보관함 이동 시작"));
  try{
    for(let i=0;i<sequence.length;i++){
      const step=sequence[i];
      status(step.label);
      if(state.mode==="real")await physicalPose(step.angles,step.label);
      else await simulatedMove(step.angles,step.label,token);
      if(state.cancelled)throw new Error("동작 중지됨");
      if(state.mode==="sim" && i===2){
        if(reverse){state.hiddenBinIndex=selected.index;renderBinInventory();}
        else $("object"+slot).style.opacity="0";
        attachSimCarry(p.shape);
        log("SIM "+(reverse?"보관함":"작업대")+" 물체 집기 표현");
      }
      if(state.mode==="sim" && i===6){
        clearSimCarry();
        if(reverse){
          const obj=$("object"+slot);
          obj.replaceChildren(...iconForShape(p.shape));
          obj.style.opacity="1";
        }
        log("SIM "+(reverse?slot+"칸":"보관함")+" 물체 놓기 표현");
      }
    }
    if(state.mode==="sim"){
      if(reverse){
        returnObject(selected.index,slot);
        log("SIM 보관함의 "+shapeLabel(p.shape)+"을 "+slot+"칸으로 반환했습니다.");
      }else{
        transferObject(slot);
        log("SIM "+slot+"칸 물체를 보관함으로 옮겼습니다.");
      }
      say("시뮬레이션의 "+(reverse?"반환":"집기")+" 과정이 완료됐습니다. 실제 로봇의 집기 성공을 의미하지는 않습니다.");
    }else{
      // Serial DONE means joint command complete, NOT physical object placement.
      const verified=window.confirm("Arduino 이동 명령을 완료했습니다.\n\n실제로 "+(reverse?
        "보관함 물체를 "+slot+"칸에 놓았습니까?":
        slot+"칸 물체를 보관함에 옮겼습니까?")+
        "\n실제 배치를 눈으로 확인한 경우에만 확인을 누르세요.");
      if(verified){
        if(reverse)returnObject(selected.index,slot);
        else transferObject(slot);
        log("REAL 사용자가 실제 물체 이동을 확인해 작업대 기록을 갱신했습니다.");
        say("실제 물체 이동을 사용자가 확인한 것으로 기록했습니다.");
      }else{
        log("REAL 결과가 확인되지 않아 물체 위치 기록을 갱신하지 않았습니다.","warning");
        say("실제 이동이 확인되지 않았습니다. 현장 위치를 다시 확인하고 필요한 경우 작업대 기록을 초기화해 주세요.");
      }
    }
    status("작업 종료 · 결과 확인");
    setProposal(null);
  }catch(err){
    if(state.mode==="sim"){
      state.hiddenBinIndex=null;
      renderWorkspace();
    }
    notifyError(err);
  }finally{
    clearSimCarry();
    state.hiddenBinIndex=null;
    renderBinInventory();
    state.running=false;
    $("execute").disabled=false;
  }
}
function ensurePhysicalLimits(angles){
  if(!validAngles(angles))throw new Error("각도 값이 0~180 범위를 벗어났습니다.");
  for(let i=0;i<4;i++){
    if(angles[i]<angleLimits[i][0]||angles[i]>angleLimits[i][1])
      throw new Error(labels[i]+" 각도가 웹 안전 범위를 벗어났습니다.");
  }
}
// Web Serial control. The USB port is only ever selected by a user's click.
async function connectSerial(){
  if(!("serial" in navigator))throw new Error("실물 USB 연결은 데스크톱 Chrome/Edge의 HTTPS Web Serial에서만 지원됩니다.");
  if(state.connected)return;
  // Reuse the user's previously granted USB permission when there is exactly one port.
  const granted=await navigator.serial.getPorts();
  const port=granted.length===1?granted[0]:await navigator.serial.requestPort();
  await port.open({baudRate:115200,bufferSize:255});
  state.port=port;state.connected=true;state.armed=false;state.stopped=false;state.lastSentAngles=null;
  state.writer=port.writable.getWriter();
  state.reader=port.readable.getReader();
  state.decoder=new TextDecoder();state.rx="";
  state.pump=readLoop();
  state.heartbeat=setInterval(()=>{
    if(state.connected)writeLine("PING\n").catch(err=>log("연결 오류: "+err.message,"error"));
  },950);
  $("connectionBadge").textContent="USB 연결됨 · 잠금";
  log("Arduino USB 연결됨. 현재 실제 모터는 제어 잠금 상태입니다.","warning");
  await sleep(1800); // UNO resets after opening a serial port
  // Confirm the actual AIROBOT firmware handshake; do not confuse a serial port
  // with a verified robot controller.
  const hello=waitForLine(line=>/^READY AIROBOT\/1$/.test(line),4500);
  try {
    await writeLine("HELLO\n");
    await hello;
    log("AIROBOT/1 펌웨어 확인됨 · 실물 제어는 아직 잠금 상태입니다.");
  } catch(err) {
    await disconnectSerial();
    throw new Error("Arduino가 AIROBOT/1 응답을 보내지 않았습니다. 스케치 업로드와 포트를 확인하세요.");
  }
}
async function readLoop(){
  try{
    while(state.connected && state.reader){
      const {value,done}=await state.reader.read();
      if(done)break;
      state.rx+=state.decoder.decode(value,{stream:true});
      while(state.rx.includes("\n")){
        const index=state.rx.indexOf("\n"),line=state.rx.slice(0,index).trim();
        state.rx=state.rx.slice(index+1);
        if(!line)continue;
        const m=messageLine(line);
        if(m.type==="ERR")log("Arduino "+line,"error");
        else if(m.type!=="PONG")log("Arduino "+line);
        if(m.type==="STOPPED"){state.armed=false;state.stopped=true;$("connectionBadge").textContent="정지됨";}
        if(m.type==="ARMED"){state.armed=true;$("connectionBadge").textContent="USB 연결됨 · 실물 제어 허용";}
        if(m.type==="DISARMED"){state.armed=false;$("connectionBadge").textContent="USB 연결됨 · 잠금";}
        const still=[];
        for(const w of state.waiters){
          if(m.type==="ERR"){clearTimeout(w.timer);w.reject(new Error(line));}
          else if(w.match(line)){clearTimeout(w.timer);w.resolve(line);}
          else still.push(w);
        }
        state.waiters=still;
      }
    }
  } catch(err){log("USB 수신 실패: "+err.message,"error");}
  finally {
    if(state.connected){log("USB가 끊겼습니다. 필요하면 물리적 전원을 차단하세요.","warning");state.connected=false;state.armed=false;state.cancelled=true;}
    rejectWaiters("USB 연결 종료");
    $("connectionBadge").textContent="연결 안 됨";
  }
}
function waitForLine(match,ms=12000){
  return new Promise((resolve,reject)=>{
    const w={match,resolve,reject,timer:null};
    w.timer=setTimeout(()=>{
      state.waiters=state.waiters.filter(x=>x!==w);
      reject(new Error("Arduino 응답 대기 시간이 초과되었습니다."));
    },ms);
    state.waiters.push(w);
  });
}
function rejectWaiters(reason){
  const old=state.waiters.splice(0);
  for(const w of old){clearTimeout(w.timer);w.reject(new Error(reason));}
}
async function writeLine(line){
  if(!state.connected||!state.writer)throw new Error("USB가 연결되어 있지 않습니다.");
  if(!serialWhitelist(line))throw new Error("허용되지 않은 Arduino 명령입니다.");
  return state.writer.write(new TextEncoder().encode(line));
}
async function disconnectSerial(){
  state.cancelled=true;state.armed=false;
  if(state.heartbeat)clearInterval(state.heartbeat);
  if(state.connected){try{await writeLine("DISARM\n")}catch{}}
  state.connected=false;
  rejectWaiters("연결 해제");
  try{await state.reader?.cancel()}catch{}
  try{state.reader?.releaseLock()}catch{}
  try{state.writer?.releaseLock()}catch{}
  try{await state.port?.close()}catch{}
  state.reader=null;state.writer=null;state.port=null;state.lastSentAngles=null;
  $("connectionBadge").textContent="연결 안 됨";
  log("USB 연결 해제. 서보 전원을 별도로 확인하세요.","warning");
}
async function armPhysical(){
  if(!state.connected)throw new Error("먼저 USB를 연결하세요.");
  if(state.running)throw new Error("작업 실행 중에는 제어 모드를 변경할 수 없습니다.");
  if(!window.confirm("실물 제어를 허용하시겠습니까?\n\n장치 전원·지지대·서보 방향·장애물·물리적 차단 스위치를 먼저 확인하세요.\n보정 전에는 한 관절씩 무부하로 확인하세요."))return;
  await writeLine("DISARM\n"); // clear STOP latch
  const ready=waitForLine(line=>line==="ARMED",3000);
  await writeLine("ARM\n");await ready;
  state.stopped=false;state.armed=true;$("connectionBadge").textContent="실물 제어 허용";
  log("실물 제어 허용됨. 수동 조작도 움직임을 일으킵니다.","warning");
}
async function stopNow(){
  state.cancelled=true;state.runToken=(state.runToken||0)+1;
  state.armed=false;
  if(state.connected){
    try{await writeLine("STOP\n")}catch(err){log("STOP USB 전송 실패: "+err.message,"error");}
  }
  rejectWaiters("정지 명령");
  state.running=false;
  status("정지 명령");
  $("connectionBadge").textContent=state.connected?"정지됨":"연결 안 됨";
  log("동작 중지. 소프트웨어 정지는 실제 전원 차단을 대신하지 않습니다.","warning");
}
async function manualSend(){
  ensurePhysicalLimits(state.angles);
  if(state.mode==="sim"){renderRobot();status("수동 시뮬레이션");log("SIM 수동: "+state.angles.join(",")+"°");return;}
  showModeWarning();
  if(state.running)throw new Error("자동 작업 중에는 수동 동작을 실행할 수 없습니다.");
  if(!window.confirm("현재 관절 각도 "+state.angles.join(" / ")+"°를 실제 모터로 보냅니다.\n무부하·주변 안전·축 방향을 확인하셨습니까?"))return;
  state.cancelled=false;
  await physicalPose([...state.angles],"수동 관절 이동");
}
async function testSingleAxis(){
  const i=Number($("axisSelect").value);
  if(!Number.isInteger(i)||i<0||i>3)throw new Error("시험할 축을 선택하세요.");
  const angle=state.angles[i];
  ensurePhysicalLimits(state.angles);
  if(state.running)throw new Error("자동 동작 중에는 축을 시험할 수 없습니다.");
  if(state.mode!=="real"){
    status("시뮬레이션 축 "+(i+1)+" 각도 "+angle+"°");
    log("SIM "+labels[i]+": "+angle+"°");
    return;
  }
  showModeWarning();
  if(!window.confirm(
    labels[i]+" 축을 "+angle+"°로 움직입니다.\n"+
    "장치를 지지하고, 작동 범위의 사람과 물체를 치웠습니까?\n"+
    "처음 활성화할 때 서보가 갑자기 현재 위치에서 이동할 수 있습니다."
  ))return;
  state.running=true;
  try{
    const done=waitForLine(line=>/^DONE AXIS$/.test(line),11000);
    await writeLine(axisLine(i,angle));
    await done;
    log("축별 실물 점검 완료: "+labels[i]+" "+angle+"° (물체 집기 여부와 무관)");
    status(labels[i]+" 축 점검 완료");
  }catch(err){
    if(state.connected)await writeLine("STOP\n").catch(()=>{});
    throw err;
  }finally{state.running=false;}
}

function restoreCalibration(){
  try{
    const raw=JSON.parse(localStorage.getItem(CAL_KEY)||"{}");
    if(raw && typeof raw==="object")for(const n of POSE_NAMES){
      if(validAngles(raw[n])&&raw[n].every((v,i)=>v>=angleLimits[i][0]&&v<=angleLimits[i][1]))
        state.calibration[n]=raw[n].slice();
    }
  }catch{}
  updateCalibrationProgress();
}
function updateCalibrationProgress(){
  $("poseProgress").textContent="위치 "+Object.keys(state.calibration).length+" / "+POSE_NAMES.length+
    " 보정됨 · "+POSE_NAMES.filter(n=>!state.calibration[n]).join(", ");
}
function savePose(){
  if(state.mode!=="real"||!state.connected)throw new Error("실물 모드에서 USB에 연결한 뒤 위치를 보정하세요.");
  if(!state.lastSentAngles || !state.lastSentAngles.every((v,i)=>v===state.angles[i]))
    throw new Error("현재 각도를 실제 모터에 전송하고 움직임을 확인한 후 저장해 주세요.");
  if(!window.confirm($("poseName").value+"를 현재 각도로 저장하시겠습니까?\n실물 작업대에서 이 위치가 안전한지 확인한 뒤 저장하세요."))return;
  ensurePhysicalLimits(state.angles);
  state.calibration[$("poseName").value]=[...state.angles];
  localStorage.setItem(CAL_KEY,JSON.stringify(state.calibration));
  updateCalibrationProgress();
  log("실물 자세 보정 저장: "+$("poseName").value+" = "+state.angles.join(","));
}
function loadPose(){
  const a=state.calibration[$("poseName").value];
  if(!a)throw new Error("선택한 위치의 보정값이 없습니다.");
  state.angles=[...a];refreshSliders();
  log("각도 표시만 불러왔습니다. 실제 모터는 이동하지 않았습니다.");
}
async function startCamera(){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error("HTTPS 및 카메라 권한이 필요합니다.");
  if(state.stream)return;
  const stream=await navigator.mediaDevices.getUserMedia({video:{width:1280,height:720,facingMode:"environment"},audio:false});
  state.stream=stream;$("camera").srcObject=stream;await $("camera").play();
  log("웹캠 켜짐. A·B·C가 화면의 세 영역에 정확히 있는지 확인하세요.");
}
function stopCamera(){
  state.stream?.getTracks().forEach(track=>track.stop());
  state.stream=null;$("camera").srcObject=null;
}
async function scriptOnce(url,id){
  if(window[id])return;
  await new Promise((ok,no)=>{
    const el=document.createElement("script");el.src=url;el.async=true;
    el.onload=()=>ok();el.onerror=()=>no(new Error(id+" 라이브러리를 불러올 수 없습니다."));
    document.head.append(el);
  });
}
async function loadModel(){
  let url=$("modelUrl").value.trim();
  if(!/^https:\/\//i.test(url))throw new Error("HTTPS 이미지 모델 URL을 입력해 주세요.");
  if(!url.endsWith("/"))url+="/";
  log("이미지 모델을 불러오는 중입니다…");
  await scriptOnce("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js","tf");
  await scriptOnce("https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8/dist/teachablemachine-image.min.js","tmImage");
  state.model=await window.tmImage.load(url+"model.json",url+"metadata.json");
  state.modelUrl=url;
  $("visionMode").textContent="학습 모델 연결됨";
  $("predictions").textContent="모델 연결 완료. 카메라를 켜고 화면을 A·B·C 세 영역에 맞춘 다음 사진 분류를 실행하세요.";
  log("Teachable Machine 이미지 모델 로드: "+url);
}
async function predictSlots(){
  if(!state.model)throw new Error("학습된 이미지 모델을 먼저 불러오세요.");
  const video=$("camera");
  if(!state.stream||!video.videoWidth)throw new Error("카메라를 먼저 켜고 영상이 표시되는지 확인하세요.");
  const canvas=document.createElement("canvas");canvas.width=224;canvas.height=224;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const w=video.videoWidth/3,h=video.videoHeight;
  const output=[];
  for(let i=0;i<3;i++){
    ctx.clearRect(0,0,224,224);
    ctx.drawImage(video,w*i,0,w,h,0,0,224,224);
    const predictions=await state.model.predict(canvas);
    predictions.sort((a,b)=>b.probability-a.probability);
    const best=predictions[0],shape=normalizeShape(best?.className);
    const slot=SLOTS[i];
    if(best && best.probability>=.80 && shape){
      state.observations[slot]=shape;
      state.sourceBySlot[slot]="model";
      $("mark"+slot).value=shape;
      $("object"+slot).replaceChildren(...iconForShape(shape));
      $("object"+slot).style.opacity="1";
    } else {
      state.observations[slot]=null;state.sourceBySlot[slot]="uncertain";
      $("mark"+slot).value="empty";$("object"+slot).style.opacity="0";
    }
    output.push(slot+": "+(shape?shapeLabel(shape):"판단 불가")+" ("+Math.round((best?.probability||0)*100)+"%)");
  }
  $("visionMode").textContent="AI 예측 · 현장 확인 필요";
  $("predictions").textContent=output.join(" | ")+" — A·B·C를 실제로 확인하고 아래 체크란을 선택하세요. 신뢰도 80% 미만이면 보류합니다.";
  $("visionConfirmed").checked=false;
  setProposal(null);
  log("이미지 모델 예측: "+output.join(" · "));
}
function bind(id,event,fn){
  $(id).addEventListener(event,async e=>{
    try{await fn(e)}catch(err){notifyError(err);}
  });
}
function boot(){
  buildSliders();restoreCalibration();renderRobot();
  initialize3D();
  mountCameraWorkspace({state,onLog:message=>log(message)});
  log("시뮬레이터 시작. Arduino 연결 전 실제 모터는 움직이지 않습니다.");
  bind("runMode","change",setRunMode);
  bind("view3D","click",()=>changeViewport("3d"));
  bind("view2D","click",()=>changeViewport("2d"));
  bind("resetCamera3D","click",()=>state.view3d?.resetCamera());
  bind("resetSim","click",resetObservations);
  for(const slot of SLOTS)bind("mark"+slot,"change",syncSlots);
  bind("chatForm","submit",onChat);
  for(const el of document.querySelectorAll("[data-example]")){
    el.addEventListener("click",()=>{$("chatInput").value=el.dataset.example;$("chatInput").focus();});
  }
  bind("execute","click",runPick);
  bind("home","click",()=>{
    const home=state.mode==="sim"?SIM_POSES.HOME:state.calibration.HOME;
    if(!home)throw new Error("실물 HOME 위치를 보정하세요.");
    state.angles=[...home];
    if(state.mode==="sim"){state.simTip={...SIM_WAYPOINTS.HOME};state.simTarget3d={...WORLD_WAYPOINTS.HOME};}
    refreshSliders();
    status("HOME 각도 표시 · 실제 모터는 아직 움직이지 않음");
  });
  bind("sendPose","click",manualSend);
  bind("testAxis","click",testSingleAxis);
  bind("connect","click",connectSerial);
  bind("quickStart","click",async()=>{
    $("runMode").value="real";setRunMode();
    await connectSerial();
    const complete=Object.keys(state.calibration).length===POSE_NAMES.length;
    $("deviceSetup").textContent=complete
      ? "Arduino 통신이 확인되었습니다. 저장된 9개 위치가 현재 장치와 같은지 먼저 확인하고, 사람의 승인 후 실행할 수 있습니다."
      : "Arduino 통신 성공! 이 장치는 실제 안전 위치가 미보정 상태입니다. 아래에서 모터 방향과 각 위치를 확인하고 저장해야 자동 집기 명령을 실행할 수 있습니다.";
    log(complete?"저장된 위치 보정값 발견. 실제 장비의 구조 변경 여부 확인 필요.":"첫 실물 연결: 위치 보정 9개가 필요합니다.","warning");
  });
  bind("disconnect","click",disconnectSerial);
  bind("arm","click",armPhysical);
  bind("disarm","click",async()=>{
    state.armed=false;state.cancelled=true;
    if(state.connected)await writeLine("DISARM\n");
    log("실물 제어 잠금");$("connectionBadge").textContent=state.connected?"USB 연결됨 · 잠금":"연결 안 됨";
  });
  bind("stop","click",stopNow);
  bind("savePose","click",savePose);
  bind("loadPose","click",loadPose);
  bind("clearCalibration","click",()=>{
    if(!window.confirm("이 브라우저에 저장된 모든 실물 보정값을 삭제할까요?"))return;
    state.calibration={};localStorage.removeItem(CAL_KEY);updateCalibrationProgress();
  });
  bind("startCamera","click",startCamera);
  bind("stopCamera","click",stopCamera);
  bind("loadModel","click",loadModel);
  bind("predict","click",predictSlots);
  bind("clearLog","click",()=>{$("log").replaceChildren();log("기록이 지워졌습니다.");});
  document.addEventListener("keydown",async e=>{
    const target=e.target;
    if(target?.closest("input,textarea,select,button,[contenteditable]"))return;
    if(e.code==="Space"){e.preventDefault();await stopNow();return;}
    if(/^[1-4]$/.test(e.key))state.selectedJoint=Number(e.key)-1;
    if(e.key==="ArrowLeft"||e.key==="ArrowRight"){
      e.preventDefault();
      const index=state.selectedJoint||0;
      const shift=e.key==="ArrowRight"?2:-2;
      state.angles[index]=Math.min(angleLimits[index][1],Math.max(angleLimits[index][0],state.angles[index]+shift));
      state.simTip=null;state.simTarget3d=null;
      refreshSliders();
    }
  });
  window.addEventListener("beforeunload",()=>{ if(state.connected)writeLine("DISARM\n").catch(()=>{});});
  $("visionMode").textContent="수동 확인 · AI 아님";
}
boot();