import { BOARD_STEPS, calibrateA4 } from "./workplane.js";
import { inverse } from "./kinematics.js";

/**
 * Camera A4 calibration is an educational planar measurement, NOT a
 * robot-camera extrinsic calibration for autonomous unverified actuation.
 */
export function mountCameraWorkspace({state,onLog}) {
  const canvas=document.getElementById("boardCanvas");
  const video=document.getElementById("camera");
  const captureButton=document.getElementById("captureBoard");
  const resetButton=document.getElementById("resetBoard");
  const prompt=document.getElementById("boardPrompt");
  const progress=document.getElementById("boardProgress");
  const boardReach=document.getElementById("boardReach");
  const ctx=canvas.getContext("2d");
  const snapshot=document.createElement("canvas");
  const snapCtx=snapshot.getContext("2d");
  let photoReady=false;
  let points=[];
  const key="davibot-workspace-a4-v1";

  function notice(message) {onLog(message);}
  function redraw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(photoReady) ctx.drawImage(snapshot,0,0);
    else {ctx.fillStyle="#113348";ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle="#e4f5f2";ctx.font="bold 25px sans-serif";ctx.fillText("카메라 영상을 캡처한 후 기준점을 눌러 주세요.",38,canvas.height/2);}
    const labels=["TL","TR","BR","BL","베이스","정면","A","B","C","보관함"];
    points.forEach((p,i)=>{
      ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.fillStyle=i<4?"#f8bd45":"#0bd7ac";ctx.fill();
      ctx.strokeStyle="#102b42";ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle="#f9feff";ctx.strokeStyle="#163c50";ctx.lineWidth=3;ctx.font="bold 20px sans-serif";
      const x=p.x+13,y=p.y-14;ctx.strokeText(labels[i],x,y);ctx.fillText(labels[i],x,y);
    });
    if(points.length>=4){
      ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
      for(let i=1;i<4;i++)ctx.lineTo(points[i].x,points[i].y);
      ctx.closePath();ctx.strokeStyle="#f8bd45";ctx.lineWidth=4;ctx.stroke();
    }
  }
  function updateProgress() {
    progress.textContent="기준점 "+points.length+" / 10";
    prompt.textContent=points.length<10?BOARD_STEPS[points.length]:"거리 계산 완료 · 결과를 확인해 주세요.";
  }
  function renderSummary(data) {
    const lines=[
      "A4(297×210mm) 기준 평면 좌표 계산 완료",
      "위치      정면 X(mm)    좌우 Y(mm)   평면거리(mm)   참고 모델",
    ];
    for(const [slot,p] of Object.entries(data.locations)){
      const d=Math.hypot(p.x,p.y),lo=inverse(p.x,p.y,20),hi=inverse(p.x,p.y,60);
      const label=lo.reachable&&hi.reachable?"도달 추정":!lo.reachable&&!hi.reachable?"범위 밖 추정":"높이별 상이";
      lines.push([slot.padEnd(6),p.x.toFixed(1).padStart(8),p.y.toFixed(1).padStart(10),d.toFixed(1).padStart(12),label].join("  "));
    }
    lines.push("※ 깊이 카메라가 아니므로 물체 높이는 측정되지 않습니다. 참고 링크 치수·관절 제한에 따른 예상값이며 실제 충돌·하중·서보 방향을 판단하지 않습니다.");
    lines.push("※ 실제 구동은 별도로 확인하여 저장한 9개 자세만 사용합니다. 촬영 좌표를 그대로 서보에 전송하지 않습니다.");
    boardReach.textContent=lines.join("\n");
  }
  function finish(){
    try{
      const data=calibrateA4(points);
      state.boardModel=data;
      localStorage.setItem(key,JSON.stringify(data));
      renderSummary(data);
      notice("작업대 평면 거리 계산 성공. 실물 자동 이동에 직접 사용하지 않습니다.");
    } catch(err) {
      state.boardModel=null;
      boardReach.textContent="좌표 계산 실패: "+err.message+"\n다시 캡처하고 안내 순서대로 선택해 주세요.";
      notice("작업대 기준점 오류: "+err.message);
    }
  }
  function capture(){
    if(!video.videoWidth||!video.videoHeight)throw new Error("먼저 카메라를 켜고 영상이 표시되는지 확인하세요.");
    snapshot.width=canvas.width=960;
    snapshot.height=canvas.height=Math.round(960*video.videoHeight/video.videoWidth);
    snapCtx.drawImage(video,0,0,snapshot.width,snapshot.height);
    points=[];photoReady=true;state.boardModel=null;
    boardReach.textContent="촬영했습니다. 안내에 따라 A4 용지의 네 모서리부터 차례로 클릭해 주세요.";
    updateProgress();redraw();notice("작업대 영상 캡처. 첫 번째 기준점 선택을 시작합니다.");
  }
  function clear(){
    points=[];photoReady=false;state.boardModel=null;
    localStorage.removeItem(key);
    boardReach.textContent="저장된 작업대 좌표를 지웠습니다. 카메라에서 다시 캡처해 주세요.";
    updateProgress();redraw();notice("작업대 좌표 초기화");
  }
  captureButton.addEventListener("click",()=>{try{capture();}catch(err){boardReach.textContent=err.message;notice(err.message);}});
  resetButton.addEventListener("click",clear);
  canvas.addEventListener("click",event=>{
    if(!photoReady){boardReach.textContent="먼저 카메라를 켜고 화면을 캡처하세요.";return;}
    if(points.length>=10){boardReach.textContent="열 점이 완료되었습니다. 수정하려면 ‘기준점 다시 지정’ 후 재촬영하세요.";return;}
    const rect=canvas.getBoundingClientRect();
    const x=(event.clientX-rect.left)*canvas.width/rect.width;
    const y=(event.clientY-rect.top)*canvas.height/rect.height;
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    points.push({x,y});redraw();updateProgress();
    if(points.length===10)finish();
  });
  try{
    const saved=JSON.parse(localStorage.getItem(key)||"null");
    if(saved&&saved.source==="a4_camera_manual_corners"&&saved.locations){
      state.boardModel=saved;renderSummary(saved);
      prompt.textContent="저장된 작업대 기준점이 있습니다. 카메라가 움직였으면 다시 측정하세요.";
      progress.textContent="저장값 있음 (재검증 필요)";
    } else updateProgress();
  } catch {updateProgress();}
  redraw();
}
