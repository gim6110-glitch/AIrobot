import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/intent.js";

function fakeRes(){
  const result={code:200,headers:{},body:null};
  return {
    result,
    setHeader(key,value){result.headers[key]=value;return this;},
    status(code){result.code=code;return this;},
    json(body){result.body=body;return this;}
  };
}
test("Vercel AI endpoint rejects GET requests",async()=>{
  const res=fakeRes();
  await handler({method:"GET",headers:{}},res);
  assert.equal(res.result.code,405);
});
test("Vercel AI endpoint rejects long or invalid instructions",async()=>{
  for(const body of [{text:""}, {text:"가".repeat(241)}]){
    const res=fakeRes();
    await handler({method:"POST",headers:{"content-length":String(JSON.stringify(body).length)},body},res);
    assert.ok([400,413].includes(res.result.code));
  }
});
test("No LLM API secret returns explicit unconfigured response",async()=>{
  const key=process.env.LLM_API_KEY, model=process.env.LLM_MODEL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
  try{
    const res=fakeRes();
    await handler({method:"POST",headers:{"content-length":"38"},body:{text:"삼각형을 보관함에 넣어 줘"}},res);
    assert.equal(res.result.code,503);
    assert.equal(res.result.body.configured,false);
    assert.ok(res.result.headers["Cache-Control"]==="no-store");
  }finally{
    if(key!==undefined)process.env.LLM_API_KEY=key;
    if(model!==undefined)process.env.LLM_MODEL=model;
  }
});
