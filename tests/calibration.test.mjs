import test from "node:test";
import assert from "node:assert/strict";
import { MK2_REFERENCE, jointLimits,checkJoint,forward,inverse,crossSection } from "../kinematics.js";
import { BOARD_STEPS,solveLinear,homography,transform,calibrateA4 } from "../workplane.js";

test("EEZYbotARM Mk2 참고 치수와 관절 범위",()=>{
  assert.deepEqual([MK2_REFERENCE.L1,MK2_REFERENCE.L2,MK2_REFERENCE.L3,MK2_REFERENCE.L4],[92,135,147,87]);
  assert.equal(checkJoint(0,90,-90),true);
  assert.equal(checkJoint(90,90,-90),false);
  assert.ok(jointLimits(90).q3[0]<jointLimits(90).q3[1]);
});
test("정기구학/역기구학 역변환",()=>{
  const p=forward(0,90,-90);
  assert.ok(Math.abs(p.x-234)<1e-9);
  assert.ok(Math.abs(p.z-227)<1e-9);
  const result=inverse(p.x,p.y,p.z);
  assert.equal(result.reachable,true);
  assert.ok(result.errorMm<0.001);
  result.joint.forEach((v,i)=>assert.ok(Math.abs(v-[0,90,-90][i])<1e-7));
});
test("기계적으로 닿지 않는 물체 자동 보류",()=>{
  assert.equal(inverse(1000,0,100).reachable,false);
  assert.equal(inverse(NaN,0,30).reachable,false);
});
test("반복 샘플링 좌표는 유효 범위",()=>{
  const pts=crossSection(MK2_REFERENCE,9);
  assert.ok(pts.length>10);
  assert.ok(pts.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z)));
});
test("A4의 네 점을 mm로 환산",()=>{
  assert.equal(BOARD_STEPS.length,10);
  const src=[{x:0,y:0},{x:297,y:0},{x:297,y:210},{x:0,y:210}];
  const dst=[{x:0,y:0},{x:297,y:0},{x:297,y:210},{x:0,y:210}];
  const H=homography(src,dst);
  const p=transform(H,{x:145,y:90});
  assert.ok(Math.abs(p.x-145)<1e-8&&Math.abs(p.y-90)<1e-8);
});
test("A4 위 10개 기준점으로 작업대 상대 좌표 계산",()=>{
  const points=[
    {x:0,y:0},{x:297,y:0},{x:297,y:210},{x:0,y:210},
    {x:80,y:100},{x:160,y:100},
    {x:170,y:100},{x:180,y:140},{x:175,y:60},{x:220,y:110}
  ];
  const out=calibrateA4(points);
  assert.ok(Math.abs(out.locations.A.x-90)<1e-8);
  assert.ok(Math.abs(out.locations.B.y-40)<1e-8);
  assert.ok(Math.abs(out.locations.C.y+40)<1e-8);
  assert.ok(Math.abs(out.locations.BIN.x-140)<1e-8);
});
test("카메라 기준점 누락/중복 보류",()=>{
  assert.throws(()=>calibrateA4([]));
  assert.throws(()=>solveLinear([[1,1],[1,1]],[1,1]));
});
