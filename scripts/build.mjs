import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root=fileURLToPath(new URL("../",import.meta.url));
const dist=path.join(root,"dist");
const assets=["index.html","styles.css","app.js","protocol.js","kinematics.js","workplane.js","guided-setup.js"];

await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
for(const name of assets) await copyFile(path.join(root,name),path.join(dist,name));
console.log("Built static AIrobot assets ("+assets.length+" files) into dist/");
