import test from "node:test";
import assert from "node:assert/strict";
import { parseLocalIntent, normalizeIntent, findSource, buildPickSequence,
         poseLine, serialWhitelist, normalizeShape, messageLine } from "../protocol.js";

test("한국어 작업 요청의 대상·목적지 파악", ()=>{
  const cmd=parseLocalIntent("B칸의 삼각형을 보관함에 넣어 줘");
  assert.equal(cmd.kind,"pick_place");
  assert.equal(cmd.source,"B");
  assert.equal(cmd.shape,"triangle");
  assert.equal(cmd.target,"BIN");
});
test("모호한 요청을 보류",()=>{
  assert.equal(parseLocalIntent("아무거나 집어 줘").kind,"unclear");
});
test("한국어 단일 클래스 이름 원 인식",()=>{
  assert.equal(normalizeShape("원"),"circle");
  assert.equal(normalizeShape("삼각형"),"triangle");
  assert.equal(normalizeShape("십자"),"cross");
});
test("LLM 출력 화이트리스트",()=>{
  assert.equal(normalizeIntent({kind:"pick_place",shape:"triangle",target:"BIN"}).kind,"pick_place");
  assert.equal(normalizeIntent({kind:"pick_place",shape:"triangle",target:"PERSON"}).kind,"unclear");
  assert.equal(normalizeIntent({kind:"pick_place",shape:"explosive",target:"BIN"}).kind,"unclear");
});
test("유일한 표식 칸 자동 결정",()=>{
  assert.equal(findSource(parseLocalIntent("삼각형을 보관함에 넣어 줘"),
    {A:"circle",B:"triangle",C:"cross"}),"B");
});
test("한 표식이 두 칸에 있으면 중지",()=>{
  assert.throws(()=>findSource(parseLocalIntent("삼각형을 보관함에 넣어 줘"),
    {A:"triangle",B:"triangle",C:"circle"}));
});
test("실물 9개 포즈가 미보정이면 자동 집기 금지",()=>{
  assert.throws(()=>buildPickSequence("B",{},75,110));
});
test("보정값이 완전하면 순차 동작만 생성",()=>{
  const poses=Object.fromEntries(["HOME","HOVER_A","PICK_A","HOVER_B","PICK_B",
    "HOVER_C","PICK_C","HOVER_BIN","PLACE_BIN"].map(name=>[name,[90,90,90,90]]));
  const steps=buildPickSequence("B",poses,75,110);
  assert.equal(steps.length,9);
  assert.equal(steps[2].angles[3],110);
  assert.equal(steps[6].angles[3],75);
});
test("Arduino에 전송하는 문자열은 화이트리스트",()=>{
  assert.equal(poseLine([90,90,90,90]),"POSE,90,90,90,90\n");
  assert.equal(serialWhitelist("POSE,90,90,90,90\n"),true);
  assert.equal(serialWhitelist("POSE,190,90,90,90\n"),false);
  assert.equal(serialWhitelist("LOAD_PROGRAM\n"),false);
  assert.throws(()=>poseLine([90,NaN,90,90]));
});
test("Arduino 완료 응답은 물리적 집기 성공 판정이 아님",()=>{
  assert.equal(messageLine("DONE POSE").type,"DONE");
  assert.equal(messageLine("STOPPED WATCHDOG").type,"STOPPED");
});