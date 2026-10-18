import * as THREE from 'three';
import { merge, coralBranches, gorgonian, brainCoral, faviaCoral, polyp, plateCoral } from './geometry.js';
import { underwater, responseGLSL } from './water.js';
import { randomGenerator, clamp } from './math.js';
import { supportHeight } from './terrain.js';

// Living coral is a skin of polyps over a skeleton, finer than any vertex can carry: a
// cellular field in world space places one polyp per cell, so no texture has to be
// unwrapped over a branching mesh. A polyp's relief is a profile of d, the distance to
// its centre, and e, how far inside its cell it lies, both in cell widths; the slope
// comes from their exact gradients rather than screen derivatives, which step in 2x2
// blocks. The field fades out once a cell shrinks to a few pixels, and is not searched at
// all past that, which spares a distant or low-resolution frame most of its cost.
const cellGLSL=`vec3 polypV1=vec3(1.,0.,0.);vec3 polypV2=vec3(0.,1.,0.);float polypFade;float polypD=1.;float polypE=1.;
vec3 polypHash(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx);}
void polypCells(vec3 p){vec3 i=floor(p),f=fract(p);float d1=8.,d2=8.;
  for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec3 g=vec3(x,y,z),v=f-g-polypHash(i+g);float d=dot(v,v);
    if(d<d1){d2=d1;polypV2=polypV1;d1=d;polypV1=v;}else if(d<d2){d2=d;polypV2=v;}}
  polypD=sqrt(d1);polypE=sqrt(d2)-polypD;}
float reefValue(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(polypHash(i).x,polypHash(i+vec3(1,0,0)).x,f.x),mix(polypHash(i+vec3(0,1,0)).x,polypHash(i+vec3(1,1,0)).x,f.x),f.y),
             mix(mix(polypHash(i+vec3(0,0,1)).x,polypHash(i+vec3(1,0,1)).x,f.x),mix(polypHash(i+vec3(0,1,1)).x,polypHash(i+vec3(1,1,1)).x,f.x),f.y),f.z);}`;
// Fluorescence comes from the polyps themselves: brightest at each mouth, dimmer over the
// tissue between them.
const POLYP_GLOW='mix(1.,.55+.9*(1.-smoothstep(0.,.38,polypD)),polypFade)';
/** One physical material per coral kind over the shared polyp field. `cells` is polyps per
 *  tank unit, `shape` the GLSL relief profile of d and e, `relief` its slope gain, `cup`
 *  the colour multiplier at a polyp's centre, `lip` the brightening of a corallite's rim
 *  and `groove` between polyps; `sheen` is the velvet of extended tentacles catching the
 *  light. `mottle` is how far the tissue's tone wanders in patches a few polyps across,
 *  so no colony is one flat colour. Every coral fluoresces through its per-vertex
 *  `fluor`, masked by `glow`. */
