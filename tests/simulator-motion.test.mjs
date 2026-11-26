import test from "node:test";
import assert from "node:assert/strict";
import { needsPhysicalVerification, SIM_WAYPOINTS, targetForStep, visualArmGeometry, manualVisualTip } from "../simulator-motion.js";
import { buildPickSequence } from "../protocol.js";

test("Simulator requires the one visible execution approval only; physical mode still requires camera/site confirmation",()=>{
  assert.equal(needsPhysicalVerification("sim"),false);
  assert.equal(needsPhysicalVerification("real"),true);
  assert.equal(needsPhysicalVerification("unknown"),true);
});
test("B-bin motion contains visible and bounded positions for each of nine steps",()=>{
  const poses=Object.fromEntries(Object.keys(SIM_WAYPOINTS).map(k=>[k,[90,90,90,90]]));
  const steps=buildPickSequence("B",poses,75,110);
  assert.equal(steps.length,9);
  const points=steps.map(s=>targetForStep(s.label));
  for(const tip of points){
    const arm=visualArmGeometry(tip);
    for(const key of ["shoulder","joint","tip"]) {
      assert.ok(arm[key].x>=0 && arm[key].x<=820, "x "+key);
      assert.ok(arm[key].y>=0 && arm[key].y<=465, "y "+key);
    }
  }
  assert.deepEqual(points[0],SIM_WAYPOINTS.HOVER_B);
  assert.deepEqual(points[1],SIM_WAYPOINTS.PICK_B);
  assert.deepEqual(points[4],SIM_WAYPOINTS.HOVER_BIN);
  assert.deepEqual(points[5],SIM_WAYPOINTS.PLACE_BIN);
  assert.deepEqual(points[8],SIM_WAYPOINTS.HOME);
});
test("manual simulation sliders cannot position the visual gripper outside the workspace",()=>{
  for(const angles of [[0,0,0,0],[90,90,90,90],[180,180,180,180]]){
    const tip=manualVisualTip(angles);
    assert.ok(tip.x>=210&&tip.x<=720);
    assert.ok(tip.y>=126&&tip.y<=333);
  }
  assert.throws(()=>manualVisualTip([0,1,NaN,2]));
});
test("incorrect simulator steps cannot silently drive an arbitrary point",()=>{
  assert.throws(()=>targetForStep("MOVE_999"));
});
