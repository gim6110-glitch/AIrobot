import test from "node:test";
import assert from "node:assert/strict";
import { visualJoints } from "../three-scene.js";
import { WORLD_WAYPOINTS,worldTargetForStep,lerpWorld } from "../simulator-motion.js";
import { buildPickSequence,buildReturnSequence } from "../protocol.js";

const shapes=Object.fromEntries(Object.keys(WORLD_WAYPOINTS).map(k=>[k,[90,90,90,90]]));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

test("3D waypoint labels support the complete pick and reverse sequences",()=>{
  for(const slot of ["A","B","C"]){
    const forward=buildPickSequence(slot,shapes,75,110);
    const reverse=buildReturnSequence(slot,shapes,75,110);
    for(const step of [...forward,...reverse]){
      const goal=worldTargetForStep(step.label);
      assert.ok(Number.isFinite(goal.x)&&Number.isFinite(goal.y)&&Number.isFinite(goal.z));
      assert.ok(goal.y>0);
    }
  }
});
test("3D visual joints include base yaw, raised shoulder, elbow, tool tip, and respect reference link lengths",()=>{
  const model=visualJoints([90,90,90,90],WORLD_WAYPOINTS.PICK_B);
  assert.ok(Math.abs(model.a.y-92)<0.001);
  assert.ok(Math.abs(distance(model.a,model.b)-135)<0.001);
  assert.ok(Math.abs(distance(model.b,model.c)-147)<0.001);
  assert.ok(Math.abs(distance(model.c,model.tip)-87)<0.001);
  assert.ok(distance(model.tip,WORLD_WAYPOINTS.PICK_B)<1);
  assert.equal(model.unreachable,false);
});
test("3D auto motion ends at exact visual target for every fixed table location",()=>{
  for(const point of Object.values(WORLD_WAYPOINTS)){
    const actual=visualJoints([90,90,90,90],point);
    assert.ok(distance(actual.tip,point)<1.01);
  }
});
test("3D manual joint sliders alter base yaw and arm height without actuating hardware",()=>{
  const initial=visualJoints([90,90,90,90],null);
  const yawMoved=visualJoints([125,90,90,90],null);
  const lift=visualJoints([90,120,90,90],null);
  assert.ok(distance(initial.tip,yawMoved.tip)>5);
  assert.ok(distance(initial.tip,lift.tip)>5);
  assert.ok([initial,yawMoved,lift].every(j=>Number.isFinite(j.tip.x)&&Number.isFinite(j.tip.y)&&Number.isFinite(j.tip.z)));
});
test("3D interpolated animation stays between start and destination",()=>{
  const first=WORLD_WAYPOINTS.HOVER_A,last=WORLD_WAYPOINTS.HOVER_BIN;
  assert.deepEqual(lerpWorld(first,last,0),first);
  assert.deepEqual(lerpWorld(first,last,1),last);
  const middle=lerpWorld(first,last,0.5);
  for(const axis of ["x","y","z"])assert.ok(middle[axis]>=Math.min(first[axis],last[axis])&&middle[axis]<=Math.max(first[axis],last[axis]));
});

test("all three bin pickup/drop positions remain inside the visual arm's reachable envelope",()=>{
  for(let i=0;i<3;i++){
    for(const name of ["PLACE_BIN","HOVER_BIN"]){
      const pos=worldTargetForStep(name,{binIndex:i});
      const joints=visualJoints([90,90,90,90],pos);
      assert.equal(joints.unreachable,false,name+" index "+i);
      assert.ok(distance(joints.tip,pos)<1.01);
    }
  }
});
