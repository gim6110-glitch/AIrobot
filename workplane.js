/**
 * One-time tabletop camera calibration without manual coordinate arithmetic.
 * User clicks A4 sheet corners clockwise (TL, TR, BR, BL), robot base,
 * forward direction, then A/B/C/BIN object centers. Flat-table plane only.
 */
export const BOARD_STEPS=[
  "A4 종이의 왼쪽 위 모서리를 누르세요.",
  "A4 종이의 오른쪽 위 모서리를 누르세요.",
  "A4 종이의 오른쪽 아래 모서리를 누르세요.",
  "A4 종이의 왼쪽 아래 모서리를 누르세요.",
  "로봇팔의 베이스 회전축 중심을 누르세요.",
  "로봇팔의 정면 방향으로 뻗은 점을 누르세요. 베이스에서 충분히 떨어져야 합니다.",
  "A칸 물체 중심을 누르세요.",
  "B칸 물체 중심을 누르세요.",
  "C칸 물체 중심을 누르세요.",
  "보관함의 중앙을 누르세요."
];
const finite=n=>typeof n==="number"&&Number.isFinite(n);
export function solveLinear(matrix,b){
  const n=b.length;
  if(!Array.isArray(matrix)||matrix.length!==n||matrix.some(row=>row.length!==n))throw new Error("행렬 크기가 일치하지 않습니다.");
  const a=matrix.map((r,i)=>[...r,b[i]]);
  for(let k=0;k<n;k++){
    let best=k;
    for(let i=k+1;i<n;i++)if(Math.abs(a[i][k])>Math.abs(a[best][k]))best=i;
    if(Math.abs(a[best][k])<1e-10)throw new Error("기준점들이 한 줄에 가깝거나 중복되었습니다. 다시 촬영해 주세요.");
    [a[k],a[best]]=[a[best],a[k]];
    const pivot=a[k][k];
    for(let j=k;j<=n;j++)a[k][j]/=pivot;
    for(let i=0;i<n;i++){if(i===k)continue;const t=a[i][k];for(let j=k;j<=n;j++)a[i][j]-=t*a[k][j];}
  }
  return a.map(r=>r[n]);
}
export function homography(source,target){
  if(source.length!==4||target.length!==4||![...source,...target].every(p=>finite(p?.x)&&finite(p?.y)))throw new Error("네 모서리 좌표가 필요합니다.");
  const a=[],b=[];
  for(let i=0;i<4;i++){
    const p=source[i],q=target[i],x=p.x,y=p.y,u=q.x,v=q.y;
    a.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);
    a.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);
  }
  return [...solveLinear(a,b),1];
}
export function transform(H,p){
  const denominator=H[6]*p.x+H[7]*p.y+H[8];
  if(Math.abs(denominator)<1e-8)throw new Error("카메라 변환 좌표가 불안정합니다.");
  return {x:(H[0]*p.x+H[1]*p.y+H[2])/denominator,
    y:(H[3]*p.x+H[4]*p.y+H[5])/denominator};
}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function polygonArea(p){
  return .5*Math.abs(p.reduce((sum,q,i)=>{const r=p[(i+1)%p.length];return sum+q.x*r.y-r.x*q.y;},0));
}
export function calibrateA4(points,{widthMm=297,heightMm=210}={}){
  if(!Array.isArray(points)||points.length!==10||points.some(p=>!finite(p?.x)||!finite(p?.y)))throw new Error("A4 네 모서리·베이스·정면·A/B/C/보관함의 열 점이 필요합니다.");
  if(!(widthMm>=100&&widthMm<=400&&heightMm>=100&&heightMm<=400))throw new Error("A4 용지 길이를 확인하세요.");
  if(polygonArea(points.slice(0,4))<1000)throw new Error("A4 영역이 너무 작습니다. 카메라를 가까이 고정하세요.");
  const board=[[0,0],[widthMm,0],[widthMm,heightMm],[0,heightMm]].map(([x,y])=>({x,y}));
  const H=homography(points.slice(0,4),board);
  const mm=points.map(p=>transform(H,p));
  const base=mm[4],front=mm[5];
  const delta={x:front.x-base.x,y:front.y-base.y},norm=Math.hypot(delta.x,delta.y);
  if(norm<40)throw new Error("로봇 정면 기준점이 베이스에서 너무 가깝습니다. 다시 찍어 주세요.");
  const u={x:delta.x/norm,y:delta.y/norm};
  const local=p=>({x:(p.x-base.x)*u.x+(p.y-base.y)*u.y,
    y:-(p.x-base.x)*u.y+(p.y-base.y)*u.x});
  const locs={};
  ["A","B","C","BIN"].forEach((key,i)=>locs[key]=local(mm[i+6]));
  if(Object.values(locs).some(p=>Math.hypot(p.x,p.y)>800))throw new Error("측정된 위치가 로봇팔에서 너무 멉니다. A4 모서리 순서와 카메라 위치를 점검하세요.");
  return {source:"a4_camera_manual_corners",widthMm,heightMm,corners:points.slice(0,4),
    imagePoints:points,locations:locs,base:local(base),
    note:"단일 평면(x,y)의 거리 추정입니다. 깊이·물체 높이·카메라 렌즈 왜곡은 포함하지 않습니다."};
}
