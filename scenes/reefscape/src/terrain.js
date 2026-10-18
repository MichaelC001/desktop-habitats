import * as THREE from 'three';
import { merge, ellipsoid, tint } from './geometry.js';
import { randomGenerator, groundHeight } from './math.js';
import { underwater, extinctionGLSL, causticGLSL, inscatterGLSL, surfaceGLSL, EXTINCTION, BEYOND, SURFACE, waterTime, causticMap } from './water.js';
import { ROCKS, HOST, STATIONS, TANK } from './layout.js';
export {ROCKS,HOST,STATIONS};
let surfaceField=null,surfaceW=0,surfaceH=0;
export function supportHeight(x,z){
  if(surfaceField){const u=Math.max(0,Math.min(surfaceW-1,(x+9.65)/19.3*(surfaceW-1))),v=Math.max(0,Math.min(surfaceH-1,(z+4.1)/10.2*(surfaceH-1))),ix=Math.min(surfaceW-2,Math.floor(u)),iz=Math.min(surfaceH-2,Math.floor(v)),tx=u-ix,tz=v-iz;
    return (surfaceField[iz*surfaceW+ix]*(1-tx)+surfaceField[iz*surfaceW+ix+1]*tx)*(1-tz)+(surfaceField[(iz+1)*surfaceW+ix]*(1-tx)+surfaceField[(iz+1)*surfaceW+ix+1]*tx)*tz;}
  let y=groundHeight(x,z);for(const r of ROCKS){const q=((x-r[0])/r[3])**2+((z-r[2])/r[5])**2;if(q<1)y=Math.max(y,r[1]+r[4]*Math.sqrt(1-q)*.95);}return y;}

