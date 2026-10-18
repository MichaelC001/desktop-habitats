import * as THREE from 'three';
import { noise, randomGenerator, smoothstep, clamp } from './math.js';

const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
/** Merge compatible static meshes once. No BufferGeometryUtils / additional dependency.
 *  Position, normal, uv and color are always carried (color defaults to white); any other
 *  attribute a part carries, such as fluorescence, is carried too and is zero where a part
 *  lacks it. */
export function merge(geometries){
  // Preserve indices: static coral/animal parts formerly expanded every triangle
  // into three independent vertices. Preallocation also avoids giant JS arrays.
  let count=0,indexCount=0;const sizes={position:3,normal:3,uv:2,color:3};
  for(const g of geometries){count+=g.attributes.position.count;indexCount+=g.index?g.index.count:g.attributes.position.count;
    for(const [name,attr] of Object.entries(g.attributes))sizes[name]??=attr.itemSize;}
  const out=new THREE.BufferGeometry(),arrays=Object.fromEntries(Object.entries(sizes).map(([name,size])=>[name,new Float32Array(count*size)]));
  const indices=count>65535?new Uint32Array(indexCount):new Uint16Array(indexCount);
  let offset=0,ii=0;
  for(const g of geometries){const N=g.attributes.position.count;
    for(const [name,dest] of Object.entries(arrays)){const size=sizes[name],attr=g.attributes[name];if(attr)dest.set(attr.array,offset*size);else if(name==='color')dest.fill(1,offset*size,(offset+N)*size);}
    if(g.index){for(const i of g.index.array)indices[ii++]=i+offset;}else for(let i=0;i<N;i++)indices[ii++]=i+offset;
    offset+=N;g.dispose();
  }
  for(const [name,data] of Object.entries(arrays))out.setAttribute(name,new THREE.BufferAttribute(data,sizes[name]));
  out.setIndex(new THREE.BufferAttribute(indices,1));out.computeBoundingSphere();return out;
}
function paint(g,name,fn){
  const p=g.attributes.position, c=new Float32Array(p.count*3), point=V();
  for(let i=0;i<p.count;i++) { point.fromBufferAttribute(p,i); const color=fn(point,i); c[i*3]=color.r;c[i*3+1]=color.g;c[i*3+2]=color.b; }
  g.setAttribute(name,new THREE.BufferAttribute(c,3));return g;
}
export const tint=(g,fn)=>paint(g,'color',fn);
/** Per-vertex fluorescent pigment, read as underwater()'s `fluorescence` by coralMaterial. */
export const glow=(g,fn)=>paint(g,'fluor',fn);
const BLACK=new THREE.Color(0,0,0);
// A fluorescent pigment as [colour, strength]; strength 0 is a tissue that only reflects.
const pigment=([hex,strength]=['#000000',0])=>new THREE.Color(hex).multiplyScalar(strength);