const POLYP='.8*(1.-smoothstep(0.,.45,d))+.3*smoothstep(0.,.25,e)',CORALLITE='.85*exp(-pow((d-.30)/.11,2.))-.75*(1.-smoothstep(.0,.20,d))+.15*smoothstep(0.,.3,e)';
function coralMaterial(key,{cells=60,shape=POLYP,relief=.35,cup=[1.18,1.14,1.06],groove=.84,lip=0,mottle=.18,sheen=0,sheenColor='#d8d4c4',roughness=.7,transmission=.15,side=THREE.FrontSide,glow=POLYP_GLOW,...hooks}={}){
  const f=x=>Number(x).toFixed(4),[r,g,b]=cup.map(f);
  return underwater(new THREE.MeshPhysicalMaterial({vertexColors:true,roughness,side,sheen,sheenRoughness:.55,sheenColor:new THREE.Color(sheenColor)}),{key,transmission,...hooks,
    // The pigment rides on each vertex, tinted per instance like the tissue colour is.
    vertex:'attribute vec3 fluor;varying vec3 vFluor;'+(hooks.vertex||''),
    begin:`vFluor=fluor;
      #ifdef USE_INSTANCING_COLOR
      vFluor*=instanceColor;
      #endif
      ${hooks.begin||''}`,
    fluorescence:`vFluor*(${glow})`,
    fragment:'varying vec3 vFluor;'+cellGLSL+`float polypShape(float d,float e){return ${shape};}`+(hooks.fragment||''),
    color:`polypFade=1.-smoothstep(.20,.60,length(fwidth(vReefWorld))*${f(cells)});if(polypFade>0.)polypCells(vReefWorld*${f(cells)});
      diffuseColor.rgb*=mix(vec3(1.),mix(vec3(${f(groove)}),vec3(${r},${g},${b}),1.-smoothstep(.0,.42,polypD))*mix(.9,1.,smoothstep(0.,.2,polypE))*(1.+${f(lip)}*exp(-pow((polypD-.30)/.10,2.))),polypFade);
      {float m=reefValue(vReefWorld*${f(cells*.09)})*.65+reefValue(vReefWorld*${f(cells*.31)}+7.)*.35;diffuseColor.rgb*=1.+${f(mottle)}*(2.*m-1.)*vec3(1.,.92,.84);}${hooks.color||''}`,
    surfaceNormal:`{float h0=polypShape(polypD,polypE),hd=(polypShape(polypD+.01,polypE)-h0)*100.,he=(polypShape(polypD,polypE+.01)-h0)*100.;
      vec3 n1=normalize(polypV1),grad=mat3(viewMatrix)*(hd*n1+he*(normalize(polypV2)-n1));
      normal=normalize(normal-${f(relief)}*polypFade*(grad-dot(grad,normal)*normal));}${hooks.surfaceNormal||''}`});
}
const mesh=(geometry,material,cast=true)=>{const m=new THREE.Mesh(geometry,material);m.castShadow=cast;m.receiveShadow=true;return m;};

// Fluorescent proteins as [colour, strength]: the green GFP-like protein most corals carry,
// the orange and pink of the red-shifted ones, and cyan.
const GREEN=s=>['#3dff6e',s],LIME=s=>['#9cff3a',s],ORANGE=s=>['#ff7a2a',s],PINK=s=>['#ff3d8a',s],CYAN=s=>['#2ee6ff',s];

/** Every coral in the tank: stony skeletons are static, and only the gorgonian fan
 *  answers the flow. */
