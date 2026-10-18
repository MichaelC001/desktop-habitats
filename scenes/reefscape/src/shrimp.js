import * as THREE from 'three';
import { merge, tint, tube } from './geometry.js';
import { underwater, responseGLSL } from './water.js';
import { supportHeight } from './terrain.js';
import { SHRIMP, seatShrimp } from './simulation.js';
import { clamp, lerp, smoothstep } from './math.js';
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
// Lysmata amboinensis in side view, measured off aquarium photographs and scaled to the
// simulation's body (rostrum to telson about one unit). The body is one shell lofted along
// a curved spine: a carapace a little over a third of the length, then six abdominal
// somites that keep level to the third, where the abdomen bends down in the caridean hump
// and carries the tail fan low behind. Each station is the arc length back from the front
// of the carapace, the spine's heading there (positive descends going back), and the half
// height above the spine, below it, and the half width. The section is about two thirds as
// wide as it is deep, and deepest at the second somite, whose pleura hang lowest.
const STATIONS=[
  [-.05,-.12,.060,.070,.042],
  [0,   -.10,.060,.070,.042],
  [.06, -.07,.072,.084,.048],
  [.18, -.02,.080,.092,.054],
  [.30,  .00,.077,.090,.051],
  [.36,  .00,.073,.090,.048],
  [.44, -.16,.069,.096,.046],
  [.52,  .02,.066,.100,.044],
  [.595, .74,.060,.086,.040],
  [.665, .86,.053,.070,.036],
  [.73,  .74,.046,.057,.033],
  [.79,  .60,.038,.042,.027],
  [.845, .55,.030,.032,.023]];
