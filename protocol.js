// Shared, dependency-free safety and command parsing helpers.
// Human approval and firmware checks are STILL required for physical movement.
export const AXES = ["base", "shoulder", "elbow", "grip"];
export const SHAPES = ["circle", "triangle", "cross", "star"];
export const SLOTS = ["A", "B", "C"];
export const POSE_NAMES = ["HOME", "HOVER_A", "PICK_A", "HOVER_B", "PICK_B", "HOVER_C", "PICK_C", "HOVER_BIN", "PLACE_BIN"];
export const DEFAULT_ANGLES = Object.freeze([90, 90, 90, 90]);

export function validAngles(angles) {
  return Array.isArray(angles) && angles.length === 4 &&
    angles.every(v => Number.isInteger(v) && v >= 0 && v <= 180);
}

export function axisLine(index, degree) {
  if(!Number.isInteger(index)||index<0||index>3||!Number.isInteger(degree)||degree<0||degree>180)
    throw new Error("축 번호(0~3) 또는 각도(0~180)가 잘못되었습니다.");
  return "AXIS,"+index+","+degree+"\n";
}

export function poseLine(angles) {
  if (!validAngles(angles)) throw new Error("각 관절은 0~180 사이의 정수여야 합니다.");
  return "POSE," + angles.join(",") + "\n";
}

export function normalizeShape(text) {
  const t = String(text || "").toLowerCase();
  if (/(삼각형|세모|triangle)/.test(t)) return "triangle";
  if (/(원형|동그라미|circle|원(?:을|이|은|의|으로|에서|[\s,.!?]|$))/.test(t)) return "circle";
  if (/(십자|더하기|cross)/.test(t)) return "cross";
  if (/(별\s*모양|오각별|별표|star)/.test(t)) return "star";
  return null;
}

export function shapeLabel(shape) {
  return ({ circle: "원", triangle: "삼각형", cross: "십자", star: "별" })[shape] || "?";
}

export function parseLocalIntent(text) {
  const raw=String(text||"").trim().slice(0,240);
  const shape=normalizeShape(raw);
  const slotMatch=raw.match(/([ABC])\s*(?:칸|자리)/i);
  const slot=slotMatch?slotMatch[1].toUpperCase():null;
  const bin=/(보관함|수거함|바구니|상자|bin)/i.test(raw);
  const isFromBin=/(보관함|수거함|바구니|상자|bin)\s*(?:에서|으로부터|부터)/i.test(raw);
  const returning=/(원래|제자리|되돌|돌려|꺼내|반납|복귀|return|restore)/i.test(raw);
  const hasAction=/(옮겨|넣어|집어|집어서|이동|가져|놓아|놔|꺼내|돌려|반납|복귀|move|pick|place|return|restore)/i.test(raw);
  if(hasAction && (isFromBin||returning)) {
    const target=slot||( /(원래|제자리|되돌|돌려|복귀|return|restore)/i.test(raw) ? "ORIGINAL" : null);
    if(target && (shape || slot || target==="ORIGINAL")) {
      return {kind:"return_place",shape,source:"BIN",target,
        explanation:"규칙 기반 반환 명령입니다. 실제 LLM 판단은 아닙니다."};
    }
    return {kind:"unclear",explanation:"보관함에서 어느 칸으로 옮길지 말씀해 주세요. 예: ‘보관함에서 삼각형을 원래 자리로 돌려놔.’"};
  }
  if(hasAction && bin && (shape||slot)) {
    return {kind:"pick_place",shape,source:slot,target:"BIN",
      explanation:"규칙 기반 이동 명령입니다. 실제 LLM 판단은 아닙니다."};
  }
  return {kind:"unclear",explanation:"작업 대상과 목적지가 불분명합니다. 예: ‘B칸 삼각형을 보관함에 넣어 줘.’"};
}

export function normalizeIntent(raw) {
  const obj=raw&&typeof raw==="object"?raw:{};
  const shape=SHAPES.includes(obj.shape)?obj.shape:null;
  if(obj.kind==="return_place") {
    const target=SLOTS.includes(obj.target)?obj.target:(obj.target==="ORIGINAL"?"ORIGINAL":null);
    if(obj.source!=="BIN" || !target)
      return {kind:"unclear",explanation:"반환 명령의 출발지는 보관함, 도착지는 A·B·C 또는 원래 자리여야 합니다."};
    return {kind:"return_place",shape,source:"BIN",target,
      explanation:String(obj.explanation||"보관함에서 반환할 대상과 목적지를 확인해 주세요.").slice(0,150)};
  }
  if(obj.kind!=="pick_place")
    return {kind:"unclear",explanation:String(obj.explanation||"실행할 수 없는 명령입니다.").slice(0,150)};
  const source=SLOTS.includes(obj.source)?obj.source:null;
  if(obj.target!=="BIN"||(!shape&&!source))
    return {kind:"unclear",explanation:"보관함으로 옮길 대상이나 출발 위치가 불명확합니다."};
  return {kind:"pick_place",shape,source,target:"BIN",
    explanation:String(obj.explanation||"대상과 목적지를 확인해 주세요.").slice(0,150)};
}

/**
 * Only tracked, previously placed bin items may be returned.
 * No guessing an item if more than one matches the request.
 */
