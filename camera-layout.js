/**
 * Canonical dimensions in millimetres for the illustrative workbench.
 * X is forward from the robot, Y is vertical, Z increases from A toward C.
 * This neither calibrates real servo poses nor the physical camera.
 */
export const WORK_SURFACE=Object.freeze({x:260,y:5,z:30,widthX:240,depthZ:428});
export const SLOT_CENTERS=Object.freeze({
  A:Object.freeze({x:190,z:-115}),
  B:Object.freeze({x:190,z:0}),
  C:Object.freeze({x:190,z:115})
});
export const SLOT_SIZE_MM=80;
export const BIN_CENTER=Object.freeze({x:305,y:0,z:145});
export const BIN_SIZE_MM=Object.freeze({widthX:106,depthZ:82,wall:6});
export const CAMERA_TARGET=Object.freeze({x:WORK_SURFACE.x,y:WORK_SURFACE.y,z:WORK_SURFACE.z});
export const CAMERA_STAND=Object.freeze({x:430,y:0,z:-165});
export const CAMERA_DEFAULT=Object.freeze({
  heightMm:340,offsetXmm:0,offsetZmm:0,fovDeg:42,showFootprint:true
});
export const CAMERA_ASPECT=16/9;
export const CAMERA_OPTICAL_INSET_MM=20;
export const ITEM_ORIGIN_BELOW_TIP_MM=25;
export const ITEM_RADIUS_MM=18;
export const FINGER_THICKNESS_MM=9;
export const GRIP_CONTACT_COMPRESSION_MM=1.5;
export const FINGER_HALF_GAP_CLOSED_MM=
  ITEM_RADIUS_MM+FINGER_THICKNESS_MM/2-GRIP_CONTACT_COMPRESSION_MM;
export const FINGER_HALF_GAP_OPEN_MM=32;
const BIN_OFFSETS=Object.freeze([
  Object.freeze({x:-20,y:0,z:-16}),
  Object.freeze({x:-20,y:0,z:16}),
  Object.freeze({x:18,y:0,z:0})
]);
export const BIN_ITEM_CAPACITY=BIN_OFFSETS.length;

