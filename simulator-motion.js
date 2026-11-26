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