async function liveRockGeometry(){
  const response=await fetch(new URL('../assets/live-rock.bin',import.meta.url));if(!response.ok&&response.status!==0)throw new Error('Unable to load live-rock geometry.');
  const support=await fetch(new URL('../assets/rock-support.bin',import.meta.url));if(!support.ok&&support.status!==0)throw new Error('Unable to load attachment field.');
  const sb=await support.arrayBuffer(),sh=new Uint32Array(sb,0,2);surfaceW=sh[0];surfaceH=sh[1];surfaceField=new Float32Array(sb,8,surfaceW*surfaceH);
  const buffer=await response.arrayBuffer(),head=new Uint32Array(buffer,0,4),N=head[2],I=head[3];
  if(head[0]!==0x52454546||head[1]!==1||buffer.byteLength<16+N*27+I*4)throw new Error('Invalid live-rock asset.');
  const geo=new THREE.BufferGeometry();let offset=16;
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buffer,offset,N*3),3));offset+=N*12;
  geo.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(buffer,offset,N*3),3));offset+=N*12;
  geo.setAttribute('surface',new THREE.BufferAttribute(new Uint8Array(buffer,offset,N*3),3,true));offset=Math.ceil((offset+N*3)/4)*4;
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,offset,I),1));geo.computeBoundingSphere();return geo;
}
export async function createTerrain(scene){
  const rng=randomGenerator(952),loader=new THREE.TextureLoader();
  const [rockGeo,sandMap,crustMap,reliefMap]=await Promise.all([liveRockGeometry(),
    ...['aragonite.png','live-rock-surface.png','live-rock-normal.png'].map(name=>loader.loadAsync(new URL('../assets/'+name,import.meta.url).href))]);
  for(const t of [sandMap,crustMap,reliefMap]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;}
  // Aragonite under a reef lamp is a warm off-white, not paper: cream grains among greyer
  // and pinkish ones, a few dark mineral grains, and flat shell fragments that catch the
  // light. Grain size wanders over the bed, coarse rubble-sand in drifts and fine sugar
  // between, and slow drifts break up the sheet at the wide view. A warped ripple field
  // lays the soft marks the pumps leave, which the bed mesh is far too coarse to carry.
  // Troughs hold a little fine detritus, so they read a shade darker.
  const sandMat=underwater(new THREE.MeshStandardMaterial({roughness:.92,map:sandMap}),{key:'tank-sand',
    vertex:'attribute float shade;varying float vShade;varying vec3 vBedNormal;',begin:'vShade=shade;',normal:'vBedNormal=normal;',fragment:'varying float vShade;varying vec3 vBedNormal;',
    map:`vec2 bed=vReefWorld.xz;
      float coarse=smoothstep(-.35,.55,sin(bed.x*.37+1.3*sin(bed.y*.52))*sin(bed.y*.61-bed.x*.18+.7));
      vec3 fineGrain=mix(texture2D(map,bed*.5).rgb,texture2D(map,bed*.21+.43).rgb,.55),coarseGrain=texture2D(map,bed*.27+.17).rgb;
      vec3 reefGrain=mix(fineGrain,coarseGrain,coarse*.8);
      float drift=sin(bed.x*.71+2.*sin(bed.y*.93))*sin(bed.y*.83+bed.x*.37)+.5*sin(bed.x*2.3-bed.y*1.7+sin(bed.y*2.9));
      // Two crossed wave sets, each bent by a slow warp, give the low hummocks of a bed
      // the pumps keep stirring rather than a ruled field of dune ripples.
      float warpA=bed.x*.83+1.7*sin(bed.y*.61),warpB=bed.y*1.37-bed.x*.29;
      float phase=dot(bed,vec2(.34,.94))*10.5+1.1*sin(warpA)+.6*sin(warpB),cross=dot(bed,vec2(.91,-.41))*7.3+.9*sin(warpB);
      vec2 dPhase=vec2(.34,.94)*10.5+1.1*cos(warpA)*vec2(.83,1.7*.61*cos(bed.y*.61))+.6*cos(warpB)*vec2(-.29,1.37),dCross=vec2(.91,-.41)*7.3+.9*cos(warpB)*vec2(-.29,1.37);
      float ripple=sin(phase)+.25*sin(2.*phase+.8)+.6*sin(cross);
      vec2 rippleSlope=.10*vShade*((cos(phase)+.5*cos(2.*phase+.8))*dPhase+.6*cos(cross)*dCross);`,
    color:`vec3 sand=mix(vec3(.36,.30,.22),vec3(.88,.80,.66),smoothstep(.40,.90,reefGrain.r));
      // Shell fragments are the brightest flat grains; each takes its own cream or blush.
      float shell=smoothstep(.86,.95,reefGrain.r),tone=fract(sin(dot(floor(bed*41.),vec2(12.99,78.23)))*43758.5);
      sand=mix(sand,mix(vec3(.80,.74,.66),vec3(.78,.62,.58),step(.7,tone)),shell*.85);
      sand*=mix(1.,.86+.2*tone,.5*(1.-shell));
      // The back pane's foot gathers detritus and shade, so the bed darkens into it.
      diffuseColor.rgb=sand*(.90+.08*drift)*(.90+.055*ripple)*(.95-.07*coarse)*vShade*mix(.2,1.,smoothstep(${TANK.back.toFixed(2)},${(TANK.back+2.6).toFixed(2)},vReefWorld.z));`,
    surfaceNormal:`vec2 grainSlope=reefGrain.gb*2.-1.;
      normal=normalize(mat3(viewMatrix)*normalize(normalize(vBedNormal)+vec3(grainSlope.x*.7-rippleSlope.x,0.,grainSlope.y*.7-rippleSlope.y)));`,
    // The bed runs on under the rear glass, so its last few hand-widths sink into the water
    // the back wall paints instead of ending at a lit edge.
    recede:`smoothstep(${(TANK.back+3.4).toFixed(2)},${(TANK.back+.15).toFixed(2)},vReefWorld.z)`});
  // The bed runs past every frame edge, like Riverbed's, so no rim or wall is ever seen.
  const ground=new THREE.PlaneGeometry(30,14,180,84);ground.rotateX(-Math.PI/2);ground.translate(0,0,1.0);const p=ground.attributes.position,shade=new Float32Array(p.count);
  // Sand darkens where it meets the rock: a baked contact shadow from each rock footprint,
  // so the hardscape sits in the bed instead of floating on a lit sheet.
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setY(i,groundHeight(x,z));
    let contact=0;for(const r of ROCKS){const d=Math.max(0,Math.hypot((x-r[0])/r[3],(z-r[2])/r[5])-1)*Math.min(r[3],r[5]);contact=Math.max(contact,Math.exp(-d*d/(.55*r[4])));}
    shade[i]=1-.62*contact;}
  ground.setAttribute('shade',new THREE.BufferAttribute(shade,1));ground.computeVertexNormals();const sand=new THREE.Mesh(ground,sandMat);sand.receiveShadow=true;scene.add(sand);
  // Live rock is composed per pixel from the surface atlas, laid tri-planar over the baked
  // limestone. Most of a piece of aquacultured rock is bare skeleton weathered to a warm grey-tan;
  // coralline crust takes the raised, lit parts in patches of chalky pink and lilac; a
  // short olive-brown turf and film fill the hollows it leaves; small bright encrusting
  // starts are scattered over all of it; and the pits stay dark. The vertex stream brings
  // sky visibility and how thick and which hue the crust runs over each stretch.
  const rockMat=underwater(new THREE.MeshStandardMaterial({roughness:1,map:crustMap}),{key:'live-rock',
    vertex:'attribute vec3 surface;varying vec3 vRockNormal,vSurface;',begin:'vSurface=surface;',normal:'vRockNormal=normal;',
    fragment:'varying vec3 vRockNormal,vSurface;uniform sampler2D reefRelief;',map:`
    vec3 w=pow(abs(normalize(vRockNormal)),vec3(4.));w/=max(.001,w.x+w.y+w.z);
    vec3 q=vReefWorld*.62,f=vReefWorld*2.3+.37,o=vReefWorld*.13+.71;
    vec3 crust=texture2D(map,q.yz).rgb*w.x+texture2D(map,q.xz).rgb*w.y+texture2D(map,q.xy).rgb*w.z;
    vec3 fine=texture2D(map,f.yz).rgb*w.x+texture2D(map,f.xz).rgb*w.y+texture2D(map,f.xy).rgb*w.z;
    // A very low octave of the same atlas: which way a whole face of rock has gone, so a
    // boulder is not one even mix of everything.
    vec3 broad=texture2D(map,o.yz).rgb*w.x+texture2D(map,o.xz).rgb*w.y+texture2D(map,o.xy).rgb*w.z;
    vec3 rx=texture2D(reefRelief,q.yz).xyz,ry=texture2D(reefRelief,q.xz).xyz,rz=texture2D(reefRelief,q.xy).xyz;
    float relief=min(crust.r,fine.r*.9+.12),speck=rx.z*w.x+ry.z*w.y+rz.z*w.z;
    float up=normalize(vRockNormal).y;
    // Aquacultured limestone is laid down in beds, so a face shows faint layering under
    // the pitting.
    float bedding=.5+.5*sin(vReefWorld.y*7.3+fine.r*2.6+broad.r*5.);
    vec3 stone=mix(vec3(.10,.064,.038),vec3(.180,.122,.072),smoothstep(.25,.85,fine.r*.6+crust.r*.4))*(.88+.18*broad.r)*(.92+.10*bedding);
    // A grain finer than the atlas's own, for the crust's speckled, eroded margins.
    vec3 g=vReefWorld*7.9+.13;
    float grain=texture2D(map,g.yz).g*w.x+texture2D(map,g.xz).g*w.y+texture2D(map,g.xy).g*w.z;
    // Coralline grows on the raised crust of upward faces open to the lamp; how thick it
    // runs drifts over each boulder, and its edge breaks into flecks instead of a clean
    // outline. Bare stone and film still hold most of the rock.
    float crustSite=broad.g*.45+crust.g*.30+(vSurface.g-.5)*.6+.22*up+(relief-.5)*.35+(fine.g-.5)*.22+(grain-.5)*.30;
    float cover=smoothstep(.73,.87,crustSite)*(.55+.45*smoothstep(.3,.7,broad.g))*smoothstep(-.2,.5,up)*smoothstep(.35,.75,vSurface.r);
    float hue=clamp(vSurface.b+(crust.b-.45)*.7+(fine.b-.5)*.4,0.,1.);
    // Each crust patch its own colour: maroon, rose, a little purple, and pale pink where
    // a patch has bleached thin.
    vec3 coralline=mix(mix(vec3(.26,.06,.09),vec3(.48,.20,.24),smoothstep(.10,.50,hue)),vec3(.30,.12,.28),smoothstep(.68,.95,hue));
    coralline=mix(coralline,vec3(.52,.37,.39),.75*smoothstep(.58,.70,broad.r));
    coralline*=.62+.55*fine.r*grain;
    coralline=mix(coralline,vec3(.52,.38,.43),smoothstep(.6,1.,cover*(1.-cover)*4.)*grain*.5);
    // Film and short turf in the hollows and on faces the lamp misses.
    float turf=smoothstep(.40,.62,broad.b*.40+crust.b*.30+(.6-relief)*.35+(.6-vSurface.r)*.3+(fine.b-.5)*.25-.10*up)*(1.-cover);
    vec3 film=mix(mix(vec3(.08,.09,.035),vec3(.12,.085,.045),fine.b),vec3(.05,.055,.025),crust.b*(1.-fine.r));
    // A thin film of diatoms and green algae over the open stone, brown in some stretches
    // and green in others.
    float algae=smoothstep(.42,.64,broad.r*.45+fine.g*.35+crust.b*.20+(grain-.5)*.2)*smoothstep(-.2,.5,up)*(1.-turf);
    vec3 algaeTint=mix(vec3(.15,.10,.045),vec3(.09,.115,.04),smoothstep(.45,.75,broad.b));
    vec3 rock=mix(mix(mix(stone,algaeTint,algae*.7),film,turf*.8),coralline,cover);
    rock=mix(rock,mix(vec3(.46,.50,.22),vec3(.64,.36,.40),step(.55,fine.b)),speck*.3);
    // Porous limestone: every pit, hole and undercut falls to a dark purple-brown, the
    // atlas's relief at two scales plus the baked sky visibility.
    float cavity=smoothstep(.34,.70,relief)*mix(.25,1.,smoothstep(.22,.55,fine.r))*pow(vSurface.r,2.2);
    diffuseColor.rgb=mix(vec3(.018,.010,.014),rock,cavity);`,
    surfaceNormal:`vec3 rn=normalize(vRockNormal);
      vec3 rq=vReefWorld*4.0;
      vec3 perturb=vec3(0.,rx.xy*2.-1.)*w.x+vec3(ry.x*2.-1.,0.,ry.y*2.-1.)*w.y+vec3(rz.xy*2.-1.,0.)*w.z;
      // The first octave lays the atlas over 1.6 units, so its pits land at the 1-3 cm the
      // eye resolves; this second one is the millimetre grain between them, for close views.
      vec2 fx=texture2D(reefRelief,rq.yz).xy*2.-1.,fy=texture2D(reefRelief,rq.xz).xy*2.-1.,fz=texture2D(reefRelief,rq.xy).xy*2.-1.;
      perturb+=(vec3(0.,fx)*w.x+vec3(fy.x,0.,fy.y)*w.y+vec3(fz,0.)*w.z)*.6;
      normal=normalize(mat3(viewMatrix)*normalize(rn+perturb*.9));
      // Coralline and turf are matt; only the bare raised limestone keeps a faint wet film.
      roughnessFactor*=1.-.15*smoothstep(.7,.95,relief)*(1.-cover)*(1.-turf)*(1.-algae);`,
    specular:.2});
  const rockCompile=rockMat.onBeforeCompile;rockMat.onBeforeCompile=shader=>{rockCompile(shader);shader.uniforms.reefRelief={value:reliefMap};};
  // Keep extra shader textures visible to the common disposal path.
  rockMat.userData.extraTextures=[reliefMap];
  const rocks=new THREE.Mesh(rockGeo,rockMat);rocks.castShadow=rocks.receiveShadow=true;scene.add(rocks);
  // Rubble is broken live rock, so it takes the rock's own crust, each piece its own mix.
  const rubble=[];
  for(let i=0;i<220;i++){
    const x=(rng()-.5)*22,z=-2.8+rng()*8;
    if(Math.abs(x)<1.2&&rng()>.32)continue;
    const s=.025+Math.pow(rng(),3)*.13,g=ellipsoid([x,groundHeight(x,z)+s*.14,z],[s,s*.53,s*.76],i+91,12),piece=new THREE.Color(.65+rng()*.25,rng(),rng());
    tint(g,()=>piece);rubble.push(g);
  }
  // merge() carries a color stream, which is where each piece's surface triple rides.
  const rubbleGeo=merge(rubble);rubbleGeo.setAttribute('surface',rubbleGeo.getAttribute('color'));rubbleGeo.deleteAttribute('color');
  const rubbleMesh=new THREE.Mesh(rubbleGeo,rockMat);rubbleMesh.receiveShadow=true;scene.add(rubbleMesh);
  return {obstacles:ROCKS,host:HOST,stations:STATIONS,rockSurface:rocks};
}
/** The tank's back wall and the underside of the water surface, seen from inside the
 *  water. A real reef tank's rear pane is lost in the blue, so the wall is painted as the
 *  water carrying on past it: the same glow the post pass sums in front of it, integrated
 *  over a further stretch of water, so the frame fades into depth instead of stopping at a
 *  painted panel. A ray climbing steeply enough meets the surface's underside in that
 *  further water, which is the rippled, lit membrane along the top of a wide frame; within
 *  the tank the surface is real geometry at the waterline, so it writes depth and the post
 *  pass's march, focus and haze all stop there. The two read the same surface through the
 *  same water, so they meet without a seam. Both write zero alpha, which tells the post
 *  pass they are open water, not a solid for its contact shading to darken where they meet.
 *  Nothing of the enclosure itself (glass, rim, pumps) is modelled. */
