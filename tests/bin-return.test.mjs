import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLocalIntent,normalizeIntent,normalizeShape,findSource,buildPickSequence,
  buildReturnSequence,resolveBinReturn
} from "../protocol.js";
import {targetForStep,SIM_WAYPOINTS} from "../simulator-motion.js";

test("return commands parse back into the original slot",()=>{
  const a=parseLocalIntent("보관함에서 삼각형을 원래 자리로 돌려놔");
  assert.deepEqual([a.kind,a.shape,a.source,a.target],["return_place","triangle","BIN","ORIGINAL"]);
  const b=parseLocalIntent("보관함에서 B칸으로 옮겨 줘");
  assert.deepEqual([b.kind,b.shape,b.source,b.target],["return_place",null,"BIN","B"]);
  const c=parseLocalIntent("보관함에서 삼각형을 A칸에 놓아 줘");
  assert.deepEqual([c.kind,c.shape,c.source,c.target],["return_place","triangle","BIN","A"]);
  assert.equal(normalizeShape("원래 자리"),null);
});
test("return request without destination pauses",()=>{
  assert.equal(parseLocalIntent("보관함에서 삼각형을 꺼내 줘").kind,"unclear");
});
test("forward command must remain backward-compatible",()=>{
  const cmd=parseLocalIntent("B칸의 삼각형을 보관함에 넣어 줘");
  assert.deepEqual([cmd.kind,cmd.shape,cmd.source,cmd.target],["pick_place","triangle","B","BIN"]);
  const slot=findSource(cmd,{A:"circle",B:"triangle",C:"cross"});
  assert.equal(slot,"B");
});
test("LLM reverse output is whitelisted without arbitrary servo parameters",()=>{
  const r=normalizeIntent({kind:"return_place",shape:"triangle",source:"BIN",target:"ORIGINAL",angles:[180,180,180,180]});
  assert.deepEqual(Object.keys(r),["kind","shape","source","target","explanation"]);
  assert.equal(r.kind,"return_place");
  assert.equal(normalizeIntent({kind:"return_place",shape:"triangle",source:"A",target:"ORIGINAL"}).kind,"unclear");
  assert.equal(normalizeIntent({kind:"return_place",shape:"triangle",source:"BIN",target:"PERSON"}).kind,"unclear");
});
test("return the recorded triangle to B after a simulated B-to-bin move",()=>{
  const intent=parseLocalIntent("보관함에서 삼각형을 원래 자리로 돌려놔");
  const selection=resolveBinReturn(intent,[{shape:"triangle",origin:"B"}],{A:"circle",B:null,C:"cross"});
  assert.deepEqual(selection,{index:0,shape:"triangle",origin:"B",destination:"B"});
});
test("a bin object can be returned to another empty explicitly requested slot",()=>{
  const selection=resolveBinReturn(parseLocalIntent("보관함에서 삼각형을 A칸으로 옮겨 줘"),
    [{shape:"triangle",origin:"B"}],{A:null,B:null,C:"cross"});
  assert.equal(selection.destination,"A");
});
test("return to an occupied slot is denied",()=>{
  assert.throws(()=>resolveBinReturn(parseLocalIntent("보관함에서 삼각형을 A칸으로 옮겨 줘"),
    [{shape:"triangle",origin:"B"}],{A:"circle",B:null,C:"cross"}),/이미 물체/);
});
test("empty bin and missing item cannot be returned",()=>{
  assert.throws(()=>resolveBinReturn(parseLocalIntent("보관함에서 삼각형을 원래 자리로 돌려놔"),
    [],{A:"circle",B:null,C:"cross"}),/없습니다/);
  assert.throws(()=>resolveBinReturn(parseLocalIntent("보관함에서 원을 원래 자리로 돌려놔"),
    [{shape:"triangle",origin:"B"}],{A:"circle",B:null,C:"cross"}),/찾을 수 없습니다/);
});
test("ambiguous bin contents require a specific shape or original slot",()=>{
  const inv=[{shape:"triangle",origin:"B"},{shape:"circle",origin:"A"}];
  const obs={A:null,B:null,C:"cross"};
  assert.throws(()=>resolveBinReturn(parseLocalIntent("보관함에서 원래 자리로 돌려놔"),inv,obs),/여러 개/);
  assert.equal(resolveBinReturn(parseLocalIntent("보관함에서 B칸으로 돌려놔"),inv,obs).shape,"triangle");
});
test("return sequence goes from bin pickup to original slot and home",()=>{
  const poses=Object.fromEntries(Object.keys(SIM_WAYPOINTS).map(key=>[key,[90,90,90,90]]));
  const steps=buildReturnSequence("B",poses,75,110);
  assert.equal(steps.length,9);
  assert.equal(steps[0].label,"HOVER_BIN");
  assert.equal(steps[1].label,"PLACE_BIN");
  assert.equal(steps[2].label,"PLACE_BIN (잡기)");
  assert.equal(steps[2].angles[3],110);
  assert.equal(steps[5].label,"PICK_B");
  assert.equal(steps[6].label,"PICK_B (놓기)");
  assert.equal(steps[6].angles[3],75);
  assert.equal(steps[8].label,"HOME");
  for(const step of steps){
    const p=targetForStep(step.label);
    assert.ok(p.x>=0&&p.x<=820&&p.y>=0&&p.y<=465);
  }
  assert.throws(()=>buildReturnSequence("B",{},75,110),/보정/);
});