export function normalizeCameraConfig(input={}){
  const raw={...CAMERA_DEFAULT,...input};
  const checks={heightMm:[270,650],offsetXmm:[-150,150],offsetZmm:[-150,150],fovDeg:[35,80]};
  const out={};
  for(const [key,[min,max]] of Object.entries(checks)){
    const n=Number(raw[key]);
    if(!Number.isFinite(n)||n<min||n>max)throw new Error("카메라 설정 "+key+" 범위를 확인하세요.");
    out[key]=n;
  }
  out.showFootprint=Boolean(raw.showFootprint);
  return out;
}
export function cameraPosition(config=CAMERA_DEFAULT){
  const c=normalizeCameraConfig(config);
  return {x:CAMERA_TARGET.x+c.offsetXmm,y:c.heightMm,z:CAMERA_TARGET.z+c.offsetZmm};
}
export function cameraLensPosition(config=CAMERA_DEFAULT){
  const p=cameraPosition(config),d=[
    CAMERA_TARGET.x-p.x,CAMERA_TARGET.y-p.y,CAMERA_TARGET.z-p.z
  ];
  const length=Math.hypot(...d);
  return {x:p.x+CAMERA_OPTICAL_INSET_MM*d[0]/length,
    y:p.y+CAMERA_OPTICAL_INSET_MM*d[1]/length,
    z:p.z+CAMERA_OPTICAL_INSET_MM*d[2]/length};
}
export function binItemOffset(index){
  if(!Number.isInteger(index)||index<0||index>=BIN_ITEM_CAPACITY)
    throw new Error("시뮬레이터 보관함에는 최대 "+BIN_ITEM_CAPACITY+"개만 표현할 수 있습니다.");
  return {...BIN_OFFSETS[index]};
}
export function gripObjectOrigin(tip){
  if(!tip||![tip.x,tip.y,tip.z].every(Number.isFinite))
    throw new Error("집게 위치가 올바르지 않습니다.");
  return {x:tip.x,y:tip.y-ITEM_ORIGIN_BELOW_TIP_MM,z:tip.z};
}
export function fingerHalfGap(angle=75,carrying=false){
  if(carrying)return FINGER_HALF_GAP_CLOSED_MM;
  const t=Math.min(1,Math.max(0,(Number(angle)-75)/(110-75)));
  return FINGER_HALF_GAP_OPEN_MM+
    (FINGER_HALF_GAP_CLOSED_MM-FINGER_HALF_GAP_OPEN_MM)*t;
}
const norm=v=>{const len=Math.hypot(...v);return v.map(x=>x/len);};
const cross=(a,b)=>[
  a[1]*b[2]-a[2]*b[1],
  a[2]*b[0]-a[0]*b[2],
  a[0]*b[1]-a[1]*b[0]
];
/** Matches THREE.Camera's +X up direction, including a straight-down lens. */
export function cameraAxes(config=CAMERA_DEFAULT){
  const p=cameraLensPosition(config);
  const forward=norm([CAMERA_TARGET.x-p.x,CAMERA_TARGET.y-p.y,CAMERA_TARGET.z-p.z]);
  const right=norm(cross(forward,[1,0,0]));
  const up=norm(cross(right,forward));
  return {forward,right,up};
}
export function footprintCorners(config=CAMERA_DEFAULT,aspect=CAMERA_ASPECT){
  const c=normalizeCameraConfig(config);
  if(!Number.isFinite(aspect)||aspect<=0)throw new Error("카메라 영상 비율이 올바르지 않습니다.");
  const p=cameraLensPosition(c),{forward,right,up}=cameraAxes(c);
  const tanV=Math.tan(c.fovDeg*Math.PI/360),tanH=tanV*aspect;
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy])=>{
    const d=norm(forward.map((v,i)=>v+right[i]*tanH*sx+up[i]*tanV*sy));
    if(d[1]>=-0.01)throw new Error("카메라가 작업대를 충분히 내려다보지 않습니다.");
    const t=(WORK_SURFACE.y-p.y)/d[1];
    return {x:p.x+d[0]*t,y:WORK_SURFACE.y,z:p.z+d[2]*t};
  });
}
const pointInside=(poly,p)=>{
  let sign=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    const cross2=(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
    if(Math.abs(cross2)<1e-6)continue;
    const next=Math.sign(cross2);
    if(sign&&next!==sign)return false;
    sign=next;
  }
  return true;
};
export function cameraFitAssessment(config=CAMERA_DEFAULT){
  const quad=footprintCorners(config);
  const rect=(x,z,widthX,depthZ)=>[
    {x:x-widthX/2,z:z-depthZ/2},{x:x+widthX/2,z:z-depthZ/2},
    {x:x+widthX/2,z:z+depthZ/2},{x:x-widthX/2,z:z+depthZ/2}
  ];
  const boardCorners=rect(WORK_SURFACE.x,WORK_SURFACE.z,WORK_SURFACE.widthX,WORK_SURFACE.depthZ);
  const slotAndBinCorners=[
    ...Object.values(SLOT_CENTERS).flatMap(p=>rect(p.x,p.z,SLOT_SIZE_MM,SLOT_SIZE_MM)),
    ...rect(BIN_CENTER.x,BIN_CENTER.z,BIN_SIZE_MM.widthX,BIN_SIZE_MM.depthZ)
  ];
  const area=p=>Math.abs(p.reduce((s,a,i)=>{
    const b=p[(i+1)%p.length];return s+a.x*b.z-b.x*a.z;
  },0))/2;
  const areaRatio=area(quad)/(WORK_SURFACE.widthX*WORK_SURFACE.depthZ);
  const boardCovered=boardCorners.every(p=>pointInside(quad,p));
  const objectsCovered=slotAndBinCorners.every(p=>pointInside(quad,p));
  return {boardCovered,objectsCovered,areaRatio,
    aligned:boardCovered&&objectsCovered&&areaRatio<=1.08};
}
