import {
  AXES, SLOTS, SHAPES, POSE_NAMES, DEFAULT_ANGLES,
  parseLocalIntent, normalizeIntent, normalizeShape, shapeLabel, findSource,
  buildPickSequence, validAngles, poseLine, messageLine, serialWhitelist
} from "./protocol.js";

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
  mode:"sim", angles:[...DEFAULT_ANGLES], observations:{ A:"circle", B:"triangle", C:"cross" },
  sourceBySlot:{A:"manual",B:"manual",C:"manual"}, predicted:{},
  transferred:[], running:false, cancelled:false, stopped:false,
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
function setRunMode() {
  state.mode=$("runMode").value;
  $("modeBadge").innerHTML='<span class="dot"></span>'+(state.mode==="real"?"실물 Arduino 모드":"시뮬레이션");
  if(state.mode==="real") log("실물 모드: USB 연결·보정·승인이 필요합니다.","warning");
  status(state.mode==="real"?"실물 모드 준비":"시뮬레이션 준비");
}
function resetObservations() {
  state.observations={A:"circle",B:"triangle",C:"cross"};
  state.transferred=[];
  for(const slot of SLOTS){
    $("mark"+slot).value=state.observations[slot];
    state.sourceBySlot[slot]="manual";
    const el=$("object"+slot);
    el.style.opacity="1";
    el.replaceChildren(...iconForShape(state.observations[slot]));
  }
  $("binItems").replaceChildren();
  $("visionConfirmed").checked=false;
  setProposal(null);
  status("작업대 초기화");
}
function svgEl(name,attrs={}){const el=document.createElementNS("http://www.w3.org/2000/svg",name);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el;}
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
}
function transferObject(slot) {
  const obj=$("object"+slot);
  obj.style.opacity="0";
  const item=state.observations[slot];
  state.transferred.push(item);
  state.observations[slot]=null;
  $("mark"+slot).value="empty";
  const g=$("binItems");g.replaceChildren();
  state.transferred.slice(-4).forEach((s,i)=>{
    let el=svgEl("g",{transform:"translate("+(647+25*(i%4))+" "+(193+((i/4)|0)*21)+") scale(.56)"});
    for(const c of iconForShape(s||"empty"))el.appendChild(c);
    g.append(el);
  });
  $("visionConfirmed").checked=false;
}
function renderRobot(angles=state.angles) {
  // Schematic view only — not forward kinematics or collision detection.
  const shoulder=({x:145,y:241});
  const a1=(-77+(angles[1]-90)*0.48)*Math.PI/180;
  const a2=(a1+(-18+(angles[2]-90)*0.55)*Math.PI/180);
  const swing=(angles[0]-90)*.85;
  const j={x:shoulder.x+164*Math.cos(a1)+swing,y:shoulder.y+164*Math.sin(a1)};
  const end={x:j.x+138*Math.cos(a2),y:j.y+138*Math.sin(a2)};
  const d1="M"+shoulder.x+" "+shoulder.y+" L"+j.x+" "+j.y;
  const d2="M"+j.x+" "+j.y+" L"+end.x+" "+end.y;
  $("arm1").setAttribute("d",d1);$("arm1Shadow").setAttribute("d",d1);
  $("arm2").setAttribute("d",d2);$("armBrace").setAttribute("d","M"+(shoulder.x+8)+" "+(shoulder.y-20)+" L"+(j.x+8)+" "+(j.y-20));
  $("armJoint").setAttribute("cx",j.x);$("armJoint").setAttribute("cy",j.y);
  $("gripper").setAttribute("transform","translate("+end.x+" "+end.y+")");
  const wide=12+Math.abs(angles[3]-90)*.2;
  $("finger1").setAttribute("d","M-21 0 L-"+wide+" 22 L-8 22");
  $("finger2").setAttribute("d","M21 0 L"+wide+" 22 L8 22");
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
    input.addEventListener("input",()=>{state.angles[i]=Number(input.value);out.textContent=input.value+"°";renderRobot();});
    div.append(title,input,out);root.append(div);
  });
}
function setProposal(p) {
  state.pending=p;
  $("proposal").classList.toggle("hidden",!p);
  $("confirmAction").checked=false;
  if(p){$("proposalText").textContent=p.text;$("execute").disabled=false;}
}
async function parseChat(text){
  if($("aiMode").value==="rule"){
    return { source:"rule",intent:parseLocalIntent(text)};
  }
  const response=await fetch("/.netlify/functions/intent",{
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
  try{
    const {source,intent}=await parseChat(text);
    if(intent.kind!=="pick_place"){say(intent.explanation);return;}
    const slot=findSource(intent,state.observations);
    const observed=state.observations[slot];
    if(!observed)throw new Error(slot+"칸의 물체를 확인할 수 없습니다.");
    say((source==="llm"?"LLM 결과":"규칙 기반 해석")+
      "\n대상: "+shapeLabel(observed)+" / 출발: "+slot+"칸 / 목적지: 보관함\n아직 실행하지 않았습니다. 실제 표식과 작업 환경을 확인하세요.");
    setProposal({slot,shape:observed,text:"작업 대상 "+slot+"칸 · "+shapeLabel(observed)+" → 보관함. "+(source==="rule"?"규칙 기반 해석(LLM 아님)":"LLM 해석")+". 사람이 검증 후 승인할 때만 실행합니다."});
  }catch(err){notifyError(err)}finally{button.disabled=false}
}
function showModeWarning(){
  if(state.mode==="real" && !state.connected)throw new Error("실제 모드에서는 USB로 Arduino를 연결해야 합니다.");
  if(state.mode==="real" && !state.armed)throw new Error("아직 실물 제어가 허용되지 않았습니다.");
}
async function simulatedMove(angles,label,token){
  const start=[...state.angles],duration=560,begin=performance.now();
  while(true) {
    if(state.cancelled || token!==state.runToken)throw new Error("동작이 중단되었습니다.");
    const t=Math.min(1,(performance.now()-begin)/duration);
    const eased=t*t*(3-2*t);
    state.angles=start.map((v,i)=>Math.round(v+(angles[i]-v)*eased));
    refreshSliders();
    if(t>=1)break;
    await new Promise(ok=>requestAnimationFrame(ok));
  }
  log("SIM "+label);
  await sleep(110);
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
  if(state.running)throw new Error("다른 동작이 실행 중입니다.");
  if(!$("confirmAction").checked)throw new Error("작업 대상 및 주변 안전을 확인하고 승인란을 체크하세요.");
  if(!$("visionConfirmed").checked)throw new Error("A·B·C 표식을 실제 작업대와 비교하고 직접 확인란을 체크하세요.");
  const slot=findSource({kind:"pick_place",shape:p.shape,source:p.slot,target:"BIN"},state.observations);
  if(slot!==p.slot)throw new Error("표식 관찰 결과가 변경되었습니다. 다시 해석하세요.");
  let sequence;
  if(state.mode==="real"){
    showModeWarning();
    sequence=buildPickSequence(slot,state.calibration,
      Number($("openGrip").value),Number($("closeGrip").value));
    for(const step of sequence)ensurePhysicalLimits(step.angles);
    if(!window.confirm("실물 로봇 이동 승인\n\n위치 보정과 장애물 제거를 확인했습니까?\n이 명령은 실제 모터를 움직입니다."))return;
  } else {
    sequence=buildPickSequence(slot,SIM_POSES,75,110);
  }
  state.running=true;state.cancelled=false;state.runToken=(state.runToken||0)+1;
  const token=state.runToken;
  $("execute").disabled=true;
  log((state.mode==="real"?"REAL":"SIM")+" "+slot+"칸 → 보관함 집기 시작");
  try{
    for(const step of sequence){
      status(step.label);
      if(state.mode==="real") await physicalPose(step.angles,step.label);
      else await simulatedMove(step.angles,step.label,token);
      if(state.cancelled)throw new Error("동작이 중지되었습니다.");
    }
    if(state.mode==="sim"){
      transferObject(slot);
      log("시뮬레이터: "+slot+"칸 물체를 보관함으로 옮겼습니다.");
      say("시뮬레이션의 집기 경로를 완료했습니다. 실제 로봇의 집기 성공을 의미하지는 않습니다.");
    }else{
      log("실물 명령 시퀀스 종료. 사람 또는 카메라로 실제 집기 여부를 반드시 확인하세요.","warning");
      say("Arduino 동작 명령은 완료되었습니다. 실제로 물체를 옮겼는지는 현장에서 확인하고 기록하세요.");
      $("visionConfirmed").checked=false;
    }
    status("작업 종료 · 결과 확인");
    setProposal(null);
  }catch(err){notifyError(err)}
  finally{state.running=false;$("execute").disabled=false}
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
  const port=await navigator.serial.requestPort();
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
  await writeLine("HELLO\n");
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
  log("시뮬레이터 시작. Arduino 연결 전 실제 모터는 움직이지 않습니다.");
  bind("runMode","change",setRunMode);
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
    state.angles=[...home];refreshSliders();
    status("HOME 각도 표시 · 실제 모터는 아직 움직이지 않음");
  });
  bind("sendPose","click",manualSend);
  bind("connect","click",connectSerial);
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
      refreshSliders();
    }
  });
  window.addEventListener("beforeunload",()=>{ if(state.connected)writeLine("DISARM\n").catch(()=>{});});
  $("visionMode").textContent="수동 확인 · AI 아님";
}
boot();