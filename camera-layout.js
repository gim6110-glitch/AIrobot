/** Settings for the instructional overhead camera mount.
 * mm positions describe the 3D drawing only: no hardware movement or actual
 * camera calibration happens when changing these settings.
 */
export const CAMERA_DEFAULT = Object.freeze({
  heightMm:550, offsetXmm:55, offsetZmm:-45, fovDeg:65, showFootprint:true
});
export const CAMERA_TARGET = Object.freeze({x:264,y:0,z:24});
export const CAMERA_STAND = Object.freeze({x:480,y:0,z:-202});
export const ITEM_ORIGIN_BELOW_TIP_MM = 25;
export const ITEM_RADIUS_MM = 18;
export const FINGER_THICKNESS_MM = 9;
export const FINGER_HALF_GAP_CLOSED_MM = 23;
export const FINGER_HALF_GAP_OPEN_MM = 32;
export const BIN_ITEM_SPACING_MM = 14;
export const BIN_ITEM_CAPACITY = 3;
export function normalizeCameraConfig(input={}){
  const raw={...CAMERA_DEFAULT,...input};
  const checks={heightMm:[360,800],offsetXmm:[-150,150],offsetZmm:[-150,150],fovDeg:[45,95]};
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
  const cfg=normalizeCameraConfig(config);
  return {
    x:CAMERA_TARGET.x+cfg.offsetXmm,
    y:cfg.heightMm,
    z:CAMERA_TARGET.z+cfg.offsetZmm
  };
}
export function binItemOffset(index){
  if(!Number.isInteger(index)||index<0||index>=BIN_ITEM_CAPACITY)
    throw new Error("시뮬레이터 보관함에는 최대 "+BIN_ITEM_CAPACITY+"개만 표현할 수 있습니다.");
  return {x:-BIN_ITEM_SPACING_MM*index,y:0,z:0};
}
export function gripObjectOrigin(tip){
  if(!tip||![tip.x,tip.y,tip.z].every(Number.isFinite))throw new Error("집게 위치가 올바르지 않습니다.");
  return {x:tip.x,y:tip.y-ITEM_ORIGIN_BELOW_TIP_MM,z:tip.z};
}
export function fingerHalfGap(angle=75,carrying=false){
  if(carrying)return FINGER_HALF_GAP_CLOSED_MM;
  const t=Math.min(1,Math.max(0,(Number(angle)-75)/(110-75)));
  return FINGER_HALF_GAP_OPEN_MM+
    (FINGER_HALF_GAP_CLOSED_MM-FINGER_HALF_GAP_OPEN_MM)*t;
}
export function footprintCorners(config=CAMERA_DEFAULT,aspect=16/9){
  const cfg=normalizeCameraConfig(config);
  const p=cameraPosition(cfg),target=CAMERA_TARGET;
  const norm=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);};
  const forward=norm([target.x-p.x,target.y-p.y,target.z-p.z]);
  const right=Math.hypot(forward[0],forward[2])<1e-6
    ?[1,0,0]:norm([-forward[2],0,forward[0]]);
  const up=[-right[2]*forward[1],right[2]*forward[0]-right[0]*forward[2],right[0]*forward[1]];
  // right cross forward is up for a camera directed down; normalize it.
  const U=norm(up);
  const tanV=Math.tan(cfg.fovDeg*Math.PI/360),tanH=tanV*aspect;
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy])=>{
    const d=norm(forward.map((v,i)=>v+right[i]*tanH*sx+U[i]*tanV*sy));
    if(d[1]>=-0.01)throw new Error("카메라가 작업대를 충분히 내려다보지 않습니다.");
    const t=(5-p.y)/d[1];
    return {x:p.x+d[0]*t,y:5,z:p.z+d[2]*t};
  });
}