export function ellipsoid(position,scale,seed=1,detail=24) {
  const g=new THREE.SphereGeometry(1,detail,Math.round(detail*.66)),p=g.attributes.position;
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const d=1+.12*noise(x*1.3+seed,y*1.3,z*1.3)+.018*noise(x*5,y*5+seed,z*5);
    p.setXYZ(i,x*scale[0]*d+position[0],y*scale[1]*d+position[1],z*scale[2]*d+position[2]);
  }
  g.computeVertexNormals();return g;
}
export function tube(points, radii, radial=7, bump=0) {
  const pos=[],uv=[],idx=[], tangent=V(),side=V(),up=V(), ref=V(0,0,1);
  for(let j=0;j<points.length;j++) {
    const p=points[j];tangent.subVectors(points[Math.min(j+1,points.length-1)],points[Math.max(j-1,0)]).normalize();
    ref.set(0,0,1);if(Math.abs(tangent.z)>.92)ref.set(1,0,0);
    side.crossVectors(tangent,ref).normalize();up.crossVectors(side,tangent).normalize();
    for(let i=0;i<=radial;i++) {
      const a=i/radial*Math.PI*2,dx=Math.cos(a)*side.x+Math.sin(a)*up.x,dy=Math.cos(a)*side.y+Math.sin(a)*up.y,dz=Math.cos(a)*side.z+Math.sin(a)*up.z;
      // Corallite swelling is sampled at the smooth surface point, so the duplicated seam ring stays welded.
      const r=bump?radii[j]*(1+bump*noise((p.x+radii[j]*dx)*23,(p.y+radii[j]*dy)*23,(p.z+radii[j]*dz)*23)):radii[j];
      pos.push(p.x+r*dx,p.y+r*dy,p.z+r*dz);
      uv.push(i/radial,j/(points.length-1));
      if(j<points.length-1 && i<radial) {const k=j*(radial+1)+i;idx.push(k,k+radial+1,k+1,k+1,k+radial+1,k+radial+2);}
    }
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
/** Tapered, asymmetrically divided skeleton. Diameter decreases at each fork,
 *  the shaded base keeps its encrusted pigment and only the outermost branches —
 *  the ones nothing grows past — end in a pale growing tip. `order` sets how
 *  many times a stem divides, so one builder covers staghorn, needle-fine
 *  birdsnest and stubby digitata growth forms. `reach` is how far a primary stem
 *  runs before its first fork: short reach with many roots gives the dense
 *  cauliflower clump an Acropora actually grows, not a hedge of long sticks.
 *  `radials` is how many radial corallites stand per unit length of the two outer
 *  orders, `pale` how pale the growing tips go, and `fluor` the [colour, strength] of
 *  the tissue's fluorescent protein. `blunt` below .75 ends a branch in an open axial
 *  corallite, as Acropora and Seriatopora do; above it in a domed finger. Returns the
 *  `skeleton` and, apart, the `radials`, which hold half the triangles but only matter
 *  where a branch is many pixels across, so a frugal frame can leave them out. */
export function coralBranches(origin,height,width,seed,color,tip='#cfe2f2',{thickness=.026,forks=6,roots=8,order=2,taper=.62,corallite=.14,rise=.64,blunt=.7,spread=.26,reach=.80,vary=.14,radials=0,pale=.34,fluor}={}){
  const rng=randomGenerator(seed),parts=[],cups=[],base=V(...origin),c=new THREE.Color(color),tipColor=new THREE.Color(tip),F=pigment(fluor),side=V(),other=V(),out=V(),cup=!(blunt>=.75);
  const axialOf=(p,start,dir,len)=>clamp(((p.x-start.x)*dir.x+(p.y-start.y)*dir.y+(p.z-start.z)*dir.z)/len,0,1);
  const tissue=(p,axial,depth,shade,lift=0)=>{
    const t=clamp((p.y-origin[1])/height,0,1);
    return c.clone().lerp(tipColor,Math.min(1,lift+(depth?.10*axial:.05+pale*smoothstep(.55,1,axial)**1.5))).multiplyScalar(shade*(.52+.52*Math.sqrt(t))+.08*noise(p.x*15,p.y*15,p.z*15)+.07*noise(p.x*4.5+seed,p.y*4.5,p.z*4.5));};
  // The protein sits in the living tissue, densest at the growing tips and thinnest in the
  // shaded thicket at the colony's base.
  const fluoresce=(p,axial,depth,lift=0)=>F.clone().multiplyScalar((.25+.75*clamp((p.y-origin[1])/height,0,1))*(.40+(depth?.10*axial:.50*axial*axial+1.1*smoothstep(.80,1,axial))+lift));
  const skin=(g,start,dir,len,depth,shade,lift)=>{
    tint(g,p=>tissue(p,axialOf(p,start,dir,len),depth,shade,lift?.12*lift(p):0));
    return glow(g,p=>fluoresce(p,axialOf(p,start,dir,len),depth,lift?.4*lift(p):0));};
  function branch(start,dir,len,radius,depth){
    const pts=[],rs=[],bend=V((rng()-.5)*.28,.12,(rng()-.5)*.28),levels=depth?6:5,shade=.84+rng()*.32,phase=rng()*20;
    side.crossVectors(dir,Math.abs(dir.y)<.9?V(0,1,0):V(1,0,0)).normalize();other.crossVectors(dir,side);
    // Growth is never a straight extrusion: the axis wanders a little, more toward the tip.
    for(let j=0;j<=levels;j++){const t=j/levels,w=len*.035*t;
      pts.push(start.clone().addScaledVector(dir,len*t).addScaledVector(bend,len*t*t).addScaledVector(side,w*Math.sin(t*5.3+phase)).addScaledVector(other,w*Math.cos(t*4.1+phase)));
      rs.push(radius*(1-.52*t)*(1+.10*Math.sin(t*7+seed+phase)));}
    const end=pts.at(-1).clone(),rt=rs.at(-1);
    if(cup){
      // The axial corallite: a short pale tube standing proud of the branch, open at the end.
      pts.push(end.clone().addScaledVector(dir,rt*.55),end.clone().addScaledVector(dir,rt*1.15),end.clone().addScaledVector(dir,rt*.95),end.clone().addScaledVector(dir,rt*.45));
      rs.push(rt*(.86-.16*(1-blunt)),rt*(.72-.12*(1-blunt)),rt*.40,.001);
    }else{
      pts.push(end.clone().addScaledVector(dir,rt*(.50-.20*blunt)),end.clone().addScaledVector(dir,rt*(1.05-.45*blunt)),end.clone().addScaledVector(dir,rt*(1.5-.75*blunt)));
      rs.push(rt*(.42+.46*blunt),rt*(.22+.40*blunt),.001);
    }
    parts.push(skin(tube(pts,rs,depth?9:7,corallite),start,dir,len,depth,shade));
    // Radial corallites: short tubular cups leaning towards the tip, each open at its end.
    // They, not the stem, give an Acropora branch its bottlebrush outline, and each rim is
    // paler than the stem it sits on.
    if(radials&&depth<2){
      for(let k=0,n=Math.round(len*radials);k<n;k++){
        const t=.08+.86*(k+rng())/n,a=rng()*Math.PI*2,r=radius*(1-.52*t),L=r*(.50+.45*rng()),rc=r*.26;
        out.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(other,Math.sin(a));
        const foot=start.clone().addScaledVector(dir,len*t).addScaledVector(bend,len*t*t).addScaledVector(out,r*.70),d=out.clone().multiplyScalar(.80).addScaledVector(dir,.62).normalize();
        const g=tube([foot,foot.clone().addScaledVector(d,L),foot.clone().addScaledVector(d,L*.62)],[rc,rc*.86,.001],6);
        cups.push(skin(g,start,dir,len,depth,shade,p=>Math.min(1,p.distanceTo(foot)/L)));
      }
    }
    if(depth===0)return;
    for(let j=0;j<forks;j++){
      const a=rng()*Math.PI*2,idx=Math.min(levels-1,2+Math.floor(j*.65));
      const d=dir.clone().multiplyScalar(.40).add(V(Math.cos(a)*width,rise+rng()*.35,Math.sin(a)*width)).normalize();
      branch(pts[idx],d,len*(depth>1?.38+rng()*.22:.29+rng()*.18),radius*taper,depth-1);
    }
  }
  // A connected basal thicket: stems near the rim lean out and stop short, so the
  // colony carries a domed outline instead of a hedge of equal sticks.
  for(let k=0;k<roots;k++){
    const a=k*2.39996,rim=Math.sqrt(k/roots),r=rim*height*spread;
    const root=base.clone().add(V(Math.cos(a)*r,-r*.25,Math.sin(a)*r*.7));
    branch(root,V(Math.cos(a)*(.16+.60*rim),.95,Math.sin(a)*(.13+.48*rim)).normalize(),height*(reach-.30*rim*reach/.8+rng()*vary),height*thickness*(.9+rng()*.2),order);
  }
  // The colony grows from an encrusting plate that spreads over the rock and swallows the
  // stem bases, so no stick visibly stands in a hole.
  const R=height*(spread*.62+thickness*1.5),foot=ellipsoid([base.x,base.y-R*.12,base.z],[R,R*.22,R*.72],seed,16);
  // Its skin darkens toward the rock and fades into the encrusting coralline it overgrows.
  const ROCK=new THREE.Color('#3a2638');tint(foot,p=>c.clone().lerp(ROCK,.45).multiplyScalar(.50+.10*noise(p.x*9,p.y*9,p.z*9)));glow(foot,()=>F.clone().multiplyScalar(.15));parts.push(foot);
  return {skeleton:merge(parts),radials:cups.length?merge(cups):null};
}
/** Planar gorgonian, a Gorgonia sea fan: a few stout ribs fork dichotomously in one gently
 *  bowed plane, and a fine anastomosing net fills the plane between them. The ribs are
 *  geometry; the net is a sheet over the colony's outline whose mesh the material cuts
 *  out, because thousands of sub-millimetre filaments as tubes would alias into noise.
 *  The sheet's uv is its position in the fan plane in tank units, from the holdfast. */
export function gorgonian(origin,height,seed,color,tip,{order=6,thickness=.085,stems=3,yaw=0,bow=.13,split=.27,shorten=.85}={}){
  const rng=randomGenerator(seed),parts=[],c=new THREE.Color(color),tipColor=new THREE.Color(tip);
  const ax=V(Math.cos(yaw),0,Math.sin(yaw)),normal=V(-Math.sin(yaw),0,Math.cos(yaw)),o=V(...origin);
  // Bowed across and rippled: a living fan is never a flat plane, and turns edge-on in places.
  const place=(u,v)=>o.clone().addScaledVector(ax,u).addScaledVector(normal,-bow*u*u+.07*Math.sin(v*2.3+u*1.7+seed)*Math.min(1,Math.hypot(u,v))).add(V(0,v,0));
  // The outline: how far the ribs reach in each direction from the holdfast.
  const BINS=40,ARC=1.5*Math.PI,reachOf=new Float32Array(BINS),bin=(u,v)=>clamp(Math.floor((Math.atan2(u,v)/ARC+.5)*BINS),0,BINS-1);
  function limb(u,v,angle,len,radius,depth){
    const pts=[],rs=[],curl=(rng()-.5)*.8,grown=(order-depth)/order;
    let uu=u,vv=v;
    for(let j=0;j<=3;j++){
      if(j){const a=angle+curl*(j-.5)/3;uu+=Math.sin(a)*len/3;vv+=Math.cos(a)*len/3;}
      pts.push(place(uu,vv));rs.push(radius*(depth?1-.2*j/3:1-.6*j/3));
      const b=bin(uu,vv);reachOf[b]=Math.max(reachOf[b],Math.hypot(uu,vv+.12));
    }
    const g=tube(pts,rs,depth>2?7:5);
    // Polyp-bearing twigs carry the pale tissue; the shaded trunk keeps the bare axis colour.
    tint(g,p=>c.clone().lerp(tipColor,grown*.45).multiplyScalar(.70+.30*grown+.08*noise(p.x*9,p.y*9,p.z*9)));
    parts.push(g);
    if(depth===0)return;
    for(const s of [-1,1])limb(uu,vv,angle+curl+s*split*(.65+rng()*.75),len*(shorten+rng()*.10),radius*.80,depth-1);
  }
  for(let k=0;k<stems;k++)limb((k-(stems-1)/2)*.16,-.12,(k-(stems-1)/2)*.3,.95+rng()*.2,thickness,order);
  // Smooth the outline lightly, so the net's margin follows the twig tips without stepping.
  // Smoothing only ever widens it: a lone long twig carries the net out with it rather
  // than standing bare past the margin.
  {const r=reachOf.slice();for(let i=0;i<BINS;i++)reachOf[i]=Math.max(r[i],(r[Math.max(0,i-1)]+2*r[i]+r[Math.min(BINS-1,i+1)])/4);}
  // The net, a polar grid over the outline. Its rim runs raggedly through the twig tips,
  // so the fan's edge is where its branches end.
  const RINGS=36,pos=[],uv=[],idx=[],sheetColor=[],point=V();
  for(let j=0;j<=RINGS;j++)for(let i=0;i<BINS;i++){
    const a=((i+.5)/BINS-.5)*ARC,s=j/RINGS,r=s*reachOf[i]*(.99+.03*noise(i*.7,seed,0)),u=Math.sin(a)*r,v=Math.cos(a)*r-.12;
    point.copy(place(u,v));pos.push(point.x,point.y,point.z);uv.push(u,v+.12);
    const col=c.clone().lerp(tipColor,.30+.30*s).multiplyScalar(.80+.12*noise(u*6,v*6,seed));sheetColor.push(col.r,col.g,col.b);
    if(j<RINGS&&i<BINS-1){const k=j*BINS+i;idx.push(k,k+1,k+BINS,k+1,k+BINS+1,k+BINS);}
  }
  const net=new THREE.BufferGeometry();net.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));net.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  net.setAttribute('color',new THREE.Float32BufferAttribute(sheetColor,3));net.setIndex(idx);net.computeVertexNormals();
  // Forking depth, not arithmetic, decides how tall the colony grows: scale the
  // finished meshes so `height` is the reach above the holdfast it says it is.
  const ribs=merge(parts);let top=origin[1];
  for(let i=0,p=ribs.attributes.position;i<p.count;i++)top=Math.max(top,p.getY(i));
  const k=height/(top-origin[1]),about=new THREE.Matrix4().makeTranslation(...origin).multiply(new THREE.Matrix4().makeScale(k,k,k)).multiply(new THREE.Matrix4().makeTranslation(-origin[0],-origin[1],-origin[2]));
  ribs.applyMatrix4(about);net.applyMatrix4(about);
  for(let i=0,t=net.attributes.uv;i<t.count;i++)t.setXY(i,t.getX(i)*k,t.getY(i)*k);
  ribs.computeBoundingSphere();net.computeBoundingSphere();return {ribs,net};
}
/** The upper cap of a lumpy sphere, for a massive colony half sunk in the rock: `reach` is
 *  how far down from the crown, in radians, the surface runs. */
