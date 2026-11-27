import test from 'node:test';
import assert from 'node:assert/strict';
import {inverse,forward} from '../kinematics.js';
import {shapeWidth,shapeVertices} from '../student-math.js';
import {footprintCorners,cameraLensPosition,WORK_SURFACE} from '../camera-layout.js';
test('preset paths all reachable with 30 samples per segment',()=>{
 for (let z of [-85,0,85]){
 const pts=[[250,160,z],[250,124,z],[250,160,z],[320,160,0],[320,136,0],[320,160,0]];
 for(let i=1;i<pts.length;i++)for(let k=0;k<=30;k++){
 let [x,y,z]=pts[i-1].map((a,j)=>a+(pts[i][j]-a)*k/30);
 let q=inverse(x,z,y);assert.equal(q.reachable,true,JSON.stringify([x,y,z,q]));
 let p=forward(...q.joint);assert.ok(Math.hypot(p.x-x,p.y-z,p.z-y)<1e-6);
 }
 }
});
test('legacy A slot violates nominal azimuth',()=>assert.equal(inverse(190,-115,39).reachable,false));
test('object shape orientation changes projected width',()=>{
 assert.equal(shapeWidth('circle',36,36,0,0),36);
 assert.equal(shapeWidth('circle',36,36,45,0),36);
 assert.ok(Math.abs(shapeWidth('triangle',36,36,45,0)-shapeWidth('triangle',36,36,0,0))>1);
 for(const k of ['circle','triangle','cross','star']){let p=shapeVertices(k,40,30);assert.ok(Math.abs(Math.max(...p.map(a=>a[0]))-Math.min(...p.map(a=>a[0]))-40)<1e-8);}
});
test('higher board shrinks footprint using actual lens',()=>{let c={heightMm:500,offsetXmm:0,offsetZmm:0,fovDeg:42,showFootprint:true};let lens=cameraLensPosition(c);let p=footprintCorners(c);let t=(lens.y-90)/(lens.y-WORK_SURFACE.y);assert.ok(t>0&&t<1);assert.ok((Math.max(...p.map(a=>a.x))-Math.min(...p.map(a=>a.x)))*t>110);});
