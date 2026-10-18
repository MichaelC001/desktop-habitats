import * as THREE from 'three';
import { underwater,responseGLSL } from './water.js';
import { smoothstep,clamp,lerp,noise } from './math.js';
import { merge } from './geometry.js';
import { ANEMONES } from './layout.js';
import { supportHeight } from './terrain.js';
import { crownProfile, buildCrown, crownOrder, crownBudget, HOST_COLUMN } from './anemone-crown.js';

// The finished host retains its broad, long-fingered crown. Small specimens use the
// compact oral-disc layout in anemone-crown.js, with a wider disc, shorter column and
// shorter tentacles. All bodies share a mesh; all tentacles share an instanced draw.
const RIM=.36;
// Column silhouette as [share of height, radius/S]: the pedal disc gripping the rock, a
// waist, and the flare to the rim; cosine-blended so the rim rounds off and the waist is a
// smooth throat rather than a kink. Below the rock the foot runs on and narrows, as a
// foot wedged down a hole does, so no edge of it can float over a hollow or poke out
// where the rock falls away.
const COLUMN=[[0,.30],[.10,.25],[.5,.23],[1,RIM]];
function columnRadius(u){
  if(u<0)return COLUMN[0][1]*Math.max(.6,1+u*.4);
  for(let i=1;i<COLUMN.length;i++){const [u0,r0]=COLUMN[i-1],[u1,r1]=COLUMN[i];if(u<=u1)return lerp(r0,r1,.5-.5*Math.cos(Math.PI*(u-u0)/(u1-u0)));}
  return RIM;
}
// The disc is a shallow dome over the tentacle field; v runs from the rim (0) to the
// centre (1). The mouth is an elliptical slit with raised lips, so e is the distance from
// the centre stretched along the slit's axis.
const discLift=v=>.045*smoothstep(0,.45,v);
const mouthLift=e=>.030*Math.exp(-(((e-.20)/.08)**2))-.045*(1-smoothstep(0,.11,e));
const E=Math.E,hash=seed=>{const v=Math.sin(seed*E)*Math.cos(seed*Math.PI)*1e4;return v-Math.floor(v);};
// Verrucae: the adhesive warts a column carries, a staggered lattice crowding toward the
// rim with a share of its sites left bare, read as a pale mottle and a slight relief.
const VERRUCAE={rows:12,cols:20,skip:.22,jitter:.9,topBias:.55,size:.020};
function verruca(a,u,seed){
  const {rows,cols,skip,jitter,topBias,size}=VERRUCAE,rf=Math.pow(clamp(u,0,1),1/topBias)*rows;let best=0;
  for(let dr=-1;dr<=1;dr++){const row=Math.floor(rf)+dr;if(row<0||row>=rows)continue;
    const cf=a/(2*Math.PI)*cols-(row%2)/2;
    for(let dc=-1;dc<=1;dc++){const col=((Math.floor(cf)+dc)%cols+cols)%cols,site=row*cols+col+seed;
      if(hash(site*E+401)<skip)continue;
      const cy=Math.pow((row+.5+(hash(site*Math.PI+411)-.5)*jitter)/rows,topBias),cx=(col+.5+(row%2)/2+(hash(site*E+421)-.5)*jitter)/cols*2*Math.PI;
      const wart=size*(.45+.9*hash(site*E+441))*(.5+.5*cy),da=Math.atan2(Math.sin(a-cx),Math.cos(a-cx))*columnRadius(clamp(u,0,1)),dy=(u-cy)*HOST_COLUMN;
      best=Math.max(best,Math.exp(-(da*da+dy*dy)/(wart*wart)*1.6)*(.55+.45*hash(site*Math.PI+431)));}}
  return best;
}
const FOOT=new THREE.Color('#1e0c0a'),SHAFT=new THREE.Color('#3e1a12'),LIP=new THREE.Color('#4a2216'),WART=new THREE.Color('#8e5a48'),DISC=new THREE.Color('#6a3a2c'),LIPS=new THREE.Color('#8a5040'),MOUTH=new THREE.Color('#2a0c10');
// Each placement becomes one column-and-disc surface of revolution about its own axis,
// standing on the rock; the disc's dome carries the tentacle roots.
function specimen(spec,index){
  const crown=buildCrown(spec,index),{S,rim,compact}=crown,H=crown.height*S,up=new THREE.Vector3(0,1,0),axis=new THREE.Vector3();
  // The axis leans a little with the rock it stands on and by whatever the placement asks
  // for; the disc's position is authored, the column drops from it to wherever the rock is.
  const step=.25,lean=spec.lean||[0,0],slopeX=(supportHeight(spec.x+step,spec.z)-supportHeight(spec.x-step,spec.z))/(2*step),slopeZ=(supportHeight(spec.x,spec.z+step)-supportHeight(spec.x,spec.z-step))/(2*step);
  axis.set(-slopeX*.35+lean[0],1,-slopeZ*.35+lean[1]).normalize();
  const frame=new THREE.Quaternion().setFromUnitVectors(up,axis),disc=new THREE.Vector3(spec.x,spec.y-(compact?.12*S:0),spec.z);
  const foot=disc.clone().addScaledVector(axis,-H),sunk=Math.max(.12*S,foot.y-supportHeight(foot.x,foot.z)+.04);
  return {S,H,rim,compact,crown,frame,foot,sunk,seed:index*977,count:crown.count};
}
function bodyGeometry(sp){
  const {S,H,rim,frame,foot,sunk,seed}=sp,rings=56,segments=72,pos=[],col=[],idx=[],point=new THREE.Vector3(),color=new THREE.Color(),FOLD=.68;
  for(let j=0;j<=rings;j++){const t=j/rings;
    for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2;
      let r,y,shade=1;
      if(t<FOLD){
        // Column: u runs from below the rock (hidden, so the foot never floats) to the rim.
        const u=lerp(-sunk/H,1,t/FOLD),wart=verruca(a,u,seed),edge=1+.012*noise(Math.cos(a)*3+seed,u*4,Math.sin(a)*3);
        // Longitudinal striation: the mesenterial insertions show through the body wall as
        // shallow grooves that fade below the rim.
        const groove=Math.pow(.5+.5*Math.cos(a*14+seed),1.5)*(1-smoothstep(.70,.92,u)),base=columnRadius(u)*(1+(rim/RIM-1)*smoothstep(.35,1,u));
        // A contracted column lies in soft horizontal folds that wander around it.
        const fold=noise(Math.cos(a)*1.6+seed,u*9,Math.sin(a)*1.6)*(1-smoothstep(.80,.98,u));
        r=S*base*edge*(1-.012*groove)*(1+.8*VERRUCAE.size*wart/base)*(1+.035*fold);y=H*u;
        color.copy(FOOT).lerp(SHAFT,smoothstep(.05,.55,u)).lerp(LIP,smoothstep(.55,1,u)).lerp(WART,Math.min(1,wart*.55));
        // The crown shades the top of the column and the grooves lie in their own shadow.
        shade=(1-.60*smoothstep(.55,1,u))*(1-.30*groove)*(.86+.14*fold);
      }else{
        const v=(t-FOLD)/(1-FOLD),e=(1-v)*(1+.30*Math.cos(2*a+seed));r=S*rim*(1-v);y=H+S*(discLift(v)+mouthLift(e));
        // Mesenterial lines radiate from the mouth across the disc, which sits in the crown's shade.
        color.copy(DISC).lerp(LIPS,Math.exp(-(((e-.20)/.10)**2))).lerp(MOUTH,1-smoothstep(.04,.13,e));
        shade=.45*(1-.14*smoothstep(.55,1,Math.cos(a*24))*smoothstep(.15,.4,v)*(1-smoothstep(.7,.9,v)));
      }
      point.set(Math.cos(a)*r,y,Math.sin(a)*r).applyQuaternion(frame).add(foot);
      pos.push(point.x,point.y,point.z);col.push(color.r*shade,color.g*shade,color.b*shade);
      if(j<rings&&i<segments){const k=j*(segments+1)+i;idx.push(k,k+segments+1,k+1,k+1,k+segments+1,k+segments+2);}}}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));geo.setIndex(idx);geo.computeVertexNormals();
  return geo;
}
// A tentacle's mesh is a straight tube whose position.y is the axial parameter and whose
// cross-section is a gentle taper in shares of the base radius, closed by a rounded tip;
// the vertex shader bends it and swells each tentacle's own bulb onto it.
function tentacleGeometry(){
  const levels=[0,.12,.24,.36,.48,.58,.66,.72,.77,.81,.845,.875,.90,.92,.94,.955,.968,.979,.988,.995,1],sides=14,CAP=.955,pos=[],idx=[];
  const taper=s=>1-.32*Math.pow(s,1.4);
  const radius=s=>s<=CAP?taper(s):taper(CAP)*Math.sqrt(Math.max(0,1-((s-CAP)/(1-CAP))**2));
  for(let j=0;j<levels.length;j++){const s=levels[j],r=radius(s);
    for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2;pos.push(Math.cos(a)*r,s,Math.sin(a)*r);if(j<levels.length-1&&i<sides){const k=j*(sides+1)+i;idx.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}}}
  // Closed base: a root standing a little proud of the disc would otherwise show as a black slot.
  const hub=pos.length/3;pos.push(0,0,0);for(let i=0;i<sides;i++)idx.push(hub,i,i+1);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
