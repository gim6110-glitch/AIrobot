import test from "node:test";
import assert from "node:assert/strict";
import {
 CAMERA_DEFAULT,normalizeCameraConfig,cameraPosition,cameraLensPosition,cameraAxes,
 WORK_SURFACE,SLOT_CENTERS,SLOT_SIZE_MM,BIN_CENTER,BIN_SIZE_MM,
 cameraFitAssessment,CAMERA_ASPECT,footprintCorners,
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
  const centers=Object.fromEntries(Object.entries(SLOT_CENTERS).map(([k,p])=>[k,{...p,y:9}]));
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
    assert.ok(Math.abs(offset.x)<BIN_SIZE_MM.widthX/2);
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
  assert.equal(cameraPosition().y,340);
});
test("lens position is below the overhead housing and aimed at the worktop",()=>{
  const body=cameraPosition(),lens=cameraLensPosition();
  assert.ok(lens.y<body.y&&lens.y>100);
  assert.ok(almost(lens.x,body.x)&&almost(lens.z,body.z));
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
  for(const p of [...Object.values(SLOT_CENTERS),BIN_CENTER])assert.equal(contains(quadrilateral,p),true);
});
test("camera looking straight down does not produce invalid ground points",()=>{
  const corners=footprintCorners({...CAMERA_DEFAULT,offsetXmm:0,offsetZmm:0});
  assert.ok(corners.every(p=>Object.values(p).every(Number.isFinite)));
});

test("default camera axes agree with real 16:9 preview orientation",()=>{
  const axes=cameraAxes();
  assert.deepEqual(axes.forward,[0,-1,0]);
  assert.deepEqual(axes.right,[0,0,1]);
  assert.deepEqual(axes.up,[1,0,0]);
  const q=footprintCorners();
  assert.ok(q[1].z>q[0].z);
  assert.ok(q[2].x>q[1].x);
  const zSpan=Math.max(...q.map(p=>p.z))-Math.min(...q.map(p=>p.z));
  const xSpan=Math.max(...q.map(p=>p.x))-Math.min(...q.map(p=>p.x));
  assert.ok(Math.abs(zSpan/xSpan-CAMERA_ASPECT)<1e-8);
});
test("gold workplate and default camera optical footprint are the same size",()=>{
  const fit=cameraFitAssessment();
  assert.equal(fit.boardCovered,true);
  assert.equal(fit.objectsCovered,true);
  assert.equal(fit.aligned,true);
  assert.ok(fit.areaRatio>=1&&fit.areaRatio<=1.08);
  const q=footprintCorners();
  for(const p of [
    {x:WORK_SURFACE.x-WORK_SURFACE.widthX/2,z:WORK_SURFACE.z-WORK_SURFACE.depthZ/2},
    {x:WORK_SURFACE.x+WORK_SURFACE.widthX/2,z:WORK_SURFACE.z+WORK_SURFACE.depthZ/2}
  ])assert.equal(contains(q,p),true);
  assert.equal(cameraFitAssessment({heightMm:550,fovDeg:65}).aligned,false);
  assert.equal(cameraFitAssessment({offsetZmm:150}).aligned,false);
});
test("C station and bin are disjoint with at least 20 mm side clearance",()=>{
  const c=SLOT_CENTERS.C;
  const gap=(BIN_CENTER.x-BIN_SIZE_MM.widthX/2)-(c.x+SLOT_SIZE_MM/2);
  assert.ok(gap>=20,"bin must not overlap the C/star pad");
  assert.ok(BIN_CENTER.z-BIN_SIZE_MM.depthZ/2<c.z+SLOT_SIZE_MM/2,
    "the side clearance test covers overlapping Z bands");
  assert.ok(SLOT_CENTERS.B.z+SLOT_SIZE_MM/2<=c.z-SLOT_SIZE_MM/2-15);
});
test("three bin carriers fit inside walls and never overlap each other",()=>{
  const offsets=[0,1,2].map(binItemOffset);
  for(const p of offsets){
    assert.ok(Math.abs(p.x)+ITEM_RADIUS_MM<BIN_SIZE_MM.widthX/2-BIN_SIZE_MM.wall);
    assert.ok(Math.abs(p.z)+ITEM_RADIUS_MM<BIN_SIZE_MM.depthZ/2-BIN_SIZE_MM.wall);
  }
  for(let i=0;i<offsets.length;i++)for(let j=i+1;j<offsets.length;j++){
    const gap=Math.hypot(offsets[i].x-offsets[j].x,offsets[i].z-offsets[j].z);
    assert.ok(gap>ITEM_RADIUS_MM*(1+0.7),"carried marker must clear existing 0.7-scale marker");
  }
});
test("mounted camera uses a letterboxed 16:9 optical viewport",async()=>{
  const {readFile}=await import("node:fs/promises");
  const src=await readFile(new URL("../three-scene.js",import.meta.url),"utf8");
  assert.ok(src.includes("camera.aspect=isMountedCameraView?CAMERA_ASPECT"));
  assert.ok(src.includes("renderer.setScissor(x,y,width,height)"));
  assert.ok(src.includes("segmentLine(cameraLensPosition(mountedConfig),corners[i]"));
});