// A sphere's seam column and crown repeat their vertices, so computed normals split there
// into a visible crease; average the normals of every set of coincident vertices.
function weldNormals(g){
  const p=g.attributes.position,n=g.attributes.normal,groups=new Map();
  for(let i=0;i<p.count;i++){const key=`${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;(groups.get(key)??groups.set(key,[]).get(key)).push(i);}
  const sum=V();
  for(const ids of groups.values())if(ids.length>1){sum.set(0,0,0);for(const i of ids)sum.x+=n.getX(i),sum.y+=n.getY(i),sum.z+=n.getZ(i);sum.normalize();for(const i of ids)n.setXYZ(i,sum.x,sum.y,sum.z);}
  return g;
}
function dome(scale,seed,width,rings,reach,displace){
  const g=new THREE.SphereGeometry(1,width,rings,0,Math.PI*2,0,reach),p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),d=(1+.13*noise(x*1.6+seed,y*1.6,z*1.6))*displace(x,y,z,i);
    p.setXYZ(i,x*scale[0]*d,y*scale[1]*d,z*scale[2]*d);
  }
  return g;
}
/** A meandroid brain coral (Platygyra): long, branching valleys of even width between
 *  rounded walls over a smooth dome. The pattern is the sign of a random monochromatic
 *  wave field, a sum of equal-wavelength waves in random directions, whose nodal domains
 *  form exactly this kind of labyrinth. It is laid on the dome triplanarly, each axis plane
 *  carrying its own field and the plane most nearly facing the surface dominating, so the
 *  valleys keep their width down the dome's sides instead of pinching toward the crown.
 *  The walls are the narrower positive domains. The `wall` attribute carries the field to
 *  the material, which draws the septa across the walls from its gradient. */
export function brainCoral(origin,scale,seed,wall,valley,{wavelength=.09,relief=.05,fluor,waves=40,spread=.8}={}){
  // `spread` narrows each plane's wave directions about its own axis, which draws the
  // domains out into long meanders rather than round blobs and worms.
  const rng=randomGenerator(seed),k=2*Math.PI/wavelength,planes=[0,1,2].map(()=>{const axis=rng()*Math.PI;return Array.from({length:waves},(_,i)=>{const a=axis+spread*Math.PI*((i+rng())/waves-.5);return [Math.cos(a)*k,Math.sin(a)*k,rng()*Math.PI*2];});});
  const wave=(field,u,v)=>{let f=0;for(const [ku,kv,phase] of field)f+=Math.cos(ku*u+kv*v+phase);return f*Math.sqrt(2/waves);};
  const field=(x,y,z)=>{const px=x*scale[0],py=y*scale[1],pz=z*scale[2],n=[x/scale[0],y/scale[1],z/scale[2]],l=Math.hypot(...n),w=n.map(c=>(Math.abs(c)/l)**4),sum=w[0]+w[1]+w[2];
    let f=0;if(w[0]>.01*sum)f+=w[0]*wave(planes[0],py,pz);if(w[1]>.01*sum)f+=w[1]*wave(planes[1],px,pz);if(w[2]>.01*sum)f+=w[2]*wave(planes[2],px,py);
    return f/Math.sqrt(w[0]*w[0]+w[1]*w[1]+w[2]*w[2]);};
  // Rounded, fleshy walls rising from broad valley floors.
  const profile=f=>2*smoothstep(-.40,.40,f)-1;
  const fs=[],g=dome(scale,seed,360,120,1.95,(x,y,z,i)=>{fs[i]=field(x,y,z);return 1+relief*profile(fs[i]);});
  g.translate(...origin);g.computeVertexNormals();weldNormals(g);
  const W=new THREE.Color(wall),Vl=new THREE.Color(valley),F=pigment(fluor),up=q=>clamp((q.y-origin[1])/scale[1]/(1+relief),0,1),wallness=i=>.5+.5*profile(fs[i]);
  // Tissue over a living skeleton is never one flat albedo: the wall colour drifts across the
  // colony, the valley floors in the walls' shade hold their own darker tone, and the rim
  // where the colony meets the rock goes dark.
  tint(g,(q,i)=>{const w=wallness(i),y=up(q),drift=.86+.28*noise(q.x*2.4+seed,q.y*2.4,q.z*2.4)+.10*noise(q.x*9,q.y*9,q.z*9);
    return Vl.clone().lerp(W,smoothstep(.30,.85,w)).multiplyScalar((.45+.50*smoothstep(0,.35,y))*drift*(.80+.20*smoothstep(.0,.35,w)));});
  // The oral discs lining the valleys carry the fluorescent protein; the walls do not.
  glow(g,(q,i)=>F.clone().multiplyScalar((1-smoothstep(.25,.65,wallness(i)))*(.4+.6*up(q))));
  g.setAttribute('wall',new THREE.Float32BufferAttribute(fs,1));
  return g;
}
/** Massive stony colony with plocoid corallites (Favia): round cups packed over the dome,
 *  each a green oral disc sunk inside a raised wall, neighbours parted by a narrow groove.
 *  The cups are the cells of a jittered 3D lattice read on the dome; within one, r runs
 *  from the cup's centre (0) to the groove it shares with a neighbour (1). */
export function faviaCoral(origin,scale,seed,wall,disc,{cell=.11,relief=.05,fluor}={}){
  const mean=(scale[0]+scale[2])/2,hash=(i,j,k,n)=>{const v=Math.sin(i*127.1+j*311.7+k*74.7+n*53.3+seed)*43758.5453;return v-Math.floor(v);};
  const cup=(x,y,z)=>{const px=x*mean/cell,py=y*mean/cell,pz=z*mean/cell,ix=Math.floor(px),iy=Math.floor(py),iz=Math.floor(pz);let d1=9,d2=9;
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){const i=ix+a,j=iy+b,k=iz+c,dx=i+.15+.7*hash(i,j,k,0)-px,dy=j+.15+.7*hash(i,j,k,1)-py,dz=k+.15+.7*hash(i,j,k,2)-pz,d=dx*dx+dy*dy+dz*dz;
      if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;}
    d1=Math.sqrt(d1);return 2*d1/(d1+Math.sqrt(d2));};
  const profile=r=>-.8*(1-smoothstep(.05,.64,r))+.40*Math.exp(-(((r-.78)/.12)**2))-.18*smoothstep(.84,1,r);
  const radial=[],g=dome(scale,seed,440,130,1.95,(x,y,z,i)=>{radial[i]=cup(x,y,z);return 1+relief*profile(radial[i]);});
  g.translate(...origin);g.computeVertexNormals();weldNormals(g);
  const W=new THREE.Color(wall),D=new THREE.Color(disc),F=pigment(fluor),up=q=>clamp((q.y-origin[1])/scale[1],0,1);
  tint(g,(q,i)=>{const r=radial[i],drift=.86+.28*noise(q.x*2.4+seed,q.y*2.4,q.z*2.4)+.10*noise(q.x*9,q.y*9,q.z*9);
    return D.clone().lerp(W,smoothstep(.58,.74,r)).multiplyScalar((.62+.30*up(q))*drift*(.75+.25*smoothstep(0,.4,r))*(1-.35*smoothstep(.86,1,r)));});
  return glow(g,(q,i)=>F.clone().multiplyScalar((1-smoothstep(.48,.68,radial[i]))*(.5+.5*up(q))));
}
/** One zoanthid of unit radius and height, standing on the origin, for instancing: a
 *  column rising from a skirt sunk below the rock, an oral disc dished around a raised
 *  mouth and banded from mouth to margin, and two staggered cycles of slender marginal
 *  tentacles, the inner one raised and the outer spread flat. `colours` names the mouth,
 *  the disc, the ring the disc's margin carries, the tentacles and the column; `fluor`
 *  the pigments of the disc and the margin. Rendered double sided, so the tentacle blades
 *  and the cup light either way. `sides` and `tentacles` set its detail. */
export function polyp({mouth,disc,ring,tentacle,column},{disc:discGlow,ring:ringGlow}={},{sides=16,tentacles=20}={}){
  const pos=[],col=[],fl=[],idx=[];
  const [m,d,r,t,s]=[mouth,disc,ring,tentacle,column].map(h=>new THREE.Color(h)),Fd=pigment(discGlow),Fr=pigment(ringGlow);
  const put=(x,y,z,c,f=BLACK)=>{pos.push(x,y,z);col.push(c.r,c.g,c.b);fl.push(f.r,f.g,f.b);return pos.length/3-1;};
  // Rings bottom-up as [radius, height, colour, fluorescence]: the sunk skirt, the column,
  // its flare to the margin, then inward across the disc to the lips.
  const rings=[[.62,-.35,s.clone().multiplyScalar(.30)],[.58,.35,s.clone().multiplyScalar(.65)],[.70,.80,s],[.80,.96,r,Fr],[.70,.92,r,Fr],[.52,.88,d,Fd],[.24,.86,d.clone().lerp(m,.35),Fd],[.10,.90,m,Fr]];
  for(const [radius,h,c,f] of rings)for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2;put(Math.cos(a)*radius,h,Math.sin(a)*radius,c,f);}
  const apex=put(0,.86,0,m.clone().multiplyScalar(.5),Fr);
  for(let k=0;k<rings.length-1;k++)for(let i=0;i<sides;i++){const a=k*(sides+1)+i,b=a+sides+1;idx.push(a,b,a+1,a+1,b,b+1);}
  const last=(rings.length-1)*(sides+1);for(let i=0;i<sides;i++)idx.push(apex,last+i+1,last+i);
  // Each tentacle is a tapering blade with a crease along it, from the margin outward.
  const tc=t.clone().multiplyScalar(.85),tipC=t.clone().lerp(new THREE.Color(1,1,1),.25);
  // Each is a narrow spatula with a rounded end: two flanks and a blunt tip, lengths uneven.
  for(let cycle=0;cycle<2;cycle++)for(let i=0;i<tentacles;i++){
    const a=(i+cycle*.5)/tentacles*Math.PI*2,w=.065,L=(cycle?.30:.24)*(.8+.4*Math.abs(Math.sin(i*12.9898+cycle*4.1))),lift=cycle?.03:.14,r0=.76;
    const Ft=Fr.clone().multiplyScalar(.4),at=(da,r,y,c)=>put(Math.cos(a+da)*r,y,Math.sin(a+da)*r,c,Ft),R=r0+L;
    const b1=at(-w,r0,.95,tc),b2=at(w,r0,.95,tc),m1=at(-w*.85,r0+L*.6,.96+lift*.7,t),m2=at(w*.85,r0+L*.6,.96+lift*.7,t);
    const t1=at(-w*.45,R,.95+lift,tipC),t2=at(w*.45,R,.95+lift,tipC);
    idx.push(b1,m1,b2,b2,m1,m2,m1,t1,m2,m2,t1,t2);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));geo.setAttribute('fluor',new THREE.Float32BufferAttribute(fl,3));
  geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
/** Montipora capricornis: a thin whorl growing out from the rock along one attached edge,
 *  thickest there and thinning to a rounded, wavy growing margin. The outline is a lobe
 *  closing back onto the ends of that edge, the surface undulates and one side climbs over
 *  the other, and the margin carries the pale, still-calcifying band. `center` is where the
 *  plate's middle sits, `yaw` the direction it grows toward, away from the rock, and
 *  `tilt` how far its margin is lifted (negative lets it droop, facing the viewer). */
export function plateCoral(center,radius,seed,color,rim,{yaw=0,tilt=0,span=3.0,fluor}={}){
  const rng=randomGenerator(seed),phase=rng()*6,c=new THREE.Color(color),edge=new THREE.Color(rim),F=pigment(fluor);
  const RINGS=28,SIDES=88,dir=V(Math.sin(yaw),0,Math.cos(yaw)),side=V(Math.cos(yaw),0,-Math.sin(yaw)),hold=V(...center).addScaledVector(dir,-radius*.42),attach=radius*.42;
  const pos=[],col=[],fl=[],idx=[];
  // The outline closes to the holdfast at both ends of the sector, so the plate is a rounded lobe with no cut edge.
  const reach=a=>radius*(1+.10*Math.sin(a*3.1+phase)+.05*Math.sin(a*7.3-phase))*Math.pow(Math.cos(a/span*Math.PI),.45);
  const put=(p,color,f)=>{pos.push(p.x,p.y,p.z);col.push(color.r,color.g,color.b);fl.push(f.r,f.g,f.b);};
  // Top and bottom grids share their outline, so the margin rounds over instead of ending
  // in a knife edge.
  for(const face of [1,-1])for(let j=0;j<=RINGS;j++)for(let i=0;i<=SIDES;i++){
    const a=(i/SIDES-.5)*span,s=j/RINGS,r=reach(a)*s,th=radius*(.022*(1-s)+.008*(1-s*s)+.005);
    // A whorl, not a dish: one side of the plate climbs above the other, and the margin waves.
    const y=radius*(.04*s*s+.05*s*s*Math.sin(2*a+phase)+.03*s*Math.sin(5*a-phase)+.035*s*s*s*Math.sin(9*a+phase*1.7)+.04*smoothstep(.70,1,s)+.10*s*a/span)+face*th*.5;
    const p=hold.clone().addScaledVector(side,attach*2*a/span).add(V(Math.sin(yaw+a*.6)*r,y,Math.cos(yaw+a*.6)*r));
    // Concentric growth bands, a faint radial grain and a slow drift of pigment across the
    // plate; the margin is a narrow pale band, the underside bare and dull.
    const margin=smoothstep(.86,1,s),n=noise(p.x*25,p.y*25,p.z*25),band=Math.sin(s*radius*95+2.5*noise(a*2,s*3,seed)),grain=Math.sin(a*reach(a)*s*160+3*noise(s*4,a,seed));
    const seat=.55+.45*smoothstep(0,.25,s);
    put(p,face>0?c.clone().lerp(edge,margin*.80+.10*Math.max(0,band)*s).multiplyScalar((.78+.14*s+.06*n+.08*band+.05*grain)*(.85+.3*noise(p.x*4+seed,p.y*4,p.z*4))*seat):c.clone().lerp(edge,.25).multiplyScalar((.45+.12*s)*seat),
      F.clone().multiplyScalar(face>0?(.25+.75*margin)*(.8+.2*band):.05));
  }
  const W=SIDES+1,B=(RINGS+1)*W,T=(j,i)=>j*W+i;
  for(let j=0;j<RINGS;j++)for(let i=0;i<SIDES;i++){const k=T(j,i);idx.push(k,k+W,k+1,k+1,k+W,k+W+1,B+k,B+k+1,B+k+W,B+k+1,B+k+W+1,B+k+W);}
  for(let i=0;i<SIDES;i++){const t=T(RINGS,i),b=B+t;idx.push(t,b,t+1,t+1,b,b+1);}
  for(let j=0;j<RINGS;j++){let t=T(j,0),b=B+t;idx.push(t,b,t+W,t+W,b,b+W);t=T(j,SIDES);b=B+t;idx.push(t,t+W,b,t+W,b+W,b);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));geo.setAttribute('fluor',new THREE.Float32BufferAttribute(fl,3));geo.setIndex(idx);
  // Capricornis whorls stand on edge; a tilted plate shows the camera its coloured face instead of a sliver.
  if(tilt)geo.applyMatrix4(new THREE.Matrix4().makeTranslation(hold.x,hold.y,hold.z).multiply(new THREE.Matrix4().makeRotationAxis(V(Math.cos(yaw),0,-Math.sin(yaw)),-tilt)).multiply(new THREE.Matrix4().makeTranslation(-hold.x,-hold.y,-hold.z)));
  geo.computeVertexNormals();return geo;
}