// Every specimen has its own density budget; the host retains its previous shape.
export const TENTACLE_COUNT=ANEMONES.reduce((n,spec)=>n+crownProfile(spec).count,0);
export function createAnemone(scene){
  // Built after the terrain, so the columns stand on the baked rock rather than its analytic stand-in.
  const specimens=ANEMONES.map(specimen);
  const vertex=`attribute vec4 aShape;attribute vec4 aCurve;attribute float aFlex;varying float vAxis;varying float vAround;varying float vTone;varying float vRing;varying float vSeed;varying float vBulb;${responseGLSL}
    // The resting strand is a circular arc in the local x-y plane (x outward from the disc,
    // y the anemone's axis): it leaves the disc aCurve.x from the axis and turns a further
    // aCurve.y by the tip, so a small curl is a straight finger and a large one hooks over
    // the rim. A slight wander out of that plane, phased per tentacle, keeps a crown seen
    // face-on from reading as spines on a ball. The flow adds a cantilever bend on top,
    // solved once in the normal hook, which three runs before begin_vertex.
    vec2 tSway;vec2 tTip;
    void tentacleSolve(){vec3 root=instanceMatrix[3].xyz;mat3 toLocal=transpose(mat3(instanceMatrix));
      vec2 f=reefResponse(root,reefTime,.45+aShape.x*.60+aCurve.z*.50),g=reefResponse(root,reefTime,1.3+aShape.x*.80);
      float gain=.90*aShape.x*aFlex;
      tSway=(toLocal*vec3(f.x,0.,f.y)).xz*gain;tTip=(toLocal*vec3(g.x,0.,g.y)).xz*gain*.5;}
    vec3 arcPoint(float s){float c=max(aCurve.y,.02),t=aCurve.x+c*s;return vec3(cos(aCurve.x)-cos(t),sin(t)-sin(aCurve.x),.05*s*sin(s*5.5+aCurve.w*25.)*c)*aShape.x/c;}
    vec3 tentacleCenter(float s){vec2 h=tSway*s*s+tTip*s*s*s*s;return arcPoint(s)+vec3(h.x,0.,h.y);}
    vec3 tentacleSlope(float s){vec2 dh=tSway*2.*s+tTip*4.*s*s*s;float t=aCurve.x+aCurve.y*s;float z=.05*(sin(s*5.5+aCurve.w*25.)+5.5*s*cos(s*5.5+aCurve.w*25.));return vec3(sin(t),cos(t),z)*aShape.x+vec3(dh.x,0.,dh.y);}
    // The bubble: the tentacle swells below its tip and pinches to a narrow waist before
    // the tip itself. How far a tentacle bubbles varies from one to the next, and a rare
    // one stays slender. m is the swelling as a share of the taper, dm its slope along s.
    float bulbAmount(){float b=fract(aCurve.w*7.31);return step(.05,fract(aCurve.w*3.7))*(.60+.40*b);}
    float bump(float s,float c,float w){return exp(-pow((s-c)/w,2.));}
    float bulbM(float s,float b){return 1.+b*(1.45*bump(s,.80,.085)-.30*bump(s,.915,.03));}
    float bulbDM(float s,float b){return b*(-1.45*bump(s,.80,.085)*2.*(s-.80)/(.085*.085)+.30*bump(s,.915,.03)*2.*(s-.915)/(.03*.03));}`;
  const mat=underwater(new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.50,metalness:0}),{
    key:'tank-anemone',vertex,
    // Tissue a few cells thick: the shaft passes a fair share of the light, the stretched
    // bulb most of it, so a backlit crown glows rose rather than standing as dark fingers.
    transmission:'(.24+.40*smoothstep(.20,1.,vAxis))',
    // A tentacle is thinner than light's scattering length in it, so what it carries comes
    // out all round, and most of all from the stretched bulb.
    wrap:'(.62+.30*smoothstep(.40,.85,vAxis))',
    // Mucus over the tissue: a soft wet sheen along each bulb, not a hard glaze.
    specular:.7,
    // A rose bubble-tip carries a faint green fluorescent protein in the tentacle wall,
    // showing as a thin ring where the shaft swells into the bulb, and a red one in the
    // bulb and tip. Green spread over the whole rose shaft would mix to khaki.
    // The roots buried among their neighbours get little of either.
    fluorescence:`(vec3(.05,.42,.13)*exp(-pow((vAxis-.70)/.05,2.))*(.5+.5*vBulb)+vec3(.24,.03,.09)*smoothstep(.70,1.,vAxis)*(.55+.45*vBulb))
      *(1.-.60*(1.-smoothstep(.18,.78,vAxis))*(1.-.65*vRing*vRing))`,
    // The swelling tilts the surface along the axis: the bulb's lower flank faces down the
    // tentacle and its upper flank up it, which is what lets the bubble read in the light.
    normal:`tentacleSolve();float tb=bulbAmount(),tm=bulbM(position.y,tb);vec3 slope=normalize(tentacleSlope(position.y));vec3 tx=normalize(vec3(slope.y,-slope.x,0.));vec3 tz=normalize(cross(tx,slope));
      objectNormal=normalize((tx*normal.x+tz*normal.z)/(aShape.y*tm)+slope*(normal.y-bulbDM(position.y,tb)/tm*length(position.xz)*length(normal.xz))/length(tentacleSlope(position.y)));`,
    begin:`float s=position.y;vec3 dir=normalize(tentacleSlope(s));vec3 ax=normalize(vec3(dir.y,-dir.x,0.));vec3 az=normalize(cross(ax,dir));
      transformed=tentacleCenter(s)+(ax*position.x+az*position.z)*aShape.y*tm;
      vAxis=s;vAround=atan(position.z,position.x);vTone=aShape.z;vRing=aShape.w;vSeed=aCurve.w;vBulb=tb;`,
    fragment:`varying float vAxis;varying float vAround;varying float vTone;varying float vRing;varying float vSeed;varying float vBulb;`,
    // Light through the thin edge of a tentacle: where the surface turns away from the
    // eye the stretched tissue of the bulb goes pale pink instead of dark, and the wet
    // skin's highlight spreads softly.
    surfaceNormal:`float thin=smoothstep(.45,.85,vAxis)*(.4+.6*vBulb),rim=pow(1.-abs(dot(normal,normalize(vViewPosition))),2.);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.74,.40,.34),rim*thin*.34);roughnessFactor*=1.+.15*thin;`,
    // A rose bubble-tip: a rose-brown shaft lit with faint longitudinal stripes, where the
    // mesenteries show through the body wall; a paler, translucent rose bulb; a white band
    // at the waist; and a pale pink tip. Kept well below the tone mapper's shoulder.
    color:`float stripe=.5+.5*cos(vAround*6.+vSeed*31.),bulbZone=smoothstep(.60,.76,vAxis)*(1.-smoothstep(.87,.90,vAxis));
      vec3 root=vec3(.12,.04,.035),shaft=mix(vec3(.30,.09,.07),vec3(.38,.13,.10),vTone),bulb=mix(vec3(.44,.13,.10),vec3(.54,.19,.14),vTone),band=vec3(.66,.52,.44),tip=mix(vec3(.50,.14,.18),vec3(.62,.26,.28),fract(vSeed*5.3));
      vec3 tissue=mix(root,shaft,smoothstep(0.,.20,vAxis))*(.84+.16*stripe)*(1.+.35*smoothstep(.25,.65,vAxis));
      tissue=mix(tissue,bulb*(.92+.08*stripe),bulbZone*(.40+.60*vBulb));
      tissue=mix(tissue,band,exp(-pow((vAxis-.915)/.03,2.))*(.15+.35*vBulb));
      tissue=mix(tissue,tip,smoothstep(.80,1.,vAxis)*smoothstep(.80,1.,vAxis)*(.45+.45*fract(vSeed*11.7)));
      // Inside the crown the roots and the inner rings' shafts are buried among their
      // neighbours and only the bulbs and the outer envelope stand in the light; what
      // reaches the depths has come through tissue, so they go deep red-brown rather than
      // grey. Cheaper and steadier than shadowing a few hundred swaying instances.
      float buried=(1.-smoothstep(.18,.78,vAxis))*(1.-.65*vRing*vRing);
      diffuseColor.rgb=mix(tissue,vec3(.10,.03,.02),buried*.78);`
  });
  const tentacles=new THREE.InstancedMesh(tentacleGeometry(),mat,TENTACLE_COUNT);
  const shapes=new Float32Array(TENTACLE_COUNT*4),curves=new Float32Array(TENTACLE_COUNT*4),flex=new Float32Array(TENTACLE_COUNT);
  const matrix=new THREE.Matrix4(),rotation=new THREE.Matrix4(),X=new THREE.Vector3(),Y=new THREE.Vector3(),Z=new THREE.Vector3(),root=new THREE.Vector3();
  const crowns=[];
  for(const sp of specimens){const {S,H,rim,frame,foot,crown}=sp,instances=[];
    for(const t of crown.roots){
      X.set(Math.cos(t.angle),0,Math.sin(t.angle));Y.set(0,1,0);Z.crossVectors(X,Y);
      root.set(X.x*t.radius*rim*S,H+S*discLift(1-t.radius)-.006*S,X.z*t.radius*rim*S).applyQuaternion(frame).add(foot);
      rotation.makeBasis(X,Y,Z);matrix.makeRotationFromQuaternion(frame).multiply(rotation).setPosition(root);
      instances.push({matrix:matrix.clone(),shape:[t.length,t.girth,t.tone,t.ring],curve:[t.tilt,t.curl,t.lag,t.seed],flex:t.flex});
    }
    crowns.push({crown,instances,order:crownOrder(crown.roots)});
  }
  const shapeAttribute=new THREE.InstancedBufferAttribute(shapes,4),curveAttribute=new THREE.InstancedBufferAttribute(curves,4),flexAttribute=new THREE.InstancedBufferAttribute(flex,1);
  tentacles.geometry.setAttribute('aShape',shapeAttribute);tentacles.geometry.setAttribute('aCurve',curveAttribute);tentacles.geometry.setAttribute('aFlex',flexAttribute);
  let lastQuality=null;
  function setQuality(quality){
    if(quality===lastQuality)return;lastQuality=quality;let count=0;
    for(const {crown,instances,order} of crowns){
      const budget=crownBudget(crown,quality);
      for(let i=0;i<budget;i++){
        const t=instances[order[i]];tentacles.setMatrixAt(count,t.matrix);shapes.set(t.shape,count*4);curves.set(t.curve,count*4);flex[count]=t.flex;count++;
      }
    }
    tentacles.count=count;tentacles.instanceMatrix.needsUpdate=true;shapeAttribute.needsUpdate=true;curveAttribute.needsUpdate=true;flexAttribute.needsUpdate=true;
  }
  setQuality('detail');
  tentacles.frustumCulled=false;tentacles.receiveShadow=true;scene.add(tentacles);
  const body=new THREE.Mesh(merge(specimens.map(bodyGeometry)),underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62}),{key:'anemone-body',transmission:.22}));
  body.castShadow=body.receiveShadow=true;scene.add(body);
  return {tentacles,count:TENTACLE_COUNT,setQuality};
}
