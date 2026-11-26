/**
 * Visual-only 2D arm waypoints.
 * Does NOT calculate actual Mk2 inverse kinematics or collision clearance.
 */
export const SIM_WAYPOINTS = Object.freeze({
 HOME:{x:300,y:183},
 HOVER_A:{x:303,y:247}, PICK_A:{x:303,y:314},
 HOVER_B:{x:456,y:247}, PICK_B:{x:456,y:314},
 HOVER_C:{x:610,y:247}, PICK_C:{x:610,y:314},
 HOVER_BIN:{x:680,y:132}, PLACE_BIN:{x:680,y:207}
});
/**
 * Tabletop 3D demonstration positions in millimetres relative to the base.
 * These are visual layout coordinates, NOT calibrated real pick poses.
 */
export const WORLD_WAYPOINTS=Object.freeze({
  HOME:{x:195,y:204,z:0},
  HOVER_A:{x:240,y:122,z:-115},PICK_A:{x:240,y:48,z:-115},
  HOVER_B:{x:267,y:122,z:0},PICK_B:{x:267,y:48,z:0},
  HOVER_C:{x:240,y:122,z:115},PICK_C:{x:240,y:48,z:115},
  HOVER_BIN:{x:310,y:135,z:170},PLACE_BIN:{x:310,y:60,z:170}
});
export function worldTargetForStep(label){
  const key=String(label||"").split(" ")[0];
  const v=WORLD_WAYPOINTS[key];
  if(!v)throw new Error("알 수 없는 3D 시뮬레이션 위치: "+key);
  return {...v};
}
export function lerpWorld(a,b,t){
  if(!a||!b||![a.x,a.y,a.z,b.x,b.y,b.z,t].every(Number.isFinite))
    throw new Error("3D 시뮬레이터 이동 좌표가 잘못되었습니다.");
  const f=Math.min(1,Math.max(0,t));
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f};
}

export const needsPhysicalVerification = mode => mode !== "sim";

export function targetForStep(label) {
  const key=String(label||"").split(" ")[0];
  const point=SIM_WAYPOINTS[key];
  if (!point) throw new Error("알 수 없는 시뮬레이션 위치입니다: "+key);
  return {...point};
}

export function visualArmGeometry(tip) {
  if(!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)){
    throw new Error("유효하지 않은 시뮬레이터 목표 위치입니다.");
  }
  const shoulder={x:145,y:241};
  // Deliberately illustrative elbow bend: link lengths are not to scale.
  const joint={
    x: shoulder.x+(tip.x-shoulder.x)*0.49,
    y: Math.max(65, Math.min(155, Math.min(shoulder.y,tip.y)-105))
  };
  return {shoulder,joint,tip:{x:tip.x,y:tip.y}};
}

export function manualVisualTip(angles) {
  if(!Array.isArray(angles)||angles.length!==4||angles.some(a=>!Number.isFinite(a))){
    throw new Error("수동 조작 각도 형식이 올바르지 않습니다.");
  }
  const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
  return {
    x:clamp(365+(angles[0]-90)*3.0+(angles[2]-90)*.7,210,720),
    y:clamp(211+(angles[1]-90)*1.65,126,333)
  };
}