// How far off the far surface can still be made out, and its sheen.
const SURFACE_REACH=22,SURFACE_SHEEN=[1.0,1.6,1.8];
export function createBackdrop(scene){
  const uniforms={reefTime:waterTime,reefCaustics:causticMap};
  const extinction=`vec3(${EXTINCTION.join(',')})`;
  const backMat=new THREE.ShaderMaterial({uniforms,
    vertexShader:`varying vec3 p;
      void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 p;uniform float reefTime;
      ${extinctionGLSL}${causticGLSL}${inscatterGLSL}${surfaceGLSL}
      void main(){
        vec3 dir=normalize(p-cameraPosition);float path=reefWaterPath(p,cameraPosition);
        vec3 col=reefFarWater(p,dir,reefTime);
        // The surface is lost in the water like everything else, so it fades out with
        // distance before it can draw a horizon. Seen this far off and this flat it mirrors
        // the bright water just under it, a cyan sheen over the blue.
        float reach=dir.y>0.?max(0.,${SURFACE.toFixed(3)}-p.y)/dir.y:${SURFACE_REACH.toFixed(1)};
        if(reach<${SURFACE_REACH.toFixed(1)}){
          vec3 veil=exp(-${extinction}*reach);
          vec3 under=reefInscatter(p+dir*reach*.5,dir,reefTime,1.)*(1.-veil)/${extinction}
            +veil*vec3(${SURFACE_SHEEN.join(',')})*reefSurfaceUnderside(p+dir*reach,dir,reefTime);
          col=mix(under,col,smoothstep(1.5,${SURFACE_REACH.toFixed(1)},reach));
        }
        gl_FragColor=vec4(col*reefTransmittance(path),0.);
      }`});
  const backGeo=new THREE.PlaneGeometry(44,SURFACE+1.5);backGeo.translate(0,SURFACE/2-.75,TANK.back-.05);
  scene.add(new THREE.Mesh(backGeo,backMat));
  const surfaceMat=new THREE.ShaderMaterial({uniforms,
    vertexShader:`varying vec3 p;
      void main(){p=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
    fragmentShader:`varying vec3 p;uniform float reefTime;
      ${extinctionGLSL}${causticGLSL}${inscatterGLSL}${surfaceGLSL}
      void main(){
        vec3 dir=normalize(p-cameraPosition);float path=reefWaterPath(p,cameraPosition);
        gl_FragColor=vec4(reefSurfaceUnderside(p,dir,reefTime)*reefTransmittance(path),0.);
      }`});
  // Faces down, toward the water; from above it is never seen. It runs on a little behind
  // the wall so the two meet in a clean intersection rather than at two edges.
  const surfaceGeo=new THREE.PlaneGeometry(44,TANK.front-TANK.back+1);surfaceGeo.rotateX(Math.PI/2);surfaceGeo.translate(0,SURFACE,(TANK.front+TANK.back-1)/2);
  scene.add(new THREE.Mesh(surfaceGeo,surfaceMat));
}
