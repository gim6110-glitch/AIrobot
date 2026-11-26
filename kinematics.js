/**
 * Educational reference EEZYbotARM Mk2 kinematic model.
 * Link dimensions and nominal joint limits are from:
 * https://github.com/meisben/easyEEZYbotARM/blob/master/python_packages/easyEEZYbotARM/kinematic_model.py
 * Reference implementation is MIT licensed. This is an independently written JS implementation.
 *
 * DO NOT feed these joint angles directly into a real robot:
 * geometry differs by print, servo mounts, gripper pad, and actual joint stops.
 */
export const MK2_REFERENCE = Object.freeze({
  L1:92, L2:135, L3:147, L4:87,
  q1Min:-30, q1Max:30, q2Min:39, q2Max:120
});
const rad=x=>x*Math.PI/180, deg=x=>x*180/Math.PI;
const clamp=(x,min,max)=>Math.min(max,Math.max(min,x));
export function jointLimits(q2,model=MK2_REFERENCE) {
  if(!Number.isFinite(q2))throw new Error("q2가 숫자가 아닙니다.");
  return {q1:[model.q1Min,model.q1Max],q2:[model.q2Min,model.q2Max],
    q3:[-0.6755*q2-70.768,-0.7165*q2-13.144]};
}
export function checkJoint(q1,q2,q3,model=MK2_REFERENCE) {
  const limits=jointLimits(q2,model);
  return [[q1,...limits.q1],[q2,...limits.q2],[q3,...limits.q3]].every(([v,lo,hi])=>Number.isFinite(v)&&v>=lo-1e-8&&v<=hi+1e-8);
}
export function forward(q1,q2,q3,model=MK2_REFERENCE) {
  if(![q1,q2,q3].every(Number.isFinite))throw new Error("각도가 유효하지 않습니다.");
  const a=rad(q1),b=rad(q2),c=rad(q3);
  const planar=model.L2*Math.cos(b)+model.L3*Math.cos(b+c)+model.L4;
  return {x:planar*Math.cos(a),y:planar*Math.sin(a),
    z:model.L1+model.L2*Math.sin(b)+model.L3*Math.sin(b+c)};
}
export function inverse(x,y,z,model=MK2_REFERENCE) {
  if(![x,y,z].every(Number.isFinite))return {reachable:false,reason:"유효하지 않은 좌표입니다."};
  const q1=deg(Math.atan2(y,x));
  const r=Math.hypot(x,y)-model.L4, h=z-model.L1;
  const d2=r*r+h*h;
  const c=(d2-model.L2*model.L2-model.L3*model.L3)/(2*model.L2*model.L3);
  if(c < -1-1e-7||c>1+1e-7)return {reachable:false,reason:"기구학적으로 팔 길이가 닿지 않는 위치입니다."};
  const q3=-deg(Math.acos(clamp(c,-1,1)));
  const q2=deg(Math.atan2(h,r)-Math.atan2(model.L3*Math.sin(rad(q3)),model.L2+model.L3*Math.cos(rad(q3))));
  if(!checkJoint(q1,q2,q3,model))return {reachable:false,reason:"EEZYbotARM Mk2 참고 관절 제한을 벗어납니다.",joint:[q1,q2,q3]};
  const projected=forward(q1,q2,q3,model);
  const error=Math.hypot(projected.x-x,projected.y-y,projected.z-z);
  if(error>0.5)return {reachable:false,reason:"역기구학 계산 오차가 커서 실행할 수 없습니다."};
  return {reachable:true,joint:[q1,q2,q3],target:{x,y,z},errorMm:error,
    note:"참고 모델상 도달 가능. 실제 기구 간섭·토크·서보 각도는 확인되지 않았습니다."};
}
/**
 * Sample a reachable 2D cross-section at azimuth 0.
 * This is NOT a collision map or load feasibility proof.
 */
export function crossSection(model=MK2_REFERENCE,step=5){
  const points=[];
  for(let q2=model.q2Min;q2<=model.q2Max;q2+=step){
    const {q3}=jointLimits(q2,model);
    for(let a=q3[0];a<=q3[1];a+=step){
      if(checkJoint(0,q2,a,model))points.push(forward(0,q2,a,model));
    }
  }
  return points;
}
