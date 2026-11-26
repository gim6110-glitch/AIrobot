import test from "node:test";
import assert from "node:assert/strict";
import {
 CAMERA_DEFAULT,normalizeCameraConfig,cameraPosition,cameraLensPosition,footprintCorners,
 gripObjectOrigin,fingerHalfGap,ITEM_RADIUS_MM,FINGER_THICKNESS_MM,
 binItemOffset,BIN_ITEM_CAPACITY
} from "../camera-layout.js";
import {WORLD_WAYPOINTS,worldTargetForStep} from "../simulator-motion.js";
import {normalizeShape,parseLocalIntent,shapeLabel} from "../protocol.js";

const almost=(a,b)=>Math.abs(a-b)<1e-8;
const samePoint=(a,b)=>["x","y","z"].every(axis=>almost(a[axis],b[axis]));
const contains=(polygon,point)=>{
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.z>point.z)!==(b.z>point.z) &&
       point.x < (b.x-a.x)*(point.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside;
};

test("middle-button rotation is configured, with scroll zoom left available",async()=>{
  const {readFile}=await import("node:fs/promises");
  const src=await readFile(new URL("../three-scene.js",import.meta.url),"utf8");
  assert.match(src,/MIDDLE:THREE\.MOUSE\.ROTATE/);
  assert.match(src,/LEFT:THREE\.MOUSE\.ROTATE/);
  assert.match(src,/RIGHT:THREE\.MOUSE\.PAN/);
  assert.match(src,/cancelMiddleAutoscroll/);
});

test("pickup grip center and object holder center stay identical for A/B/C",()=>{
  const centers={A:{x:240,y:9,z:-115},B:{x:267,y:9,z:0},C:{x:240,y:9,z:115}};
  for(const slot of ["A","B","C"]){
    const goal=worldTargetForStep("PICK_"+slot);
    assert.ok(samePoint(gripObjectOrigin(goal),centers[slot]));
  }
});
test("storage bin pickup/deposit aligns first/second/third object centers",()=>{
  assert.equal(BIN_ITEM_CAPACITY,3);
  for(let i=0;i<BIN_ITEM_CAPACITY;i++){
    const offset=binItemOffset(i);
    const actual=gripObjectOrigin(worldTargetForStep("PLACE_BIN",{binIndex:i}));
    const drawn={x:WORLD_WAYPOINTS.PLACE_BIN.x+offset.x,y:12,z:WORLD_WAYPOINTS.PLACE_BIN.z+offset.z};
    assert.ok(samePoint(actual,drawn));
    assert.ok(Math.abs(offset.x)<45);
  }
});
test("closed finger pads contact all four similarly sized marked carrier discs",()=>{
  for(const shape of ["circle","triangle","star","cross"]){
    const inner=fingerHalfGap(110,true)-FINGER_THICKNESS_MM/2;
    assert.ok(inner<ITEM_RADIUS_MM,"contact for "+shape);
    assert.ok(inner>ITEM_RADIUS_MM-3,"avoid deep interpenetration");
  }
  assert.ok(fingerHalfGap(75,false)-FINGER_THICKNESS_MM/2>ITEM_RADIUS_MM+5);
  assert.equal(fingerHalfGap(110,false),fingerHalfGap(110,true));
});
test("star is independent from the existing cross and can be used in commands",()=>{
  assert.equal(normalizeShape("별 모양"),"star");
  assert.equal(normalizeShape("star"),"star");
  assert.equal(shapeLabel("star"),"별");
  assert.equal(normalizeShape("십자"),"cross");
  assert.equal(parseLocalIntent("C칸의 별을 보관함으로 옮겨 줘").shape,"star");
});
test("camera settings enforce physical-plausible displayed ranges",()=>{
  assert.deepEqual(normalizeCameraConfig(),CAMERA_DEFAULT);
  assert.throws(()=>normalizeCameraConfig({heightMm:120}));
  assert.throws(()=>normalizeCameraConfig({fovDeg:130}));
  assert.throws(()=>normalizeCameraConfig({offsetXmm:500}));
  assert.equal(cameraPosition().y,550);
});
test("lens position is below the overhead housing and aimed at the worktop",()=>{
  const body=cameraPosition(),lens=cameraLensPosition();
  assert.ok(lens.y<body.y&&lens.y>100);
  assert.ok(lens.x<body.x&&lens.z>body.z);
});
test("mounted view has stable overhead screen orientation and a real optical frame",async()=>{
  const {readFile}=await import("node:fs/promises");
  const src=await readFile(new URL("../three-scene.js",import.meta.url),"utf8");
  assert.ok(src.includes("camera.up.set(1,0,0)"));
  assert.ok(src.includes("cameraAssembly.quaternion.setFromUnitVectors"));
  assert.ok(src.includes('addEventListener("pointerdown",cancelMiddleAutoscroll'));
});
test("default mounted camera estimated footprint includes A, B, C and bin",()=>{
  const quadrilateral=footprintCorners();
  assert.equal(quadrilateral.length,4);
  for(const p of [
    {x:240,z:-115},{x:267,z:0},{x:240,z:115},{x:310,z:170}
  ])assert.equal(contains(quadrilateral,p),true);
});
test("camera looking straight down does not produce invalid ground points",()=>{
  const corners=footprintCorners({...CAMERA_DEFAULT,offsetXmm:0,offsetZmm:0});
  assert.ok(corners.every(p=>Object.values(p).every(Number.isFinite)));
});