export function createCorals(scene){
  const rng=randomGenerator(22097);
  // Colonies stand on the baked rock: x and z place a colony, sink is how far its base
  // plate settles below the surface there.
  const grow=(x,z,sink,...rest)=>coralBranches([x,supportHeight(x,z)-sink,z],...rest);
  // Acropora, needle-fine Seriatopora and stubby Montipora digitata. Live coral tissue
  // is mostly tan and brown — zooxanthellae, not pigment — tinted green, cream or lilac
  // by the host's own proteins, with pale, still-calcifying growing tips; a few colonies
  // carry a fluorescent protein that the actinic light makes glow.
  // Radial cups are geometry only where they shape the silhouette, on Acropora; everywhere
  // else the material's corallite field carries the surface. A digitata forks from a few
  // shared trunks rather than standing as separate fingers.
  const ACRO={roots:18,forks:5,thickness:.047,reach:.50,spread:.44,radials:26,pale:.66},NEEDLE={thickness:.033,forks:3,roots:6,order:3,rise:.80,corallite:.08,blunt:.2,pale:.5};
  const FINGER={thickness:.092,forks:3,roots:6,order:2,rise:.85,taper:.70,blunt:1,spread:.30,reach:.40,pale:.45},BRUSH={roots:16,forks:3,order:1,thickness:.062,reach:.66,spread:.36,taper:.70,blunt:.6,radials:56,pale:.55};
  const branches=[
    // A golden-tan Acropora whose pale growing tips glow yellow-green: the warmest and
    // palest colony on the left, against the green slimer and the pink birdsnest.
    grow(-5.82,-1.00,.42,2.10,1.05,39,'#c09858','#f8eab0',{...ACRO,fluor:LIME(.55)}),
    // A green slimer, the one colony whose whole skin glows.
    grow(-7.10,-1.05,.42,1.75,1.16,74,'#5e7a3c','#d4f0a0',{...ACRO,roots:14,thickness:.050,reach:.58,spread:.34,fluor:GREEN(1.05)}),
    // A pink birdsnest.
    grow(-4.35,-2.15,.60,2.30,.99,122,'#b8607a','#f8d0de',{...NEEDLE,fluor:PINK(1.0)}),
    // A tan Acropora with green polyps and pale growing tips, and a cream one beside it.
    grow(5.45,-1.52,.05,1.80,1.22,82,'#8e7646','#e8f4c8',{...ACRO,fluor:GREEN(.78)}),
    grow(7.34,-1.62,.38,1.30,1.00,417,'#c4a87c','#f6ecd8',{...ACRO,roots:12,thickness:.052,reach:.62,spread:.34,fluor:CYAN(.22)}),
    // A cream birdsnest.
    grow(3.28,-1.52,.38,1.60,.86,23,'#bca282','#f6ecdc',{...NEEDLE,fluor:LIME(.30)}),
    // An orange digitata.
    grow(4.30,1.55,.17,.84,.98,611,'#c0622e','#f8c894',{...FINGER,vary:.30,fluor:ORANGE(1.05)}),
    // The arch lintel carries its own colonies, a tan Acropora with green tips and a
    // purple bottlebrush whose tips glow pink; the cave beneath stays open.
    grow(-.45,-1.14,.12,.95,.90,707,'#a08456','#e4f4d4',{...ACRO,roots:12,forks:4,reach:.56,fluor:GREEN(.62)}),
    grow(1.34,-1.24,.30,.95,.55,811,'#74407e','#ecc4e4',{...BRUSH,fluor:PINK(.48)}),
    // Low colonies crowd the host's foot, so its column rises out of the reef, not bare rock.
    grow(-3.66,1.34,.10,.70,.95,1201,'#5a7038','#d0e49a',{...FINGER,roots:5,vary:.25,fluor:GREEN(.62)}),
    grow(-4.38,1.30,.10,.62,.80,1207,'#8a5068','#f0c8d8',{...FINGER,roots:4,vary:.25,fluor:PINK(.40)}),
    grow(-7.30,1.10,.06,.55,.90,1213,'#b89a70','#f0e0c0',{...FINGER,roots:5,vary:.25,fluor:LIME(.22)}),
    // A pink Pocillopora on the right shoulder, all blunt lumpy branchlets.
    grow(6.15,.50,.02,.85,1.05,905,'#b8607a','#f6cad8',{...FINGER,roots:30,forks:3,order:1,thickness:.11,reach:.46,spread:.50,taper:.72,radials:40,pale:.5,vary:.25,fluor:PINK(.66)}),
  ];
  // Every branch is clothed in corallites: a pit inside a raised, paler rim, packed edge to
  // edge, finer than the radial cups the geometry carries.
  const branchMat=coralMaterial('branching-coral',{cells:46,shape:CORALLITE,relief:.55,cup:[.62,.60,.66],groove:.82,lip:.30,mottle:.22,sheen:.20,roughness:.82,transmission:.20});
  scene.add(mesh(merge(branches.map(b=>b.skeleton)),branchMat));
  const radials=mesh(merge(branches.flatMap(b=>b.radials?[b.radials]:[])),branchMat);scene.add(radials);

  // Capricornis grows in overlapping whorls, so each colony gets a second tier: a green
  // morph with a glowing margin on the right island, a red one on the left.
  const plates=[
    plateCoral([4.38,2.98,-.30],.60,180,'#3c4a2a','#a8d070',{yaw:.30,tilt:-.45,fluor:GREEN(.55)}),plateCoral([4.70,2.80,-.05],.46,183,'#3a4628','#a8d070',{yaw:.55,tilt:-.35,fluor:GREEN(.55)}),
    plateCoral([4.95,2.55,.18],.38,184,'#3a4628','#a8d070',{yaw:.75,tilt:-.50,fluor:GREEN(.55)}),
    plateCoral([-6.05,2.22,.30],.58,271,'#8a3426','#f09070',{yaw:-.30,tilt:-.40,fluor:ORANGE(.60)}),plateCoral([-5.75,1.98,.55],.46,274,'#84302a','#f09070',{yaw:-.10,tilt:-.35,fluor:ORANGE(.60)}),
    plateCoral([-4.05,supportHeight(-4.05,1.85)+.04,1.85],.36,277,'#3c4a2a','#a8d070',{yaw:.10,tilt:-.40,fluor:GREEN(.55)})];
  scene.add(mesh(merge(plates),coralMaterial('plate-coral',{cells:45,relief:.40,side:THREE.DoubleSide,roughness:.75,sheen:.35,transmission:.16,cup:[.62,.58,.70],groove:1.05})));

  // Massive colonies on the rock shoulders, half buried in it: a meandering brain on the
  // left, brown walls over green-glowing valleys, and on the right a Favia whose cups
  // carry a green oral disc between brown walls.
  const brain=brainCoral([-4.95,supportHeight(-4.95,2.05)+.10,2.05],[.66,.40,.54],-94,'#9a8458','#3e5030',{fluor:GREEN(.80)});
  // Septa: fine plates standing across each wall, perpendicular to its run. The wall's run
  // is the surface direction along which the field does not change, found per fragment
  // from the field's screen derivatives; the septa are read at a fixed pitch along it.
  scene.add(mesh(brain,coralMaterial('brain-coral',{cells:60,relief:.015,roughness:.42,specular:.6,transmission:.16,cup:[1.02,1.03,1.0],groove:.97,mottle:.12,sheen:.35,sheenColor:'#d8e0c0',
    vertex:'attribute float wall;varying float vWall;',begin:'vWall=wall;',fragment:'varying float vWall;',
    surfaceNormal:`{vec3 dpx=dFdx(-vViewPosition),dpy=dFdy(-vViewPosition),r1=cross(dpy,normal),r2=cross(normal,dpx);float det=dot(dpx,r1);
      vec3 grad=(r1*dFdx(vWall)+r2*dFdy(vWall))/(abs(det)>1e-12?det:1e-12);float gl=length(grad);
      if(gl>1e-4){vec3 run=normalize(cross(normal,grad/gl)),runWorld=(vec4(run,0.)*viewMatrix).xyz;float septa=sin(dot(vReefWorld,runWorld)*${(2*Math.PI/.012).toFixed(3)});
        float onWall=smoothstep(-.45,.15,vWall)*(1.-smoothstep(.20,.36,length(fwidth(vReefWorld))*${(1/.012).toFixed(3)}));
        normal=normalize(normal+.18*onWall*septa*run);diffuseColor.rgb*=1.+.06*onWall*septa;}}`})));
  const favia=faviaCoral([3.35,supportHeight(3.35,1.45)+.08,1.45],[.70,.44,.58],64,'#8c7450','#5a7a3a',{fluor:GREEN(.85)});
  scene.add(mesh(favia,coralMaterial('favia-coral',{cells:150,relief:.06,roughness:.55,transmission:.12,cup:[1.05,1.05,1.0],groove:.9,glow:'1.'})));

  // Zoanthid gardens: within each garden, colonies of twenty to sixty polyps packed edge to
  // edge at near-equal height, so their discs make a carpet that follows the rock. Each
  // colony is one morph — a green-eyed one with an orange ring, a tan Palythoa with lime mouths, a blue-green one with an orange mouth, a purple one with a
  // yellow mouth — and a garden mixes two. Polyps drift in hue, brightness and size, and
  // those at a colony's edge lean outward and show their columns. Zoanthids are the most
  // fluorescent animals in a reef tank.
  const MORPHS=[
    [{mouth:'#e07a2a',disc:'#3c7a34',ring:'#d86a28',tentacle:'#6a7a30',column:'#3a4a26'},{disc:GREEN(1.10),ring:ORANGE(.80)}],
    [{mouth:'#b8e060',disc:'#6e5a36',ring:'#8a7444',tentacle:'#a08a54',column:'#4a3e28'},{disc:LIME(.40),ring:LIME(.22)}],
    [{mouth:'#f08a3a',disc:'#2a6a72',ring:'#3a8a6e',tentacle:'#4a8a6a',column:'#22383a'},{disc:CYAN(.62),ring:GREEN(.60)}],
    [{mouth:'#e8c840',disc:'#6a3460',ring:'#b85888',tentacle:'#7a4470',column:'#36202e'},{disc:PINK(.62),ring:ORANGE(.38)}]];
  // [x, z, garden radius, main morph, second morph]
  const patches=[[-6.00,1.85,1.02,0,3],[-3.13,2.03,.86,1,0],[2.72,.40,.80,0,2],[-5.45,-.26,.58,2,3],[4.74,-.81,.74,1,3],[-1.30,2.05,.55,2,0],[6.95,1.80,.62,0,1],[-6.95,1.25,.55,1,2]];
  const normal=new THREE.Vector3(),out=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),q=new THREE.Quaternion(),spin=new THREE.Quaternion(),m=new THREE.Matrix4(),color=new THREE.Color(),mats=MORPHS.map(()=>({placed:[],colors:[]}));
  const zoaMat=coralMaterial('zoanthid-gardens',{cells:150,relief:.12,roughness:.45,specular:.6,side:THREE.DoubleSide,sheen:.4,sheenColor:'#c8f0a0',transmission:.24,cup:[1,1,1],groove:1,mottle:.08,glow:'1.'});
  const slope=(x,z)=>{const e=.05;return [(supportHeight(x+e,z)-supportHeight(x-e,z))/(2*e),(supportHeight(x,z+e)-supportHeight(x,z-e))/(2*e)];};
  for(const [cx,cz,size,main,second] of patches){
    const colonies=[];
    for(let tries=0;tries<160&&colonies.length<Math.round(size*size*12);tries++){
      const a=rng()*Math.PI*2,r=size*Math.sqrt(rng()),x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r*.66,R=.20+rng()*.14;
      const [dx,dz]=slope(x,z);if(Math.hypot(dx,dz)>5||supportHeight(x,z)<.15)continue;
      if(colonies.some(c=>Math.hypot(c.x-x,c.z-z)<(c.R+R)*.75))continue;
      colonies.push({x,z,R,morph:rng()<.7?main:second});
    }
    for(const {x:ox,z:oz,R,morph} of colonies){const {placed,colors}=mats[morph],count=Math.round(R*R*470);
      for(let j=0;j<count;j++){
        const a=j*2.399963+rng()*.4,rr=R*Math.sqrt((j+.5)/count),x=ox+Math.cos(a)*rr,z=oz+Math.sin(a)*rr,[dx,dz]=slope(x,z),edge=rr/R;
        if(Math.hypot(dx,dz)>6)continue;
        out.set(Math.cos(a),0,Math.sin(a));
        normal.set(-dx,1,-dz).normalize().lerp(up,.25).addScaledVector(out,.30*edge*edge).add(new THREE.Vector3((rng()-.5)*.10,0,(rng()-.5)*.10)).normalize();
        const s=.040+rng()*.014,h=.05+rng()*.012+.02*edge*edge;
        // Spun about its own axis, so the tentacle cycles of neighbours never line up.
        q.setFromUnitVectors(up,normal).multiply(spin.setFromAxisAngle(up,rng()*Math.PI*2));m.compose(new THREE.Vector3(x,supportHeight(x,z)-.03,z),q,new THREE.Vector3(s,h,s));placed.push(m.clone());
        color.setRGB(1,1,1).offsetHSL((rng()-.5)*.07,(rng()-.5)*.25,(rng()-.5)*.16);colors.push(color.r,color.g,color.b);
      }
    }
  }
  // Each morph keeps a coarse polyp beside the full one for a frugal frame, where a disc is
  // a few pixels across.
  const gardens=[];
  MORPHS.forEach(([colours,fluor],i)=>{const {placed,colors}=mats[i];if(!placed.length)return;
    const detail=polyp(colours,fluor),coarse=polyp(colours,fluor,{sides:8,tentacles:12}),zoanthids=new THREE.InstancedMesh(detail,zoaMat,placed.length);
    placed.forEach((matrix,k)=>zoanthids.setMatrixAt(k,matrix));zoanthids.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(colors),3);
    zoanthids.receiveShadow=true;zoanthids.computeBoundingSphere();scene.add(zoanthids);gardens.push({zoanthids,detail,coarse});});

  // The gorgonian fan is the one colony that bends: it stands well up into the water
  // column and sways from its holdfast. Ribs and net share one sway, read from height above
  // the holdfast, so the net never parts from the ribs it hangs between.
  const ROOT=3.30,SPAN=3.05,fan=gorgonian([6.85,ROOT,-.62],SPAN,54,'#3e1c22','#6e3e42',{yaw:-.26,order:5,thickness:.080,shorten:.90,bow:.22});
  const sway={vertex:responseGLSL+`float fanReach(vec3 p){return clamp((p.y-${ROOT.toFixed(3)})/${SPAN.toFixed(3)},0.,1.);}`,
    normal:`objectNormal.y-=.52*fanReach(position)*dot(reefResponse(position,reefTime,.85),objectNormal.xz);`,
    begin:`{float h=fanReach(position);transformed.xz+=reefResponse(position,reefTime,.85)*h*h*.30;}`};
  scene.add(mesh(fan.ribs,underwater(new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.65,sheen:.35,sheenRoughness:.5,sheenColor:new THREE.Color('#a89090')}),{key:'gorgonian-ribs',transmission:.18,...sway}),false));
  // The net: an elongated cell field in the fan's plane, its cells drawn out along the
  // radius from the holdfast as Gorgonia's mesh is. A fragment stays only on a cell wall,
  // whose width never falls much below a pixel, so the mesh thins rather than breaks up.
  scene.add(mesh(fan.net,underwater(new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.7,side:THREE.DoubleSide,sheen:.25,sheenRoughness:.5,sheenColor:new THREE.Color('#a89090')}),{key:'gorgonian-net',transmission:.30,wrap:.8,...sway,
    vertex:sway.vertex+'varying vec2 vNet;',begin:sway.begin+'vNet=uv;',
    fragment:`varying vec2 vNet;
      vec2 netHash(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}
      float netWall(vec2 p){vec2 i=floor(p),f=fract(p);float d1=8.,d2=8.;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(x,y),v=g+.15+.7*netHash(i+g)-f;float d=dot(v,v);if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;}
        return sqrt(d1/d2);}`,
    // A hole is where a point lies much nearer its own cell's centre than the next one's,
    // which rounds each hole off instead of leaving a polygon.
    // The mesh is finer toward the margin, and the holes open and close in patches.
    color:`float netR=length(vNet),netK=.75+.55*netR/${SPAN.toFixed(3)},netE=netWall(vec2(atan(vNet.x,vNet.y)*netR*20.,netR*11.)*netK),netPatch=netWall(vNet*2.3+3.1);
      float netW=1.-max((.15+.12*netPatch)*(1.-.25*netR/${SPAN.toFixed(3)}),fwidth(netE)*.8);
      if(netE<netW)discard;diffuseColor.rgb*=(.62+.42*smoothstep(netW,1.,netE))*(.80+.25*smoothstep(0.,${SPAN.toFixed(3)},netR));`}),false));
  /** Eco drops the radial corallites and draws coarse zoanthids; the colonies keep their
   *  outline and colour. */
  function setQuality(quality){
    const frugal=quality==='eco';radials.visible=!frugal;
    for(const g of gardens)g.zoanthids.geometry=frugal?g.coarse:g.detail;
  }
  return {setQuality};
}