// Where each plate starts: the carapace, then somites one to six.
const PLATES=[-.05,.36,.44,.52,.595,.665,.73,.845];
const SIDES=40,CARAPACE=PLATES[1];
// Spine centre at mid-carapace, in the model's frame, where the ground is at y = -.132.
const MID=V(.11,.064,0);
function station(a) {
  let k=0;while(k<STATIONS.length-2&&a>STATIONS[k+1][0])k++;
  const [a0,...p]=STATIONS[k],[a1,...q]=STATIONS[k+1],t=smoothstep(a0,a1,a);
  return p.map((v,i)=>lerp(v,q[i],t));
}
// The spine, integrated once from the headings: x, y and the heading at each step of arc.
const SPINE=(()=>{
  const step=.0025,out=[];let x=0,y=0;
  for(let a=STATIONS[0][0];a<=PLATES.at(-1)+.06;a+=step){const [heading]=station(a);out.push([a,x,y,heading]);x-=Math.cos(heading)*step;y-=Math.sin(heading)*step;}
  const mid=out[Math.round((.20-out[0][0])/step)];
  return {step,points:out.map(([a,px,py,h])=>[a,px-mid[1]+MID.x,py-mid[2]+MID.y,h])};
})();
// The spine's centre, its backward tangent and its dorsal normal at arc length a.
function spine(a) {
  const pts=SPINE.points,i=clamp((a-pts[0][0])/SPINE.step,0,pts.length-1.001),j=Math.floor(i),t=i-j,[,x0,y0,h0]=pts[j],[,x1,y1,h1]=pts[j+1];
  const heading=lerp(h0,h1,t);
  return {centre:V(lerp(x0,x1,t),lerp(y0,y1,t),0),back:V(-Math.cos(heading),-Math.sin(heading),0),up:V(-Math.sin(heading),Math.cos(heading),0)};
}
// The abdomen bends about the joint at the carapace's rear margin.
const JOINT=spine(CARAPACE).centre;
const n=x=>Number(x).toFixed(5);
// The body's uv says which pattern a fragment takes. On the lofted shell uv.x is 1 plus the
// arc length a back from the front of the carapace and uv.y the distance round the section
// from the dorsal midline, so stripes painted on them keep their width in the water; the
// vertex colour carries how far round toward the belly (0 dorsal, 1 ventral), how far
// along its own plate, and which side. 2–2.9 is a uropod blade and 3–3.9 the telson, the
// fraction past the integer being how far toward the blade's tip and uv.y how far across
// it toward its outer edge; 4 is an eye. Anything else keeps its vertex colour.
const UROPOD=2,TELSON=3,EYE=4;
function shell() {
  const rings=[];
  // Each plate's front tucks under the rear margin of the one ahead, so the shell steps in
  // at every joint; the abdominal pleura are lobes whose lower margin is deepest mid-plate.
  for(let k=0;k<PLATES.length-1;k++){
    const a0=PLATES[k],a1=PLATES[k+1],count=k?7:22;
    for(let j=0;j<=count;j++){
      const f=j/count,a=a0+(a1-a0)*(k?f:Math.sqrt(f)),tuck=k&&j===0?.95:.965+.035*smoothstep(0,.8,f);
      rings.push({a,f,tuck,lobe:k?.90+.10*Math.sin(Math.PI*Math.min(1,f*1.08)):1});
    }
  }
  // The sixth somite closes inside the base of the tail fan.
  rings.push({a:PLATES.at(-1)+.004,f:1,tuck:.55,lobe:1},{a:PLATES.at(-1)+.008,f:1,tuck:0,lobe:1});
  const p=[],uv=[],color=[],index=[],ring=[];
  for(const {a,f,tuck,lobe} of rings){
    const {centre,up}=spine(a),[,top,bottom,width]=station(a);
    // The rostrum's base sits high: the front of the carapace rounds off under it.
    const nose=a<.0?Math.sqrt(Math.max(0,1-(a/.05)**2)):1;
    ring.length=0;
    for(let i=0;i<=SIDES;i++){
      const t=i/SIDES*Math.PI*2,c=Math.cos(t),s=Math.sin(t);
      // Flat-sided and narrowing to the sternum under the legs: an arch, not a tube.
      // A smooth ellipse over the back, with the sides a little flattened and drawn in under
      // the legs; any sharper corner reads as a moulded prism.
      const y=(c>=0?top:bottom*lobe)*c*tuck*nose;
      const z=width*s*(1+.14*s*s)/1.14*(1-.30*Math.max(0,-c)**2)*tuck*nose;
      ring.push(V(centre.x+up.x*y,centre.y+up.y*y,z));
    }
    let around=[0];for(let i=1;i<=SIDES;i++)around.push(around[i-1]+ring[i].distanceTo(ring[i-1]));
    const half=around[SIDES]/2||1;
    ring.forEach((q,i)=>{const d=Math.min(around[i],2*half-around[i]);p.push(q.x,q.y,q.z);uv.push(1+a,d);color.push(d/half,f,i<SIDES/2?1:0);});
  }
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<SIDES;i++){const k=j*(SIDES+1)+i;index.push(k,k+SIDES+1,k+1,k+1,k+SIDES+1,k+SIDES+2);}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(color,3));
  g.setIndex(index);g.computeVertexNormals();return g;
}
// A thin rounded blade: a tail-fan lobe or the antennal scale. It points along `direction`
// from `base`, lying in the plane of `direction` and `across`, broadest past its middle and
// cupped a little, as the uropods are.
function blade(base,direction,across,length,width,thick,code,outer=1) {
  const g=new THREE.SphereGeometry(1,16,8),p=g.attributes.position,uv=g.attributes.uv,q=V(0,0,0),d=direction.clone().normalize(),w=across.clone().normalize(),up=d.clone().cross(w).normalize();
  for(let i=0;i<p.count;i++) {
    const a=p.getX(i),b=p.getY(i),c=p.getZ(i),t=(1-a)/2;
    const breadth=width*(.40+.60*Math.sin(Math.PI*Math.min(1,t*.72+.12)));
    q.copy(base).addScaledVector(d,t*length).addScaledVector(w,c*breadth/2).addScaledVector(up,b*thick/2*(1-.7*t)+thick*.9*c*c);
    p.setXYZ(i,q.x,q.y,q.z);uv.setXY(i,code+t*.9,(outer*c+1)/2);
  }
  g.computeVertexNormals();return g;
}
// Everything that is not shell or tail fan keeps its vertex colour.
function plain(g,color){const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setX(i,-1);return tint(g,typeof color==='function'?color:()=>new THREE.Color(color));}
// Nothing on the animal is textured, so its appendages carry their animation parameters in
// uv instead: x is the appendage's code, y how far along it the vertex sits. Codes 0 and 1
// are the two chelate pairs, 2-4 the ambulatory pereiopods, 5 the third maxillipeds, 6-10
// the pleopods front to back, and on the antenna mesh 0 is the long flagellum.
function limb(points,radii,code,radial=5){const g=tube(points,radii,radial),uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setX(i,code);return g;}
// A jointed appendage: each article swells a little between joints and pinches at them, and
// the joints carry a ring of their own colour. `joints` are the ends of the articles.
// geometry.js's tube picks each ring's frame afresh, which twists a leg that runs out
// sideways into a ribbon; a jointed leg carries one frame down its length instead.
function carried(points,radii,radial) {
  const pos=[],uv=[],idx=[],tangent=V(0,0,0),side=V(0,0,0),up=V(0,0,0),last=V(0,0,0),turn=new THREE.Quaternion();
  for(let j=0;j<points.length;j++){
    tangent.subVectors(points[Math.min(j+1,points.length-1)],points[Math.max(j-1,0)]).normalize();
    if(j===0)side.set(0,1,0).cross(tangent).normalize();else side.applyQuaternion(turn.setFromUnitVectors(last,tangent));
    last.copy(tangent);up.crossVectors(side,tangent);
    for(let i=0;i<=radial;i++){
      const a=i/radial*Math.PI*2,c=Math.cos(a),s=Math.sin(a),p=points[j],r=radii[j];
      pos.push(p.x+r*(c*side.x+s*up.x),p.y+r*(c*side.y+s*up.y),p.z+r*(c*side.z+s*up.z));uv.push(i/radial,j/(points.length-1));
      if(j<points.length-1&&i<radial){const k=j*(radial+1)+i;idx.push(k,k+radial+1,k+1,k+1,k+radial+1,k+radial+2);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
function jointed(joints,radii,code,color,jointColor,radial=8,steps=5){
  const pts=[],rs=[],mark=[];
  for(let k=0;k<joints.length-1;k++)for(let m=0;m<steps;m++){
    const t=m/steps;pts.push(joints[k].clone().lerp(joints[k+1],t));
    rs.push(lerp(radii[k],radii[k+1],t)*(m===0&&k?.80:1+(k?.10:0)*Math.sin(Math.PI*t)));mark.push(m===0&&k?1:0);
  }
  pts.push(joints.at(-1));rs.push(radii.at(-1));mark.push(0);
  const g=carried(pts,rs,radial),uv=g.attributes.uv,base=new THREE.Color(color),ring=new THREE.Color(jointColor),out=new THREE.Color();
  // Along is arc length, not sample count, so the gait's weighting runs true down the leg.
  const length=[0];for(let i=1;i<pts.length;i++)length.push(length[i-1]+pts[i].distanceTo(pts[i-1]));
  for(let i=0;i<uv.count;i++)uv.setXY(i,code,length[Math.floor(i/(radial+1))]/length.at(-1));
  return tint(g,(p,i)=>{const j=Math.floor(i/(radial+1));return out.copy(base).lerp(ring,mark[j]*.75).multiplyScalar(1-.25*Math.max(0,(length[j]/length.at(-1)-.85)/.15));});
}
// Rearing up at a client pivots on the rear walking pair, so the head lifts and the tail
// settles toward the rock, instead of the whole animal see-sawing about its middle.
const PIVOT=V(-.10,-.15,0);
// Where the walking pairs' feet end (SHRIMP.feet, which the simulation tests footholds
// with). The seat reads the ground under them, and each leg then stretches or folds by up
// to SHRIMP.stretch to put its own foot on that ground; past that an outside foot over a
// drop simply hangs, as it does on a real shoulder.
const foot=(j,sign)=>{const [a,y,b]=SHRIMP.feet[j-2];return V(a,y,sign*b);};
const FEET=[2,3,4].flatMap(j=>[-1,1].map(sign=>foot(j,sign)));
// The carapace takes the ground's pitch only so far. A shrimp walking off a ledge does not
// hang head down from it: it keeps its head up and lets the abdomen follow the rock, so
// what the body's line needs beyond these is taken up by bending the abdomen.
const HEAD_DOWN=.26,HEAD_UP=.34,TAIL_BEND=.55,TAIL_LIFT=.60,SETTLE=.16;
// The caridoid escape folds the abdomen under the thorax about the joint behind the
// carapace until the tail fan meets it — 25 degrees between the two, in Arnott's high-speed
// frames. The same bend, smaller and either way, carries the tail along the rock. Every
// mesh carrying abdominal parts bends about it, so the pleopods come with.
const BEND=`float behind=max(0.,${n(JOINT.x)}-position.x),bend=(shrimpPose.w*4.+shrimpTail*2.)*behind;
  float bendC=cos(bend),bendS=sin(bend);`;
const FLEX=`${BEND}
  vec2 arm=transformed.xy-vec2(${n(JOINT.x)},${n(JOINT.y)});
  transformed.xy=vec2(${n(JOINT.x)}+arm.x*bendC-arm.y*bendS,${n(JOINT.y)}+arm.x*bendS+arm.y*bendC);`;
const FLEX_NORMAL=`{${BEND}objectNormal.xy=vec2(objectNormal.x*bendC-objectNormal.y*bendS,objectNormal.x*bendS+objectNormal.y*bendC);}`;
function flexed(p,curl,tail,out) {
  const bend=(curl*4+tail*2)*Math.max(0,JOINT.x-p.x),c=Math.cos(bend),s=Math.sin(bend),x=p.x-JOINT.x,y=p.y-JOINT.y;
  return out.set(JOINT.x+x*c-y*s,JOINT.y+x*s+y*c,p.z);
}
const NOISE=`float shrimpHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float shrimpNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(shrimpHash(i),shrimpHash(i+vec2(1,0)),f.x),mix(shrimpHash(i+vec2(0,1)),shrimpHash(i+vec2(1,1)),f.x),f.y);}
float shrimpCells(vec2 p,float density){vec2 id=floor(p),q=fract(p)-.5-(vec2(shrimpHash(id+3.1),shrimpHash(id+7.7))-.5)*.45;float r=.20+.16*shrimpHash(id+1.3);return step(shrimpHash(id+5.9),density)*(1.-smoothstep(r*.55,r,length(q)));}`;
// Lysmata amboinensis: a broad scarlet band down each side of the back, split by a narrow
// white median stripe from the rostrum to the tail, where it opens into a white bar across
// the sixth somite and the base of the telson. Below the red the shell is clear amber, and
// what shows through it is the animal: the liver as a darker mass low in the carapace, the
// gut along the abdomen, the striated abdominal muscle. Red chromatophores break the band's
// lower edge into dots. The tail fan is red, each uropod white at its base and with a white
// spot toward its tip.
const SHELL_COLOR=`
  float shellRough=.40;
  if(vShellUv.x>.5){
    vec3 white=vec3(.78,.77,.74);
    vec3 shell=vColor.rgb;
    if(vShellUv.x<1.95){
      float a=vShellUv.x-1.,d=vShellUv.y,around=vColor.r,f=vColor.g,side=vColor.b;
      vec2 q=vec2(a,d*(side*2.-1.));
      float ws=mix(.0105,.0068,smoothstep(.36,.80,a))+.026*smoothstep(.78,.83,a),aw=fwidth(d)*.8+.0003;
      float stripe=1.-smoothstep(ws-aw,ws+aw,d);
      // The band's lower edge wanders a little along the body and drops onto the pleura.
      float edge=mix(.40,.47,smoothstep(.28,.44,a))+.05*(shrimpNoise(vec2(a*34.,side*7.))-.5);
      float band=1.-smoothstep(edge-.010,edge+.010,around);
      vec3 red=mix(vec3(.30,.010,.010),vec3(.52,.050,.024),smoothstep(.04,.42,around));
      red*=.86+.28*shrimpNoise(q*vec2(260.,120.));
      // Clear amber flanks, paler toward the belly, with the animal's insides behind them.
      vec3 amber=mix(vec3(.28,.080,.016),vec3(.36,.18,.065),smoothstep(.60,.98,around));
      float liver=exp(-pow((a-.14)/.085,2.)-pow((around-.66)/.14,2.));
      amber=mix(amber,vec3(.16,.04,.012),.75*liver);
      float gut=exp(-pow((around-edge-.07)/.03,2.))*smoothstep(.34,.40,a)*(1.-smoothstep(.80,.84,a));
      amber*=1.-.45*gut;
      amber*=1.-step(CARAPACE,a)*.18*(.5+.5*sin(f*25.+around*14.));
      // Chromatophores: dense under the band's edge and thinning down the flank.
      float below=max(0.,around-edge);
      float dots=shrimpCells(q*420.,.55*exp(-below/.05)*step(.0,below))+.6*shrimpCells(q*520.+11.,.10*(1.-smoothstep(.8,1.,around)));
      amber=mix(amber,vec3(.45,.06,.03),min(1.,dots)*.70);
      red*=.80+.36*shrimpNoise(q*vec2(60.,90.))*shrimpNoise(q*vec2(23.,31.)+4.);
      // Deepest where it borders the white stripe.
      red*=mix(.72,1.,smoothstep(ws,ws+.012,d));
      shell=mix(amber,red,band);
      shell=mix(shell,white*(.92+.08*shrimpNoise(q*300.)),stripe);
      // The front of each plate runs under the margin of the one ahead, in its shade, and
      // the margin itself is a thin clearer rim.
      float plate=step(CARAPACE-.001,a);
      shell*=mix(1.,.80+.20*smoothstep(.0,.30,f),plate);
      shell=mix(shell,shell*1.18+vec3(.035,.025,.015),smoothstep(.86,1.,f)*.55);
      // The belly between the legs is soft membrane, paler and duller.
      shell=mix(shell,vec3(.50,.32,.18),smoothstep(.90,1.,around)*.5);
      shellClear=(1.-band)*(1.-stripe);
      shellTransmission=mix(.16,.62,(1.-band)*(1.-stripe))+.30*stripe;
      shellRough=mix(.36,.52,smoothstep(.40,.80,around))+.12*shrimpNoise(q*vec2(80.,110.));
      shellAlpha=mix(1.,.80,smoothstep(.72,.95,around)*step(CARAPACE,a));
    }else if(vShellUv.x>3.95){
      // A compound eye: near black, with the faint bronze grain of its facets.
      vec2 facet=vShell.yz*900.;facet.x+=.5*mod(floor(facet.y),2.);
      float cell=length(fract(facet)-.5);
      shell=mix(vec3(.050,.026,.018),vec3(.020,.012,.010),smoothstep(.20,.45,cell))*(.8+.4*shrimpHash(floor(facet)));
      shellTransmission=0.;shellRough=.28;
    }else{
      float t=fract(vShellUv.x)/.9,across=vShellUv.y;
      vec3 red=vec3(.42,.030,.018)*(.82+.30*shrimpNoise(vec2(t*26.,across*14.)));
      if(vShellUv.x<2.95){
        float spot=1.-smoothstep(.055,.075,length(vec2((t-.70)*.8,(across-.40)*.9)));
        float base=1.-smoothstep(.12,.20,t);
        shell=mix(red,white,max(spot,base*.85));
      }else{
        float mid=abs(across-.5),stripe=1.-smoothstep(.07,.10,mid);
        shell=mix(red,white,max(stripe,1.-smoothstep(.22,.30,t)));
      }
      // The blades thin to a clear margin fringed with setae.
      float rim=max(abs(across*2.-1.),t);
      shell=mix(shell,vec3(.70,.42,.30),smoothstep(.78,1.,rim)*.6);
      shellAlpha=mix(1.,.30,smoothstep(.84,1.,rim));
      shellTransmission=.75;
    }
    diffuseColor.rgb=shell;
  }else shellTransmission=.40;
  diffuseColor.a=shellAlpha;`;

export function createShrimp(scene, simulation) {
  const models=[],up=V(0,1,0),ahead=V(1,0,0),across=V(0,0,1),seat=V(0,0,0),point=V(0,0,0),normal=V(0,0,0);
  const tilt=new THREE.Quaternion(),turn=new THREE.Quaternion(),rock=new THREE.Quaternion(),rear=new THREE.Quaternion(),lie=new THREE.Quaternion(),matrix=new THREE.Matrix4(),scale=V(1,1,1);
  // The shadow map is drawn once, for the rock, so the animal casts nothing into it. A soft
  // pool of shade on the ground under the body, and a small dark contact under each foot,
  // are what keep it standing on the rock rather than floating over it.
  const shade=new Uint8Array(64*64*4);
  for(let j=0;j<64;j++)for(let i=0;i<64;i++){const x=(i+.5)/32-1,y=(j+.5)/32-1,a=Math.round(255*Math.pow(Math.max(0,1-x*x-y*y),1.6));shade.set([a,a,a,255],(j*64+i)*4);}
  const blobTexture=new THREE.DataTexture(shade,64,64);blobTexture.magFilter=blobTexture.minFilter=THREE.LinearFilter;blobTexture.needsUpdate=true;
  const shadeMaterial=opacity=>new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity,alphaMap:blobTexture,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  const blobGeometry=new THREE.PlaneGeometry(1.05,.38).rotateX(-Math.PI/2),blobMaterial=shadeMaterial(.72);
  const footGeometry=new THREE.PlaneGeometry(.075,.075).rotateX(-Math.PI/2),footMaterial=shadeMaterial(.75);
  // The ground's own tilt under a point, so a shade lies on a slope instead of cutting it.
  const lieOn=(x,z,out)=>{const e=.04;normal.set(supportHeight(x-e,z)-supportHeight(x+e,z),2*e,supportHeight(x,z-e)-supportHeight(x,z+e)).normalize();return out.setFromUnitVectors(up,normal);};
  // The shell's lowest points, read off the mesh: the lowest vertex in each twentieth of
  // the body's length is what has to clear the rock.
  const loft=shell(),underside=[];
  // Sorted tail first, so the abdomen's points are the first TAIL_POINTS.
  {const p=loft.attributes.position,low=new Map();for(let k=0;k<p.count;k++){const b=Math.round(p.getX(k)*20);if(!low.has(b)||p.getY(k)<low.get(b).y)low.set(b,V(p.getX(k),p.getY(k),p.getZ(k)));}underside.push(...[...low.values()].sort((u,w)=>u.x-w.x));}
  // The tail fan has to clear the rock too: its tip and the tips of the outer uropods.
  {const tail=spine(PLATES.at(-1)-.012),down=tail.back.clone().addScaledVector(tail.up,-.10).normalize();
   for(const z of [-.09,0,.09])underside.unshift(tail.centre.clone().addScaledVector(down,.15).setZ(z));
   underside.sort((u,w)=>u.x-w.x);}
  const TAIL_POINTS=underside.filter(u=>u.x<JOINT.x).length;
  for(let index=0;index<simulation.shrimp.length;index++) {
    const root=new THREE.Group(),bodyParts=[index?shell():loft],legs=[],antennae=[];
    // Telson and the paired uropods, fanned out in the plane of the tail from the end of the
    // sixth somite. Each uropod is two blades, the outer exopod and the inner endopod.
    const tail=spine(PLATES.at(-1)-.012),fan=tail.centre.clone().addScaledVector(tail.up,.004),down=tail.back.clone().addScaledVector(tail.up,-.10).normalize();
    bodyParts.push(blade(fan,down,across,.150,.050,.010,TELSON));
    for(const side of [-1,1])for(const [angle,length,width] of [[.30,.170,.062],[.58,.150,.056]]){
      const direction=down.clone().multiplyScalar(Math.cos(angle)).addScaledVector(across,side*Math.sin(angle)),sideways=down.clone().multiplyScalar(-Math.sin(angle)).addScaledVector(across,side*Math.cos(angle));
      bodyParts.push(blade(fan.clone().addScaledVector(across,side*.012),direction,sideways,length,width,.007,UROPOD,side));
    }
    // The rostrum: a short laterally flattened blade over the eyes, scarlet, the white stripe
    // running out along its crest.
    const head=spine(0),[,top]=station(0),brow=head.centre.clone().addScaledVector(head.up,top*.80);
    const rostrum=tube([brow.clone().add(V(-.02,-.004,0)),brow.clone().add(V(.04,.010,0)),brow.clone().add(V(.085,.018,0)),brow.clone().add(V(.115,.022,0))],[.011,.0075,.004,.0006],8);
    {const p=rostrum.attributes.position;for(let i=0;i<p.count;i++)p.setZ(i,p.getZ(i)*.42);rostrum.computeVertexNormals();}
    bodyParts.push(plain(rostrum,p=>new THREE.Color(Math.abs(p.z)<.0016&&p.y>brow.y+.18*(p.x-brow.x)?'#c8c4bc':'#7a1208')));
    for(const sign of [-1,1]){
      // Large dark eyes at the front of the carapace on short stalks, set out to the side
      // just under the rostrum's base.
      const socket=head.centre.clone().add(V(-.006,top*.30,sign*.016)),eyeAt=head.centre.clone().add(V(.022,top*.36,sign*.040));
      bodyParts.push(plain(tube([socket,socket.clone().lerp(eyeAt,.6),eyeAt],[.0085,.0078,.0072],8),'#5a1408'));
      const eye=new THREE.SphereGeometry(.0125,18,14).scale(1.10,1,.95).translate(eyeAt.x+.006,eyeAt.y,eyeAt.z+sign*.004),eyeUv=eye.attributes.uv;
      for(let i=0;i<eyeUv.count;i++)eyeUv.setXY(i,EYE,.5);
      bodyParts.push(tint(eye,()=>new THREE.Color('#ffffff')));
      // The antennal scale: a clear blade beside the rostrum, edged in red.
      bodyParts.push(plain(blade(head.centre.clone().add(V(.010,-.012,sign*.036)),V(1,.04,sign*.18),V(-.18*sign,0,1),.100,.018,.004,0),p=>new THREE.Color(Math.abs(p.z)>.050+.12*(p.x-head.centre.x)?'#7a1c10':'#9a6040')));
      // A caridean walks on three pairs: P1 is short and stoutly chelate and P2 is the
      // genus' thread-fine chela on a many-jointed carpus, and it picks with both rather
      // than walking on them. Both are white, as the third maxillipeds are.
      legs.push(jointed([V(.17,-.025,sign*.014),V(.165,-.075,sign*.050),V(.205,-.105,sign*.066),V(.255,-.120,sign*.066),V(.300,-.128,sign*.058)],[.0062,.0056,.0050,.0068,.0010],0,'#b8aca0','#a85040',8,5));
      legs.push(jointed([V(.13,-.025,sign*.014),V(.15,-.068,sign*.066),V(.215,-.060,sign*.088),V(.265,-.070,sign*.086),V(.315,-.082,sign*.078),V(.365,-.094,sign*.066),V(.405,-.104,sign*.054),V(.430,-.110,sign*.048)],[.0042,.0036,.0030,.0028,.0027,.0026,.0024,.0007],1,'#bcb2a6','#b06050',7,5));
      // The walking legs: the merus runs out and a little up from the coxa to the knee
      // beside the body, and the carpus, propodus and dactyl step down from it to the foot.
      // Every article tapers, and the legs are clear amber, ringed red at the joints.
      for(let j=2;j<5;j++){
        const f=foot(j,sign),x=.115-(j-2)*.055,coxa=V(x,-.022,sign*.014),knee=V(lerp(x,f.x,.30)+.012,.030,sign*(.150+.008*j)),ischium=coxa.clone().lerp(knee,.28).add(V(0,-.012,0));
        const carpus=knee.clone().lerp(f,.40).add(V(0,.012,0)),propodus=knee.clone().lerp(f,.84).add(V(0,.006,0));
        legs.push(jointed([coxa,ischium,knee,carpus,propodus,f],[.0056,.0060,.0054,.0042,.0029,.0008],j,'#d08858','#a8301c'));
      }
      // Third maxillipeds under the head: long, white, reaching forward, never still.
      legs.push(jointed([V(.21,-.022,sign*.014),V(.27,-.070,sign*.040),V(.34,-.088,sign*.040),V(.41,-.094,sign*.032)],[.0048,.0040,.0032,.0008],5,'#c0b6aa','#b07460',8,5));
      // Five pairs of pleopods under the first five abdominal somites: a short fringe tucked
      // against the belly. Their wave is what says it is alive rather than propped there.
      for(let i=0;i<5;i++){
        const a=(PLATES[i+1]+PLATES[i+2])/2,s=spine(a),[,,bottom]=station(a),base=s.centre.clone().addScaledVector(s.up,-bottom*.75);
        const out=s.back.clone().multiplyScalar(.75).addScaledVector(s.up,-1).normalize();
        const paddle=limb([base.clone().setZ(sign*.020),base.clone().addScaledVector(out,.022).setZ(sign*.024),base.clone().addScaledVector(out,.040).setZ(sign*.026),base.clone().addScaledVector(out,.048).setZ(sign*.026)],[.0034,.0050,.0042,.0008],6+i,6);
        {const p=paddle.attributes.position;for(let k=0;k<p.count;k++)p.setZ(k,sign*.020+(p.getZ(k)-sign*.020)*.45);paddle.computeVertexNormals();}
        legs.push(tint(paddle,()=>new THREE.Color('#b8704a')));
      }
      // The long antennae and the two branches of the antennule: hair-fine, white, and
      // tapering to nothing, red only on their stout bases.
      for(let j=0;j<3;j++){
        const pts=[],radii=[],base=head.centre.clone().add(j?V(.016,top*.25,sign*.014):V(.012,-.004,sign*.028));
        for(let k=0;k<=24;k++){
          const s=k/24,len=j===0?1.42:j===1?1.10:.76;
          pts.push(V(base.x+s*len*(j===2?.66:.95),base.y+s*(.62-j*.23)-.30*s*s,sign*(Math.abs(base.z)+s*(.30+j*.18))));
          // The peduncle is a stout jointed stalk; the flagellum is a hair.
          radii.push((j?.0012:.0017)*Math.pow(1-s*.9,1.2)+.00025+(j?.0030:.0045)*(1-smoothstep(.02,.06,s*len)));
        }
        antennae.push(tint(limb(pts,radii,j,5),p=>new THREE.Color(p.x<base.x+.05?'#9a2a18':'#e2ded6')));
      }
    }
    // One wrapped two-second clock drives every small rhythm on the animal, so their rates
    // are whole multiples of 0.5 Hz and no phase drifts however long the scene has run.
    const gait={value:new THREE.Vector4(0,0,0,0)},pose={value:new THREE.Vector4(0,0,0,0)},feet={value:FEET.map(()=>0)},bend={value:0};
    const drive=material=>{const inner=material.onBeforeCompile;material.onBeforeCompile=s=>{inner(s);s.uniforms.shrimpGait=gait;s.uniforms.shrimpPose=pose;s.uniforms.shrimpFeet=feet;s.uniforms.shrimpTail=bend;};return material;};
    const bodyMat=drive(underwater(new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.40,clearcoat:.55,clearcoatRoughness:.22,transparent:true}),{
      key:'shrimp-shell',transmission:'shellTransmission',contact:true,
      vertex:'uniform vec4 shrimpPose;uniform float shrimpTail;varying vec3 vShell;varying vec2 vShellUv;',begin:`vShell=position;vShellUv=uv;${FLEX}`,normal:FLEX_NORMAL,
      fragment:`varying vec3 vShell;varying vec2 vShellUv;float shellTransmission=.10;float shellAlpha=1.;float shellClear=0.;float shellRoughness=.40;const float CARAPACE=${n(CARAPACE)};${NOISE}`,
      color:SHELL_COLOR+'shellRoughness=shellRough;',surfaceNormal:'roughnessFactor=shellRoughness;{float graze=1.-abs(dot(normal,normalize(vViewPosition)));diffuseColor.rgb*=1.-.35*shellClear*graze*graze;totalEmissiveRadiance+=diffuseColor.rgb*shellClear*pow(graze,3.)*.55;}'}));
    const bodyMesh=new THREE.Mesh(merge(bodyParts),bodyMat);bodyMesh.receiveShadow=true;root.add(bodyMesh);
    const legMat=drive(underwater(new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.38,transparent:true}),{
      key:'shrimp-legs',transmission:.55,wrap:.75,contact:true,vertex:'uniform vec4 shrimpGait;uniform vec4 shrimpPose;uniform float shrimpTail;uniform float shrimpFeet[6];varying float vAlong;varying float vCode;',
      fragment:'varying float vAlong;varying float vCode;',
      // The legs are clear: the rock shows faintly through their thin far ends.
      color:'diffuseColor.a=mix(.94,.70,smoothstep(.35,1.,vAlong))*(vCode<1.5||abs(vCode-5.)<.5?.72:1.);',normal:FLEX_NORMAL,
      begin:`float code=uv.x,along=uv.y,side=sign(position.z),tip=along*(.30+.70*along);vAlong=along;vCode=code;
        if(code<4.5){
          // The wave runs from the back pair forward, a quarter cycle between neighbours at
          // cruising speed, and the two sides in antiphase. Stance and swing are separate
          // arcs rather than one sine, so a planted foot tracks straight back at the body's
          // own speed instead of sliding through the rock. The chelate pairs are carried
          // rather than walked on, so they shuffle along instead of striding.
          float cycle=fract(shrimpGait.x+code*.26+.25*(1.+side)),stance=step(cycle,.70);
          float u=mix((cycle-.70)/.30,cycle/.70,stance),drive=shrimpGait.y*tip*(code>1.5?1.:.35);
          // Half of SHRIMP.stride in simulation.js, which is what stops the feet skating.
          transformed.x+=mix(2.*u-1.,1.-2.*u,stance)*.0475*drive;
          transformed.y+=(1.-stance)*sin(3.14159*u)*.036*drive;
          // Each walking foot then reaches for the ground actually under it, down over a
          // hollow and up over a lump, so the leg stands on the rock instead of through it.
          // The reach is measured up the world; this is the world's up in the leg's frame.
          if(code>1.5)transformed+=vec3(modelMatrix[0][1],modelMatrix[1][1],modelMatrix[2][1])*shrimpFeet[(int(code+.5)-2)*2+(side>0.?1:0)]*tip;
          // The legs draw up under the animal as the abdomen fires.
          transformed+=vec3(-.03,.05,0.)*shrimpPose.w*tip;
        }
        if(code<1.5){
          // The chelate pairs pick: a claw rests on the rock and folds up to the mouthparts
          // and back, left and right out of phase, so the animal picks about twice a second.
          // The limb shortens as it folds, because a claw that only swung on a rigid arm
          // would arrive somewhere out in front of the head instead of at the mouth. The
          // same fold is the reach the animal makes at a client hanging over it.
          float swing=(sin(6.2832*shrimpGait.w+side*3.14159)*.5+.5)*shrimpGait.z+shrimpPose.z*.85;
          float fold=clamp((along-.22)*1.4,0.,1.),bend=swing*fold*(1.-.30*code);
          vec2 arm=(transformed.xy-vec2(.160,-.030))*(1.-.36*max(0.,bend));
          transformed.xy=vec2(.160+arm.x*cos(bend)-arm.y*sin(bend),-.030+arm.x*sin(bend)+arm.y*cos(bend));
          transformed.z*=1.-.30*max(0.,bend);
          // The advertisement itself. Caves found L. amboinensis signals by rocking this
          // white front pair fore and aft — not by swaying its whole body — and rocks hardest
          // at the big dark clients that are worth the risk of cleaning.
          transformed.x+=sin(9.425*shrimpGait.w)*.018*shrimpPose.x*fold*(1.-.5*code);
        }
        // 5 Hz: the mouthparts flicker far faster than anything else the animal does.
        if(code>4.5&&code<5.5)transformed+=vec3(.012,.009,0.)*sin(31.42*shrimpGait.w+side*1.7)*tip;
        if(code>5.5){
          // Swimmerets beat as a wave running forward at a clean quarter cycle a pair, so
          // the first and fifth are in step; five pairs make a full wavelength of abdomen.
          // They are not a heartbeat — a shrimp standing on rock barely fans them, and they
          // only really drive when it is walking or off the rock altogether.
          float beat=sin(18.85*shrimpGait.w+(code-6.)*1.5708),amp=.12+.88*max(shrimpGait.y,shrimpPose.w);
          transformed.x+=beat*.020*amp*tip;transformed.y+=abs(beat)*.007*amp*tip;
        }
        ${FLEX}`}));
    const legMesh=new THREE.Mesh(merge(legs),legMat);legMesh.receiveShadow=true;root.add(legMesh);
    const antennaMat=drive(underwater(new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.50,transparent:true}),{
      key:'shrimp-antennae',transmission:.60,wrap:.8,vertex:`uniform vec4 shrimpGait;uniform vec4 shrimpPose;varying float vAlong;${responseGLSL}`,
      // The flagella thin to a single cell at the tip and fade into the water there.
      fragment:'varying float vAlong;',color:'diffuseColor.a=1.-.85*pow(vAlong,.8);',
      begin:`float along=uv.y,side=sign(position.z),tip=along*along,antenna=step(uv.x,.5);vAlong=along;
        vec2 flow=reefResponse(modelMatrix[3].xyz,reefTime,.19);
        // The long white antennae are the advertisement, and they are read from across the
        // tank: whipping them precedes four cleans in five. They sweep forward about once a
        // second while the animal is signalling and lie swept back when it is not.
        float sweep=sin(6.2832*shrimpGait.w+side*.9)*shrimpPose.x*antenna;
        // An antennule flick is a hard downstroke and a lazy return, roughly one to three —
        // the asymmetry is what traps a discrete parcel of water for the aesthetascs.
        float p=fract(shrimpGait.w*2.),snap=(p<.22?p/.22:1.-(p-.22)/.78)*shrimpPose.y*(1.-antenna);
        transformed.z+=(sweep*side*.09+flow.y*.20)*tip;
        // L. amboinensis taps a client with its antennae before anything else touches it.
        transformed.y+=(sweep*.11-snap*.11+flow.x*.15+shrimpPose.z*(.30+.12*sin(6.2832*shrimpGait.w)))*tip;
        transformed.x-=(snap*.035+(1.-shrimpPose.x)*.09*antenna+shrimpPose.w*.22)*tip;`}));
    root.add(new THREE.Mesh(merge(antennae),antennaMat));
    const blob=new THREE.Mesh(blobGeometry,blobMaterial);blob.renderOrder=-1;scene.add(blob);
    const prints=new THREE.InstancedMesh(footGeometry,footMaterial,FEET.length);prints.renderOrder=-1;prints.frustumCulled=false;scene.add(prints);
    scene.add(root);models.push({root,blob,prints,gait,pose,feet,bend});
  }
  return {update(){models.forEach((m,i)=>{const s=simulation.shrimp[i];let pose=seatShrimp(s.position.x,s.position.z,s.yaw);
    // A spot that only takes the body nose down, with the tail backed up a rock face or the
    // head over a drop, is drawn a few centimetres along the heading, whichever way levels it,
    // by as much as the pitch is past HEAD_DOWN; the shift grows with the pitch, so it never
    // jumps.
    const settle=Math.min(SETTLE,Math.max(0,-pose.pitch-HEAD_DOWN)*.5);
    if(settle>0)for(const way of [1,-1]){const c=seatShrimp(s.position.x+Math.cos(s.yaw)*settle*way,s.position.z-Math.sin(s.yaw)*settle*way,s.yaw);if(c.lift<=SHRIMP.lift&&c.pitch>pose.pitch)pose=c;}
    // The seat is the simulation's own (`seatShrimp`): the pitch the ground under the body's
    // length allows and the roll of the line its feet stand on, as separate turns, stood up
    // over what no pitch clears. The body rock that goes with the antennal whip is a lean on
    // the legs, and reaching for a client lifts the whole front of the animal, so both are
    // rotations of the body rather than offsets bolted onto it.
    turn.setFromAxisAngle(up,s.yaw);rock.setFromAxisAngle(ahead,s.sway*.14-pose.roll);rear.setFromAxisAngle(across,s.reach*.26);
    const stand=pitch=>{
      tilt.setFromAxisAngle(across,pitch);m.root.quaternion.copy(turn).multiply(tilt).multiply(rock);
      // Every one of those rotations turns about the contact patch, the rear one about the
      // rear pair, and the tail flip is the one thing that takes the animal off it.
      seat.set(0,s.curl*.26,0).add(PIVOT).sub(point.copy(PIVOT).applyQuaternion(rear)).applyQuaternion(m.root.quaternion);
      m.root.quaternion.multiply(rear);
      m.root.position.set(pose.root[0]+seat.x,pose.root[1]+seat.y,pose.root[2]+seat.z);
    };
    // How far the ground stands above the belly line, read off the mesh as the abdomen bends.
    const need=(from,to,bend)=>{let most=0;for(let k=from;k<to;k++){flexed(underside[k],s.curl,bend,point).applyQuaternion(m.root.quaternion).add(m.root.position);most=Math.max(most,supportHeight(point.x,point.z)-point.y);}return most;};
    // The carapace takes that pitch only within HEAD_DOWN and HEAD_UP, and the abdomen bends
    // onto the body's line for the rest. Where the tail still meets rock the abdomen lifts it,
    // up to TAIL_LIFT, and only past that does the head go down any further: backed against a
    // wall, a shrimp runs its tail up the rock rather than standing on its nose.
    let pitch=clamp(pose.pitch,-HEAD_DOWN,HEAD_UP),front=0;
    for(;;){
      stand(pitch);front=need(TAIL_POINTS,underside.length,0);m.bend.value=clamp(pose.pitch-pitch,-TAIL_BEND,TAIL_BEND);
      while(m.bend.value>-TAIL_LIFT&&need(0,TAIL_POINTS,m.bend.value)>front+.004)m.bend.value-=.04;
      if(pitch<=pose.pitch||need(0,TAIL_POINTS,m.bend.value)<=front+.004)break;
      pitch=Math.max(pose.pitch,pitch-.05);
    }
    // Whatever the chord in bodyFit missed then stands the body up, within what the legs have.
    m.root.position.y+=Math.max(0,Math.min(SHRIMP.lift-pose.lift,Math.max(front,need(0,TAIL_POINTS,m.bend.value))));
    // The shade lies on the ground under the seat, turned to the heading and laid on the
    // ground's own slope there.
    point.set(-.10,0,0).applyQuaternion(turn);
    const bx=pose.root[0]+point.x,bz=pose.root[2]+point.z;
    m.blob.quaternion.copy(lieOn(bx,bz,lie)).multiply(turn);m.blob.position.set(bx,supportHeight(bx,bz)+.012,bz);
    // Each walking foot then reaches for the ground actually under it, and where it lands
    // the rock darkens in a small contact shade; a foot left hanging over a drop casts none.
    FEET.forEach((foot,k)=>{
      point.copy(foot).applyQuaternion(m.root.quaternion).add(m.root.position);
      const ground=supportHeight(point.x,point.z),reach=ground-point.y;m.feet.value[k]=clamp(reach,-SHRIMP.stretch,SHRIMP.stretch);
      const landed=1-smoothstep(SHRIMP.stretch,SHRIMP.stretch+.04,Math.abs(reach))-smoothstep(.10,.35,s.curl);
      scale.setScalar(Math.max(.001,landed));point.y=ground+.010;
      m.prints.setMatrixAt(k,matrix.compose(point,lieOn(point.x,point.z,lie),scale));
    });
    m.prints.instanceMatrix.needsUpdate=true;
    m.gait.value.set(s.step,s.walk,s.pick,s.rhythm);m.pose.value.set(s.signal,s.flick,s.reach,s.curl);
  });},models};
}
