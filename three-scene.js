/**
 * Interactive 3D schematic of an EEZYbotARM Mk2 classroom workbench.
 *
 * This scene uses reference link dimensions (L1=92, L2=135, L3=147,
 * tool extension=87 mm), not a scanned STL or calibrated servo feedback.
 * It does not calculate collisions, torque or physical safety.
 *
 * Only the existing, independently approved Web Serial path actuates hardware.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MK2_REFERENCE } from "./kinematics.js";
import { WORLD_WAYPOINTS } from "./simulator-motion.js";
import {
 CAMERA_DEFAULT,CAMERA_TARGET,CAMERA_STAND,normalizeCameraConfig,cameraPosition,
 footprintCorners,gripObjectOrigin,fingerHalfGap,binItemOffset,ITEM_ORIGIN_BELOW_TIP_MM
} from "./camera-layout.js";

const COLORS={orange:0xe75d2a,orangeDark:0xb83c1a,ink:0x233e50,
  navy:0x2b5065,teal:0x0ba58b,mint:0xdff5ee,table:0xe8f0f3,
  metal:0xb7c9d1,white:0xffffff,amber:0xf0ac35};
const origin=new THREE.Vector3(0,0,0),up=new THREE.Vector3(0,1,0);
const radians=v=>v*Math.PI/180;
const toVec=p=>new THREE.Vector3(p.x,p.y,p.z);

function material(color,metalness=0.05,roughness=0.67){
  return new THREE.MeshStandardMaterial({color,metalness,roughness});
}
function mesh(geo,mat,parent){
  const result=new THREE.Mesh(geo,mat);
  result.castShadow=true;result.receiveShadow=true;
  parent.add(result);return result;
}
function block(parent,w,h,d,color,x,y,z){
  const m=mesh(new THREE.BoxGeometry(w,h,d),material(color),parent);
  m.position.set(x,y,z);return m;
}
function disk(parent,radius,height,color,x,y,z){
  const m=mesh(new THREE.CylinderGeometry(radius,radius,height,38),material(color),parent);
  m.position.set(x,y,z);return m;
}
function link(parent,radius,color){
  const m=mesh(new THREE.CylinderGeometry(1,1,1,16),material(color,0.08),parent);
  m.userData.radius=radius;return m;
}
function placeLink(m,a,b){
  const from=toVec(a),to=toVec(b),vec=to.clone().sub(from);
  const length=Math.max(vec.length(),0.001);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(up,vec.normalize());
  m.scale.set(m.userData.radius,length,m.userData.radius);
}
function textSprite(parent,text,color="#274859",scale=1){
  const canvas=document.createElement("canvas");canvas.width=512;canvas.height=128;
  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,512,128);
  ctx.fillStyle="#ffffff";ctx.beginPath();ctx.roundRect(7,8,498,111,24);ctx.fill();
  ctx.strokeStyle="#c8dbe0";ctx.lineWidth=4;ctx.stroke();
  ctx.fillStyle=color;ctx.font="bold 52px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.fillText(text,256,64);
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthWrite:false}));
  spr.scale.set(90*scale,23*scale,1);parent.add(spr);return spr;
}
function markerGeometry(shape) {
  const g=new THREE.Group();
  const dark=material(COLORS.ink),steel=material(0xe2e9ed,0.14);
  disk(g,18,19,COLORS.white,0,10,0);
  if(shape==="circle"){
    const tor=mesh(new THREE.TorusGeometry(10,3.8,8,30),dark,g);
    tor.rotation.x=-Math.PI/2;tor.position.set(0,21,0);
  }else if(shape==="triangle"){
    const s=new THREE.Shape();
    s.moveTo(0,12);s.lineTo(-12,-9);s.lineTo(12,-9);s.closePath();
    const top=mesh(new THREE.ShapeGeometry(s),dark,g);
    top.rotation.x=-Math.PI/2;top.position.y=20;
  }else if(shape==="star"){
    const star=new THREE.Shape();
    for(let i=0;i<10;i++){
      const angle=-Math.PI/2+i*Math.PI/5;
      const radius=i%2===0?14:6.5;
      const x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
      if(i===0)star.moveTo(x,y);else star.lineTo(x,y);
    }
    star.closePath();
    const top=mesh(new THREE.ShapeGeometry(star),dark,g);
    top.rotation.x=-Math.PI/2;top.position.y=21;
  }else if(shape==="cross"){
    block(g,6,2,25,COLORS.ink,0,21,0);
    block(g,25,2,6,COLORS.ink,0,21,0);
  }
  return g;
}
function armSolution(target,model=MK2_REFERENCE){
  // A visual two-link solution, not the mechanical servo motor frame or the
  // restricted EEZYbotARM inverse kinematics used for physical reach checks.
  const {L1,L2,L3,L4}=model;
  const horiz=Math.hypot(target.x,target.z),vertical=target.y-L1;
  const distal=L3+L4;
  const range=Math.hypot(horiz,vertical);
  const clipped=Math.min(L2+distal-0.05,Math.max(Math.abs(L2-distal)+0.05,range));
  const ratio=range===0?1:clipped/range;
  const r=horiz*ratio,h=vertical*ratio;
  const cosElbow=Math.max(-1,Math.min(1,(r*r+h*h-L2*L2-distal*distal)/(2*L2*distal)));
  // Elbow-up branch: the upper link stays above the tabletop when picking.
  const elbow=-Math.acos(cosElbow);
  const shoulder=Math.atan2(h,r)-Math.atan2(distal*Math.sin(elbow),L2+distal*Math.cos(elbow));
  const yaw=Math.atan2(target.z,target.x);
  return {yaw,shoulder,elbow,unreachable:Math.abs(range-clipped)>1};
}
export function visualJoints(angles,target){
  const L=MK2_REFERENCE;
  let yaw,shoulder,elbow,unreachable=false;
  if(target){
    ({yaw,shoulder,elbow,unreachable}=armSolution(target));
  }else{
    // Servo 90° is NOT a calibrated mechanical zero; these offsets are visual
    // illustrative mappings for the four manual slider angles only.
    yaw=radians((angles[0]-90)*0.48);
    shoulder=radians(48+(angles[1]-90)*0.65);
    elbow=radians(-84+(angles[2]-90)*0.70);
  }
  const a={x:0,y:L.L1,z:0};
  const direction=(length,angle)=>({
    x:Math.cos(yaw)*Math.cos(angle)*length,
    y:Math.sin(angle)*length,
    z:Math.sin(yaw)*Math.cos(angle)*length
  });
  const first=direction(L.L2,shoulder);
  const b={x:a.x+first.x,y:a.y+first.y,z:a.z+first.z};
  const second=direction(L.L3,shoulder+elbow);
  const c={x:b.x+second.x,y:b.y+second.y,z:b.z+second.z};
  const tool=direction(L.L4,shoulder+elbow);
  const tip={x:c.x+tool.x,y:c.y+tool.y,z:c.z+tool.z};
  return {a,b,c,tip,yaw,shoulder,elbow,unreachable};
}
export function create3DScene(host,{onWarning=()=>{}}={}){
  if(!host)throw new Error("3D 표시 영역을 찾을 수 없습니다.");
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:"default"});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xeaf3f6);
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-label","3차원 로봇팔. 왼쪽 또는 가운데 버튼 드래그로 회전하고, 휠 스크롤로 확대하고, 오른쪽 버튼 드래그로 이동합니다.");

  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0xeaf3f6);
  scene.fog=new THREE.Fog(0xeaf3f6,820,1350);
  const camera=new THREE.PerspectiveCamera(42,1,1,2200);
  const defaultCamera=new THREE.Vector3(660,525,700),focus=new THREE.Vector3(180,65,18);
  camera.position.copy(defaultCamera);camera.lookAt(focus);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.target.copy(focus);controls.enableDamping=true;controls.dampingFactor=0.07;
  // Middle button drag rotates instead of invoking OrbitControls' usual dolly.
  // Wheel scroll (without clicking) continues to zoom.
  controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.ROTATE,RIGHT:THREE.MOUSE.PAN};
  const cancelMiddleAutoscroll=e=>{if(e.button===1)e.preventDefault();};
  renderer.domElement.addEventListener("mousedown",cancelMiddleAutoscroll);
  renderer.domElement.addEventListener("auxclick",cancelMiddleAutoscroll);
  controls.minDistance=230;controls.maxDistance=1220;
  controls.maxPolarAngle=Math.PI/2-0.04;
  controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff,0x8ca7b4,2.35));
  const key=new THREE.DirectionalLight(0xffffff,3.0);
  key.position.set(125,540,230);key.castShadow=true;
  key.shadow.mapSize.set(1024,1024);
  key.shadow.camera.left=-560;key.shadow.camera.right=560;
  key.shadow.camera.top=560;key.shadow.camera.bottom=-560;
  scene.add(key);

  // Worktable and named compartments (world coordinates in mm, conceptual).
  block(scene,640,16,470,COLORS.table,195,-11,35);
  block(scene,650,8,480,COLORS.metal,195,-22,35);
  const grid=new THREE.GridHelper(580,20,0xb8cdd4,0xd4e2e8);
  grid.position.set(195,-2,36);scene.add(grid);
  const floorOutline=block(scene,585,3,425,COLORS.amber,200,0,38);
  const inner=block(scene,577,3.6,417,COLORS.table,200,2,38);
  floorOutline.castShadow=false;inner.castShadow=false;
  const positions={A:{x:240,y:2,z:-115},B:{x:267,y:2,z:0},C:{x:240,y:2,z:115}};
  const slotObjects={};
  for(const slot of ["A","B","C"]){
    const p=positions[slot];
    const pad=block(scene,75,4,75,slot==="B"?0xd5f4e9:0xffffff,p.x,5,p.z);
    pad.material=material(slot==="B"?0xdff7ed:0xffffff);
    const border=block(scene,80,2,80,slot==="B"?COLORS.teal:COLORS.metal,p.x,3,p.z);
    border.castShadow=false;
    pad.position.y=6;
    const label=textSprite(scene,slot,"#0a4b5c",0.6);
    label.position.set(p.x,60,p.z);
    const objectHolder=new THREE.Group();objectHolder.position.set(p.x,9,p.z);
    scene.add(objectHolder);slotObjects[slot]=objectHolder;
  }
  const binPosition={x:310,y:0,z:170};
  const binGroup=new THREE.Group();
  binGroup.position.set(binPosition.x,0,binPosition.z);
  scene.add(binGroup);
  block(binGroup,104,8,82,COLORS.ink,0,8,0);
  block(binGroup,106,54,6,COLORS.navy,0,31,-40);
  block(binGroup,106,54,6,COLORS.navy,0,31,40);
  block(binGroup,6,54,82,COLORS.navy,-51,31,0);
  block(binGroup,6,54,82,COLORS.navy,51,31,0);
  const binTitle=textSprite(scene,"보관함","#163f59",0.85);
  binTitle.position.set(binPosition.x,98,binPosition.z);
  const binItemsGroup=new THREE.Group();binItemsGroup.position.set(binPosition.x,12,binPosition.z);
  scene.add(binItemsGroup);

  // Independent overhead workbench camera, not mounted on moving robot links.
  // All dimensions and the field of view are adjustable *illustrations*.
  const cameraRig=new THREE.Group();scene.add(cameraRig);
  const cameraPost=link(cameraRig,5,COLORS.metal);
  const cameraBoom=link(cameraRig,4.8,COLORS.metal);
  const standBase=disk(cameraRig,27,8,COLORS.ink,
    CAMERA_STAND.x,4,CAMERA_STAND.z);
  const cameraHousing=block(cameraRig,43,23,31,COLORS.ink,0,0,0);
  const cameraLens=disk(cameraRig,12,8,0x273747,0,0,0);
  const cameraGlass=disk(cameraRig,7,1,COLORS.teal,0,0,0);
  const cameraLabel=textSprite(cameraRig,"작업대 카메라","#164a63",0.95);
  const footprintLines=new THREE.Group();scene.add(footprintLines);
  let mountedConfig={...CAMERA_DEFAULT},isMountedCameraView=false;

  function disposeLines(group){
    for(const child of [...group.children]){
      group.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
  }
  function segmentLine(a,b,color,opacity=0.9){
    const geo=new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x,a.y,a.z),
      new THREE.Vector3(b.x,b.y,b.z)
    ]);
    const line=new THREE.Line(geo,
      new THREE.LineBasicMaterial({color,transparent:true,opacity,depthTest:false}));
    footprintLines.add(line);
  }
  function updateCameraMount(next=mountedConfig){
    mountedConfig=normalizeCameraConfig(next);
    const pos=cameraPosition(mountedConfig);
    placeLink(cameraPost,
      {x:CAMERA_STAND.x,y:10,z:CAMERA_STAND.z},
      {x:CAMERA_STAND.x,y:mountedConfig.heightMm+26,z:CAMERA_STAND.z});
    placeLink(cameraBoom,
      {x:CAMERA_STAND.x,y:mountedConfig.heightMm+26,z:CAMERA_STAND.z},
      {x:pos.x,y:mountedConfig.heightMm+26,z:pos.z});
    cameraHousing.position.set(pos.x,pos.y,pos.z);
    cameraLens.position.set(pos.x,pos.y-15,pos.z);
    cameraGlass.position.set(pos.x,pos.y-20,pos.z);
    cameraLabel.position.set(pos.x,pos.y+36,pos.z);
    disposeLines(footprintLines);
    if(mountedConfig.showFootprint){
      const corners=footprintCorners(mountedConfig,16/9);
      for(let i=0;i<4;i++){
        segmentLine(pos,corners[i],COLORS.teal,0.42);
        segmentLine(corners[i],corners[(i+1)%4],COLORS.teal,0.88);
      }
    }
    if(isMountedCameraView)viewFromMountedCamera();
    return {position:pos,footprint:mountedConfig.showFootprint?
      footprintCorners(mountedConfig,16/9):null};
  }
  function viewFromMountedCamera(){
    isMountedCameraView=true;
    const pos=cameraPosition(mountedConfig);
    controls.enabled=false;
    cameraRig.visible=false;
    footprintLines.visible=false;
    camera.position.set(pos.x,pos.y-24,pos.z);
    camera.fov=mountedConfig.fovDeg;
    camera.updateProjectionMatrix();
    camera.lookAt(CAMERA_TARGET.x,0,CAMERA_TARGET.z);
  }
  // EEZYbotARM Mk2-inspired articulated skeleton with reference link lengths.
  disk(scene,61,12,COLORS.ink,0,0,0);
  disk(scene,44,15,COLORS.orangeDark,0,12,0);
  disk(scene,34,22,COLORS.orange,0,28,0);
  block(scene,53,53,58,COLORS.orange,0,63,0);
  const yawRing=disk(scene,29,10,COLORS.ink,0,88,0);
  const first=link(scene,11,COLORS.orange);
  const second=link(scene,9,COLORS.orange);
  const narrowBar=link(scene,3.7,COLORS.orangeDark);
  const tool=link(scene,6,COLORS.orangeDark);
  const shoulderJoint=disk(scene,18,14,COLORS.ink,0,92,0);
  shoulderJoint.rotation.x=Math.PI/2;
  const elbowJoint=disk(scene,16,14,COLORS.ink,0,92,0);
  elbowJoint.rotation.x=Math.PI/2;
  const toolJoint=disk(scene,11,11,COLORS.ink,0,92,0);
  toolJoint.rotation.x=Math.PI/2;
  const tipGroup=new THREE.Group();scene.add(tipGroup);
  const palm=block(tipGroup,29,15,24,COLORS.orange,0,5,0);
  const leftFinger=block(tipGroup,10,30,9,COLORS.orangeDark,0,-12,-15);
  const rightFinger=block(tipGroup,10,30,9,COLORS.orangeDark,0,-12,15);
  // The carried object's center is attached in the GRIPPER LOCAL FRAME:
  // it can no longer drift sideways when the base yaw changes.
  const carried=new THREE.Group();
  tipGroup.add(carried);
  carried.position.set(0,-ITEM_ORIGIN_BELOW_TIP_MM,0);
  let currentAngles=[90,90,90,90],currentTip=null;
  let currentObservation={},inventory=[],hiddenBinIndex=null,carriedShape=null;
  let hiddenSlot=null,previewSlot=null,previewBin=null;

  function setGroupSymbol(holder,shape){
    holder.clear();
    if(shape)holder.add(markerGeometry(shape));
  }
  function refreshObjects(){
    for(const slot of ["A","B","C"]){
      setGroupSymbol(slotObjects[slot],
        previewSlot?.slot===slot?previewSlot.shape:
        hiddenSlot===slot?null:currentObservation[slot]||null);
    }
    binItemsGroup.clear();
    inventory.forEach((item,i)=>{
      if(i===hiddenBinIndex||!item?.shape)return;
      const ob=markerGeometry(item.shape);
      const offset=binItemOffset(i);
      ob.position.set(offset.x,offset.y,offset.z);
      ob.scale.setScalar(0.7);binItemsGroup.add(ob);
    });
    if(previewBin?.shape){
      const obj=markerGeometry(previewBin.shape),offset=binItemOffset(previewBin.index);
      obj.position.set(offset.x,offset.y,offset.z);
      obj.scale.setScalar(0.88);
      binItemsGroup.add(obj);
    }
    setGroupSymbol(carried,carriedShape);
  }
  function updateArm(){
    const {a,b,c,tip,yaw,unreachable}=visualJoints(currentAngles,currentTip);
    placeLink(first,a,b);
    placeLink(second,b,c);
    placeLink(narrowBar,
      {x:a.x+8*Math.cos(yaw+Math.PI/2),y:a.y,z:a.z+8*Math.sin(yaw+Math.PI/2)},
      {x:b.x+8*Math.cos(yaw+Math.PI/2),y:b.y,z:b.z+8*Math.sin(yaw+Math.PI/2)});
    placeLink(tool,c,tip);
    yawRing.rotation.y=yaw;
    shoulderJoint.position.set(a.x,a.y,a.z);
    elbowJoint.position.set(b.x,b.y,b.z);
    toolJoint.position.set(c.x,c.y,c.z);
    tipGroup.position.set(tip.x,tip.y,tip.z);
    tipGroup.rotation.y=-yaw;
    const opening=fingerHalfGap(currentAngles[3],Boolean(carriedShape));
    leftFinger.position.z=-opening;
    rightFinger.position.z=opening;
    carried.position.set(0,-ITEM_ORIGIN_BELOW_TIP_MM,0);
    carried.scale.setScalar(1);
    if(unreachable)onWarning("3D 시각화의 도달범위를 벗어난 목표입니다. 실물 동작의 가능 여부가 아닙니다.");
  }
  function update({angles,target,observations,transferred,hiddenIndex,carrying,hiddenSource,previewAtSlot,previewInBin}={}){
    if(angles)currentAngles=[...angles];
    if(target!==undefined)currentTip=target?{...target}:null;
    if(observations)currentObservation={...observations};
    if(transferred)inventory=transferred.map(x=>({...x}));
    if(hiddenIndex!==undefined)hiddenBinIndex=hiddenIndex;
    if(carrying!==undefined)carriedShape=carrying;
    if(hiddenSource!==undefined)hiddenSlot=hiddenSource;
    if(previewAtSlot!==undefined)previewSlot=previewAtSlot;
    if(previewInBin!==undefined)previewBin=previewInBin;
    updateArm();
    if(observations!==undefined||transferred!==undefined||hiddenIndex!==undefined||
       carrying!==undefined||hiddenSource!==undefined||previewAtSlot!==undefined||previewInBin!==undefined)
       refreshObjects();
  }
  function resize(){
    const width=Math.max(320,host.clientWidth);
    const height=Math.max(270,host.clientHeight);
    camera.aspect=width/height;camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
  }
  function resetCamera(){
    isMountedCameraView=false;cameraRig.visible=true;
    footprintLines.visible=true;controls.enabled=true;
    camera.fov=42;camera.updateProjectionMatrix();
    camera.position.copy(defaultCamera);controls.target.copy(focus);controls.update();
  }
  let disposed=false,raf=0;
  function frame(){
    if(disposed)return;
    raf=requestAnimationFrame(frame);
    if(!host.hidden){
      controls.update();renderer.render(scene,camera);
    }
  }
  const observer=new ResizeObserver(resize);
  observer.observe(host);
  updateCameraMount(mountedConfig);
  resize();update({angles:currentAngles,observations:{A:"circle",B:"triangle",C:"cross"},transferred:[]});
  frame();
  return {
    update,resetCamera,resize,updateCameraMount,viewFromMountedCamera,
    dispose(){
      disposed=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();
      renderer.domElement.removeEventListener("mousedown",cancelMiddleAutoscroll);
      renderer.domElement.removeEventListener("auxclick",cancelMiddleAutoscroll);
      scene.traverse(o=>{
        if(o.geometry)o.geometry.dispose();
        const mats=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];
        for(const m of mats){if(m.map)m.map.dispose();m.dispose();}
      });
      disposeLines(footprintLines);
      renderer.dispose();renderer.domElement.remove();
    }
  };
}
