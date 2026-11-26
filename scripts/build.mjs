import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root=fileURLToPath(new URL("../",import.meta.url));
const dist=path.join(root,"dist");
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
for(const file of ["index.html","styles.css"]){
  await copyFile(path.join(root,file),path.join(dist,file));
}
// Bundle Three.js and OrbitControls locally; deployed pages do not rely on
// a third-party CDN being reachable at classroom demonstration time.
await build({
  entryPoints:[path.join(root,"app.js")],
  outfile:path.join(dist,"app.js"),
  bundle:true,
  format:"esm",
  platform:"browser",
  target:["es2022"],
  minify:false,
  sourcemap:false,
  legalComments:"linked",
  logLevel:"info"
});
console.log("AIrobot static app built with the embedded interactive Three.js scene.");