export function resolveBinReturn(intent,inventory,observations) {
  const normalized=normalizeIntent(intent);
  if(normalized.kind!=="return_place")throw new Error(normalized.explanation);
  if(!Array.isArray(inventory)||!inventory.length)throw new Error("보관함에 반환할 물체가 없습니다.");
  const matches=inventory.map((record,index)=>({record,index})).filter(({record})=>
    record&&SHAPES.includes(record.shape)&&SLOTS.includes(record.origin)&&
    (!normalized.shape||record.shape===normalized.shape)&&
    (normalized.target==="ORIGINAL" || !normalized.shape ? 
      (normalized.target==="ORIGINAL" || record.origin===normalized.target) : true)
  );
  if(matches.length!==1)throw new Error(matches.length===0?
    "보관함에서 조건에 맞는 물체를 찾을 수 없습니다. 물체 종류·원래 칸을 확인해 주세요.":
    "보관함에 가능한 물체가 여러 개입니다. 도형 이름과 원래 칸을 함께 지정해 주세요.");
  const {record,index}=matches[0];
  const slot=normalized.target==="ORIGINAL"?record.origin:normalized.target;
  if(observations[slot])throw new Error(slot+"칸에 이미 물체가 있습니다. 비운 후 다시 요청해 주세요.");
  return {index,shape:record.shape,origin:record.origin,destination:slot};
}

export function findSource(intent, observations) {
  const item = normalizeIntent(intent);
  if (item.kind !== "pick_place") throw new Error(item.explanation);
  if (item.source) {
    if (item.shape && observations[item.source] !== item.shape) {
      throw new Error(item.source + "칸의 표식이 지시한 물체와 일치하는지 확인해 주세요.");
    }
    return item.source;
  }
  const matches = SLOTS.filter(slot => observations[slot] === item.shape);
  if (matches.length !== 1) throw new Error("표식이 하나의 칸으로 확정되지 않았습니다. 사진 인식 또는 현장 확인이 필요합니다.");
  return matches[0];
}

export function buildPickSequence(source, poses, openGrip, closeGrip) {
  if (!SLOTS.includes(source)) throw new Error("A·B·C만 출발 위치로 사용할 수 있습니다.");
  const names = ["HOVER_" + source, "PICK_" + source, "PICK_" + source,
    "HOVER_" + source, "HOVER_BIN", "PLACE_BIN", "PLACE_BIN", "HOVER_BIN", "HOME"];
  const grips = [openGrip, openGrip, closeGrip, closeGrip, closeGrip,
    closeGrip, openGrip, openGrip, openGrip];
  if (![openGrip, closeGrip].every(v => Number.isInteger(v) && v >= 0 && v <= 180)) {
    throw new Error("집게 열림·닫힘 각도를 먼저 보정해 주세요.");
  }
  return names.map((name, i) => {
    const angles = poses[name];
    if (!validAngles(angles)) throw new Error(name + " 위치가 미보정 상태입니다. 실물 자동 집기를 금지합니다.");
    return { label: name + (i === 2 ? " (잡기)" : i === 6 ? " (놓기)" : ""),
      angles: [angles[0], angles[1], angles[2], grips[i]] };
  });
}

export function buildReturnSequence(destination,poses,openGrip,closeGrip) {
  if(!SLOTS.includes(destination))throw new Error("반환할 위치는 A·B·C 중 하나여야 합니다.");
  const names=["HOVER_BIN","PLACE_BIN","PLACE_BIN","HOVER_BIN",
    "HOVER_"+destination,"PICK_"+destination,"PICK_"+destination,
    "HOVER_"+destination,"HOME"];
  const grips=[openGrip,openGrip,closeGrip,closeGrip,closeGrip,
    closeGrip,openGrip,openGrip,openGrip];
  if(![openGrip,closeGrip].every(v=>Number.isInteger(v)&&v>=0&&v<=180))
    throw new Error("집게의 열림·닫힘 각도를 확인해 주세요.");
  return names.map((name,i)=>{
    const angles=poses[name];
    if(!validAngles(angles))throw new Error(name+" 보정이 없습니다. 실물 반환을 실행할 수 없습니다.");
    return {label:name+(i===2?" (잡기)":i===6?" (놓기)":""),angles:[...angles.slice(0,3),grips[i]]};
  });
}

export function messageLine(line) {
  const m = String(line || "").trim();
  if (/^READY\b/.test(m)) return { type: "READY", text: m };
  if (/^ACK\b/.test(m)) return { type: "ACK", text: m };
  if (/^DONE\b/.test(m)) return { type: "DONE", text: m };
  if (/^ARMED\b/.test(m)) return { type: "ARMED", text: m };
  if (/^DISARMED\b/.test(m)) return { type: "DISARMED", text: m };
  if (/^STOPPED\b/.test(m)) return { type: "STOPPED", text: m };
  if (/^PONG\b/.test(m)) return { type: "PONG", text: m };
  if (/^ERR\b/.test(m)) return { type: "ERR", text: m };
  return { type: "INFO", text: m };
}

export function serialWhitelist(line) {
  return /^(HELLO|PING|ARM|DISARM|STOP|STATUS)\n$/.test(line) ||
    /^POSE,(?:0|[1-9]\d?|1[0-7]\d|180),(?:0|[1-9]\d?|1[0-7]\d|180),(?:0|[1-9]\d?|1[0-7]\d|180),(?:0|[1-9]\d?|1[0-7]\d|180)\n$/.test(line) ||
    /^AXIS,[0-3],(?:0|[1-9]\d?|1[0-7]\d|180)\n$/.test(line);
}