import * as THREE from 'three';
import { underwater } from './water.js';
import { merge } from './geometry.js';
import { smoothstep } from './math.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const n=x=>Number(x).toFixed(5);
// Two anatomical attributes ride along with every vertex: `part` says which organ it is
// (0 body, 1 median fin, 2 pectoral, 3 pelvic, 4 eye) and `finRay` where it sits among a
// fin's rays — x the ray coordinate, integer on a ray, y 1 on a spine. The merge in
// geometry.js only knows the standard attributes, so these are carried across here.
const ANATOMY={part:1,finRay:2};
function anatomy(g,part,finRay=()=>[0,0]) {
  const count=g.attributes.position.count,rays=new Float32Array(count*2);
  for(let i=0;i<count;i++)rays.set(finRay(i),i*2);
  g.setAttribute('part',new THREE.Float32BufferAttribute(new Float32Array(count).fill(part),1));
  g.setAttribute('finRay',new THREE.Float32BufferAttribute(rays,2));
  return g;
}
function join(parts) {
  const carried=Object.fromEntries(Object.entries(ANATOMY).map(([name,size])=>[name,{size,data:[]}]));
  for(const g of parts)for(const [name,c] of Object.entries(carried))c.data.push(...g.attributes[name].array);
  const g=merge(parts);
  for(const [name,c] of Object.entries(carried))g.setAttribute(name,new THREE.Float32BufferAttribute(c.data,c.size));
  return g;
}

// The snout sits at +SNOUT and the hypural plate at SNOUT-len; u runs 0 at the snout to
// 1 there, so `len` is standard length and the caudal fin hangs off its back end. `back`
// and `belly` are the half-heights above and below the mouth line, `half` the half-width,
// at the knots below. The back is fuller than the belly through the head because a reef
// fish's mouth sits below the body's midline, under a forehead that climbs to the nape.
// Depths are measured ones where the literature has them: Pseudanthias squamipinnis has
// a fineness ratio of 2.68±0.07 (Frontiers in Marine Science 2023, Gulf of Eilat flume
// work); the model runs nearer three, since at that depth, under a rounded head, it read
// as a snapper rather than a basslet. Amphiprion percula is the deep one at about half
// its length, Chromis viridis a shallower ovate damsel, thin enough to vanish edge-on.
// `snout` is how steeply the profile climbs from the jaws (see `along`). `scales` is the
// scale rows along the flank and around it, and how strongly they show. `mouth` is the
// angle of the cleft below the dorsal midline, how far back the jaw's corner reaches, and
// how far the cleft climbs toward the snout (an oblique mouth); `gill` the opercular
// margin, `u = gill[0] + gill[1]·sin(angle)`, bowed back at mid-flank; `line` the lateral
// line: highest at `at`, falling away by `bend`, ending at `to`. `veil` is a fin web's
// opacity at its hinge and at its free margin, and how far out it starts thinning away
// to the ray tips. Each fin's `rays` is its count of spines plus soft rays, `spines` the
// fraction of its base the spines hold.
const SNOUT=.54;
const KNOTS=[0,.05,.12,.20,.30,.42,.55,.68,.80,.90,1];
const SPECIES={
  clown:{
    len:.98,
    // A deep, compressed oval, about twice as long as deep: the forehead climbs from the
    // snout on an even convex line, the back arches highest over the dorsal spines, and
    // from there back and belly close steadily on a peduncle about a third of the
    // greatest depth, never running parallel the way a boxy loft does.
    back:[.007,.112,.188,.236,.256,.250,.226,.188,.146,.112,.088],
    belly:[.005,.078,.140,.196,.230,.236,.218,.180,.138,.100,.080],
    half:[.004,.040,.058,.066,.069,.067,.060,.050,.039,.030,.023],
    snout:2.0,eye:{u:.135,v:.36,r:.033,pupil:.52},scales:[70,32,.035],cheek:.22,veil:[.92,.72,.84],
    mouth:{a:1.86,corner:.040,tilt:.12},gill:[.215,.090],line:{at:.48,top:.21,bend:.9,to:.64},
    // Nine or ten dorsal spines, and percula's spinous dorsal is the low one — 3.0–3.4 in
    // head length, against a taller anterior fin in ocellaris, which is how the two are
    // separated on a photograph. The soft lobe behind the notch is the fin's high point.
    dorsal:{from:.195,to:.875,sink:.016,rays:26,spines:.50,reach:[.030,.070,.080,.074,.038,.100,.124,.118,.060]},
    anal:{from:.605,to:.895,sink:.013,rays:14,spines:.16,reach:[.030,.082,.104,.104,.060]},
    // Rounded caudal, a little under a quarter of standard length: the fan on a percula is
    // short, not the long paddle a generic fish model gives it.
    caudal:{rays:15,margin:[[-.540,.150,0],[-.610,.190,0],[-.668,.172,0],[-.700,.100,0],[-.710,0,0],[-.700,-.098,0],[-.668,-.170,0],[-.610,-.186,0],[-.540,-.146,0]]},
    // The pectoral is the engine, not a trim tab: percula rows with it at 2.4–4.6 Hz and
    // only adds the tail above about three body lengths a second (J. Exp. Biol. 2019).
    pectoral:{rays:17,base:[[.262,.30],[.290,.00],[.318,-.30]],tip:[[.340,.040,.100],[.400,.026,.124],[.452,-.020,.134],[.480,-.086,.128],[.468,-.150,.110],[.420,-.186,.088],[.360,-.170,.066]]},
    pelvic:{rays:6,base:[[.365,-.88],[.400,-.98]],tip:[[.420,-.300,.040],[.470,-.360,.048],[.522,-.382,.048],[.556,-.350,.038],[.548,-.310,.030]]},
  },
  chromis:{
    len:.82,
    // Sources disagree on depth — 35–38% of standard length in the measured Lakshadweep
    // series, nearer 48% in the classic literature — so this takes 44%, a deep,
    // compressed oval that holds its depth well back, as a live fish photographs, on a
    // peduncle about 13% deep, not the pinched pear of a generic fish; and
    // the eye is large, about a third of the head.
    back:[.016,.080,.140,.172,.184,.182,.170,.144,.110,.082,.058],
    belly:[.012,.058,.116,.156,.172,.172,.160,.130,.096,.072,.052],
    half:[.005,.027,.035,.038,.039,.037,.033,.027,.019,.014,.010],
    snout:1.6,eye:{u:.115,v:.34,r:.036,pupil:.60},scales:[30,14,.11],cheek:.11,veil:[.55,.20,.60],
    mouth:{a:1.70,corner:.058,tilt:.14},gill:[.200,.080],line:{at:.45,top:.20,bend:.8,to:.66},
    // Twelve spines then nine to eleven soft rays in one continuous fin. Spread, the
    // spinous half's upper edge is a perfectly straight line — a damsel's dorsal, not a
    // sail — and the soft lobe behind it is barely higher.
    dorsal:{from:.200,to:.815,sink:.011,rays:23,spines:.56,reach:[.030,.062,.062,.062,.062,.070,.086,.058,.018]},
    anal:{from:.575,to:.830,sink:.010,rays:12,spines:.18,reach:[.028,.066,.078,.058,.018]},
    // Broadly forked, concavity about 18% of standard length, the lobes tapering to points
    // that hook inward toward the fork. They do not run out into filaments: that, and the
    // blackish outer caudal margin, belong to C. atripectoralis.
    // The fork runs in to within a third of the lobes' length of the hypural plate.
    caudal:{rays:17,margin:[[-.600,.204,0],[-.522,.150,0],[-.446,.096,0],[-.384,.046,0],[-.356,0,0],[-.384,-.045,0],[-.446,-.094,0],[-.522,-.148,0],[-.600,-.202,0]]},
    pectoral:{rays:18,base:[[.252,.30],[.285,.00],[.318,-.30]],tip:[[.350,.016,.066],[.418,-.024,.082],[.460,-.094,.078],[.428,-.144,.056],[.360,-.130,.040]]},
    pelvic:{rays:6,base:[[.345,-.88],[.380,-.98]],tip:[[.420,-.215,.026],[.490,-.240,.030],[.540,-.214,.020]]},
  },
  anthias:{
    len:1.14,
    // A slender, spindle-shaped basslet, not a snapper: the short snout climbs on a gentle
    // convex line to the deepest point behind the pectoral base, and back and belly close
    // on a peduncle that stays fairly deep. The female's depth runs nearer three in
    // standard length than the measured mean; the jaw sits high, the chin full under it.
    back:[.012,.050,.096,.144,.180,.192,.182,.154,.116,.080,.048],
    belly:[.016,.066,.114,.152,.176,.180,.166,.134,.096,.066,.044],
    half:[.006,.030,.047,.056,.060,.059,.052,.040,.029,.019,.012],
    snout:2.0,eye:{u:.110,v:.38,r:.037,pupil:.52},scales:[56,22,.10],cheek:.08,veil:[.70,.22,.70],
    // The sea goldie's mouth is the large oblique one of a plankton picker, turned up at
    // the front, the jaw's corner reaching back under the front of the eye.
    mouth:{a:1.42,corner:.088,tilt:.52},gill:[.200,.085],line:{at:.45,top:.22,bend:1.0,to:.97},
    // Ten spines and fifteen to seventeen soft rays make a long, low, even-topped dorsal;
    // the third spine is drawn out in both sexes and greatly so in the terminal male.
    dorsal:{from:.175,to:.865,sink:.012,rays:26,spines:.40,reach:[.044,.072,.078,.074,.072,.082,.092,.068,.024]},
    // Three spines and only six or seven rays: the anal fin is short-based and set well
    // back, nothing like the long anal the dorsal would suggest.
    anal:{from:.640,to:.855,sink:.011,rays:10,spines:.26,reach:[.034,.082,.094,.070,.024]},
    // A lyre in both sexes — the species' common name in the trade is lyretail: a shallow
    // crescent across the middle rays, and the outer two or three of each lobe run out far
    // beyond it into a slim point, drawn further into filaments on the male by the vertex
    // shader below.
    caudal:{rays:17,margin:[[-1.000,.236,0],[-.860,.176,0],[-.782,.116,0],[-.724,.058,0],[-.706,0,0],[-.724,-.056,0],[-.782,-.114,0],[-.860,-.174,0],[-1.000,-.234,0]]},
    pectoral:{rays:17,base:[[.248,.30],[.282,.00],[.316,-.30]],tip:[[.348,.020,.074],[.416,-.026,.092],[.462,-.106,.088],[.428,-.166,.066],[.356,-.148,.046]]},
    // The pelvics lie back along the belly rather than hanging under it.
    pelvic:{rays:6,base:[[.340,-.88],[.375,-.98]],tip:[[.430,-.236,.030],[.510,-.262,.034],[.566,-.228,.022]]},
  },
};
const axis=(kind,u)=>SNOUT-u*SPECIES[kind].len;
// A cubic Hermite through the knots with central-difference tangents, so the profile has
// no flat spot at each knot (a smoothstep per segment scallops the outline). `start` is
// how steeply the curve leaves the snout, in multiples of the first chord: depth and width
// both climb from the jaws at the species' own `snout` angle, the straight-ish forehead
// and throat of a skull rather than the round front of a dome or a knob of a nose.
function slope(values,k,start) {
  const last=KNOTS.length-1;
  if(k===0)return start*(values[1]-values[0])/KNOTS[1];
  if(k===last)return (values[last]-values[last-1])/(KNOTS[last]-KNOTS[last-1]);
  return (values[k+1]-values[k-1])/(KNOTS[k+1]-KNOTS[k-1]);
}
function along(values,u,start=3) {
  let i=1;while(i<KNOTS.length-1&&KNOTS[i]<u)i++;
  const h=KNOTS[i]-KNOTS[i-1],t=(u-KNOTS[i-1])/h,t2=t*t,t3=t2*t;
  return (2*t3-3*t2+1)*values[i-1]+(t3-2*t2+t)*h*slope(values,i-1,start)+(3*t2-2*t3)*values[i]+(t3-t2)*h*slope(values,i,start);
}
function section(kind,u) {
  const s=SPECIES[kind];u=Math.max(0,Math.min(1,u));
  return {top:along(s.back,u,s.snout),bottom:along(s.belly,u,s.snout),half:along(s.half,u,s.snout)};
}
// The cleft's angle below the dorsal midline at u: fixed at the jaw's corner, rising
// toward the snout on an oblique mouth.
const mouthAngle=(kind,u)=>{const m=SPECIES[kind].mouth;return m.a-m.tilt*(1-Math.min(1,u/m.corner));};
/** Surface point at axial fraction u and angle a, a=0 on the dorsal midline.
 *  Fullness above 1 pinches the section toward a ridge at the back and a softer keel at
 *  the belly, which is what a laterally compressed fish's cross-section actually does;
 *  the gill chamber swells the cheek so the head is not a cone.
 *  The head is a skull, not a dome, so through it the section turns into the head's own
 *  (skullSection), and is then sculpted where a smooth loft has nothing: a cleft that runs
 *  back to the jaw's corner, and the gill cover's free margin overlapping the flank
 *  behind it, which steps down under it. */
function sectionPoint(kind,u,a,out=V()) {
  const S=SPECIES[kind],s=section(kind,u),v=Math.cos(a),lateral=Math.abs(Math.sin(a)),fold=Math.min(a,2*Math.PI-a);
  const full=.95+.48*Math.pow(Math.max(0,v),1.6)+.40*Math.pow(Math.max(0,-v),1.6);
  const skull=1-smoothstep(S.gill[0]-.03,S.gill[0]+S.gill[1],u);
  const cheek=1+S.cheek*Math.exp(-(((u-.155)/.072)**2))*(.5-v*.5);
  const {corner}=S.mouth,off=fold-mouthAngle(kind,u);
  const cleft=1-.015*Math.exp(-((off/.045)**2))*(1-smoothstep(corner*.75,corner,u));
  const edge=S.gill[0]+S.gill[1]*Math.sin(fold);
  const flap=1-.026*smoothstep(edge-.004,edge+.012,u)*(1-smoothstep(edge+.012,edge+.12,u))*smoothstep(.35,.7,fold)*(1-smoothstep(2.45,2.85,fold));
  const r=cleft*flap;
  const width=s.half*cheek*(Math.pow(lateral,full)*(1-skull)+skullSection(v)*skull)*Math.sign(Math.sin(a))*r;
  return out.set(axis(kind,u),(v>=0?v*s.top:v*s.bottom)*r,width);
}
// Half-width of the head's section at height v (1 the dorsal midline, -1 the ventral), as
// a fraction of the widest. The cheeks and gill covers are flat plates standing almost
// upright, which is where the eye sits flush; above the orbits they turn in hard to a
// narrow, flattened interorbital, and below them the lower jaws close to a V at the throat.
function skullSection(v) {
  const k=v>0?4:2.6,plate=Math.pow(Math.max(0,1-Math.pow(Math.abs(v),k)),1/k);
  return plate*(1-.36*smoothstep(.30,.95,v)-.22*smoothstep(.30,.90,-v));
}
const skinPoint=(kind,u,v,side)=>{const q=sectionPoint(kind,u,Math.acos(v));return [q.x,q.y,side*Math.abs(q.z)];};
// The ring's angles are spaced evenly except that one vertex lands exactly on the mouth's
// cleft on each side, so the narrow groove is cut rather than aliased across two facets.
// Tessellation. FAR is the model a fish is drawn with once it is a few hundred pixels long
// or less, which on a wallpaper is nearly always: the silhouette holds, and the fins'
// pleats, which there fall under a pixel, are carried at half the columns.
const FULL={sides:48,rings:72,pleats:4,steps:1},FAR={sides:30,rings:44,pleats:2,steps:.6};
function sideAngle(kind,i,sides) {
  const half=sides/2,m=SPECIES[kind].mouth.a,k=Math.round(m/Math.PI*half);
  const fold=j=>j<=k?m*j/k:m+(Math.PI-m)*(j-k)/(half-k);
  return i<=half?fold(i):2*Math.PI-fold(sides-i);
}
// Arc length round the section from the dorsal midline to angle a, the body's uv.y unit.
function arcTo(kind,u,a,steps=96) {
  let length=0;const p=sectionPoint(kind,u,0),q=V();
  for(let i=1;i<=steps;i++){sectionPoint(kind,u,a*i/steps,q);length+=q.distanceTo(p);p.copy(q);}
  return length;
}
const band=(kind,u,a)=>arcTo(kind,u,a)/arcTo(kind,u,Math.PI);

function bodyGeometry(kind,{sides,rings}) {
  const p=[],uv=[],index=[],q=V(),previous=V();
  for(let j=0;j<=rings;j++) {
    // Rows crowd toward the snout, where the profile and the orbit turn hardest.
    const u=Math.pow(j/rings,1.24),arc=[0];
    sectionPoint(kind,u,0,previous);
    for(let i=1;i<=sides;i++){sectionPoint(kind,u,sideAngle(kind,i,sides),q);arc.push(arc[i-1]+q.distanceTo(previous));previous.copy(q);}
    const half=Math.max(arc[sides>>1],1e-6);
    for(let i=0;i<=sides;i++) {
      sectionPoint(kind,u,sideAngle(kind,i,sides),q);p.push(q.x,q.y,q.z);
      // uv.y is the arc fraction from the dorsal midline to the ventral, identical on
      // both flanks: every colour zone then follows the outline rather than a height.
      uv.push(u,i<=sides>>1?arc[i]/half:(arc[sides]-arc[i])/half);
      // Wound so the outer face is the front one, as the end caps are: the shader discards
      // the body's back faces, and the other way round it drew the inside of the far
      // flank, its normals turned in, so the lamp lit the belly and left the back dark.
      if(j<rings&&i<sides){const k=j*(sides+1)+i;index.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}
    }
  }
  // Close both ends so nothing is seen through the snout or the peduncle. The snout's
  // section is a narrow blade, so its cap is the closed slit of the jaws, not an opening.
  const mouth=sectionPoint(kind,0,mouthAngle(kind,0)).y;
  for(const [row,u,flip] of [[0,0,false],[rings,1,true]]) {
    const hub=p.length/3;p.push(axis(kind,u),u?0:mouth,0);uv.push(u,.5);
    for(let i=0;i<sides;i++){const a=row*(sides+1)+i,b=a+1;index.push(...(flip?[hub,b,a]:[hub,a,b]));}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(index);g.computeVertexNormals();
  // Each ring starts and ends on the dorsal midline with two copies of one vertex; they
  // share a normal, or the back shows a crease down its ridge.
  const normal=g.attributes.normal,m=V(),o=V();
  for(let j=0;j<=rings;j++){const a=j*(sides+1),b=a+sides;m.fromBufferAttribute(normal,a).add(o.fromBufferAttribute(normal,b)).normalize();normal.setXYZ(a,m.x,m.y,m.z);normal.setXYZ(b,m.x,m.y,m.z);}
  return anatomy(g,0);
}

/** A fin is a sheet lofted from its insertion line in the skin to its free margin, one
 *  ray every `pleats` columns of the tessellation. uv.x runs along the base and uv.y from
 *  the hinge to the edge; finRay counts the rays. Between rays the membrane falls short of the tips — deeply
 *  between spines, which is the incised look of a spinous dorsal, barely between soft
 *  rays — and the sheet is pleated, each ray standing a little out of the plane of its
 *  neighbours, so the rays catch light one at a time as a real fin's do. */
function fin(base,tip,id,{rays,spines=0,notch=.006,cup=0,steps:stepCount=6},{pleats,steps:stepScale}) {
  const steps=Math.max(3,Math.round(stepCount*stepScale));
  const hinge=new THREE.CatmullRomCurve3(base.map(k=>V(...k))),margin=new THREE.CatmullRomCurve3(tip.map(k=>V(...k)));
  const length=margin.getLength(),columns=(rays-1)*pleats,pleat=.06*length/rays,ripple=.018*length,phase=rays*.37,camber=cup*length;
  const p=[],uv=[],ray=[],index=[],a=V(),b=V(),q=V(),tangent=V(),normal=V();
  for(let i=0;i<=columns;i++) {
    const s=i/columns,r=s*(rays-1),spine=s<spines?1:0,between=Math.pow(Math.sin(Math.PI*(r%1)),1.5);
    hinge.getPoint(s,a);margin.getPoint(s,b);hinge.getTangent(s,tangent);
    normal.subVectors(b,a).cross(tangent).normalize();
    // The free edge is never held flat: it ripples in two or three slow waves, and a paired
    // fin is cupped against the water it pushes. Between spines the membrane is incised.
    const reach=1-(spine?.04:notch)*between,fold=pleat*Math.cos(Math.PI*r)+ripple*Math.sin(Math.PI*2*(2.3*s)+phase)+camber*Math.sin(Math.PI*s);
    for(let j=0;j<=steps;j++) {
      const t=j/steps;q.lerpVectors(a,b,t*reach).addScaledVector(normal,fold*t*t);p.push(q.x,q.y,q.z);uv.push(s,t);ray.push(r,spine);
      if(i<columns&&j<steps){const k=i*(steps+1)+j;index.push(k,k+1,k+steps+1,k+1,k+steps+2,k+steps+1);}
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(index);g.computeVertexNormals();return anatomy(g,id,i=>[ray[i*2],ray[i*2+1]]);
}
// Median fins hinge a little inside the dorsal or ventral margin, so the membrane grows
// out of the skin instead of balancing on it. Both curves are sampled at the same
// stations: a ray then runs straight out from its own insertion.
function median(kind,{from,to,sink,reach},up) {
  const base=[],tip=[],count=reach.length-1;
  for(let i=0;i<=count;i++) {
    const u=from+(to-from)*i/count,s=section(kind,u),x=axis(kind,u),edge=up?s.top:-s.bottom;
    base.push([x,edge-(up?sink:-sink),0]);tip.push([x,edge+(up?reach[i]:-reach[i]),0]);
  }
  return [base,tip];
}
const hypural=kind=>{
  const s=section(kind,1),line=[];
  for(let i=0;i<=8;i++){const t=i/8;line.push([axis(kind,1)+.024*Math.sin(Math.PI*t),s.top+(-s.bottom-s.top)*t,0]);}
  return line;
};

// The eye looks out along the head's own surface normal, so it faces a little forward as
// the head tapers. A teleost eye is not a ball and does not stand out of a socket: the
// transparent skin of the head runs straight over it as the cornea, so the nearly flat
// iris follows the cheek's own curve, lifted only clear of it, and only the spherical lens
// bulges a little through the pupil. The rim tucks under the skin, and the iris's outer
// ring fades into it rather than ending at a lid. `pupil` is the pupil's radius as a
// fraction of the eye's.
function eye(kind,side) {
  const S=SPECIES[kind],{u,v,r,pupil:P}=S.eye,a=Math.acos(v),segments=24,p0=sectionPoint(kind,u,a);
  const back=sectionPoint(kind,u+.002,a).sub(p0),down=sectionPoint(kind,u,a+.002).sub(p0);
  const normal=down.clone().cross(back).normalize();if(normal.z<0)normal.negate();
  const radii=[0,.12,.24,.34,P-.06,P,P+.06,.70,.80,.90,1,1.10],perAngle=down.length()/.002;
  const lift=x=>.03+.07*Math.sqrt(Math.max(0,P*P-x*x))/P-.25*smoothstep(1.,1.10,x);
  const p=[],uv=[],index=[],q=V();
  for(let j=0;j<radii.length;j++)for(let i=0;i<=segments;i++) {
    const t=i/segments*Math.PI*2,x=Math.cos(t)*radii[j],y=Math.sin(t)*radii[j];
    sectionPoint(kind,u-x*r/S.len,a-y*r/perAngle,q).addScaledVector(normal,lift(radii[j])*r);
    p.push(q.x,q.y,side*q.z);uv.push(x,y);
    if(j<radii.length-1&&i<segments){const k=j*(segments+1)+i,l=k+segments+1;index.push(...(side>0?[k,l,k+1,k+1,l,l+1]:[k,k+1,l,k+1,l+1,l]));}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(index);g.computeVertexNormals();
  // The centre ring is a single point, whose fan of degenerate triangles has no normal.
  for(let i=0;i<=segments;i++)g.attributes.normal.setXYZ(i,normal.x,normal.y,side*normal.z);
  return anatomy(g,4);
}

export function makeFishGeometry(kind='clown',res=FULL) {
  const s=SPECIES[kind],parts=[bodyGeometry(kind,res)];
  parts.push(fin(...median(kind,s.dorsal,true),1,s.dorsal,res));
  parts.push(fin(...median(kind,s.anal,false),1,s.anal,res));
  parts.push(fin(hypural(kind),s.caudal.margin,1,s.caudal,res));
  for(const side of [-1,1]) {
    parts.push(fin(s.pectoral.base.map(([u,v])=>skinPoint(kind,u,v,side)),s.pectoral.tip.map(([u,y,z])=>[axis(kind,u),y,side*z]),2,{rays:s.pectoral.rays,cup:.07,steps:5},res));
    parts.push(fin(s.pelvic.base.map(([u,v])=>skinPoint(kind,u,v,side)),s.pelvic.tip.map(([u,y,z])=>[axis(kind,u),y,side*z]),3,{rays:s.pelvic.rays,spines:.12,cup:.05,steps:4},res));
    parts.push(eye(kind,side));
  }
  return join(parts);
}

// Skin pigment per species, in the order back → flank → belly. Bars, stripes and the
// iridescent layer are written against uv: uv.x is the axial fraction u, uv.y the arc
// fraction from the dorsal midline (0) to the ventral (1). `silver` is how much of the
// skin is a guanine iridophore plate rather than pigment; it lifts the specular.
const SKIN={
  clown:`
    // Orange from xanthophores across the whole flank, deeper and redder on the head and
    // along the back, paling a little toward the belly.
    vec3 skin=mix(vec3(.46,.085,.018),vec3(.80,.215,.034),smoothstep(.04,.42,band));
    skin=mix(skin,vec3(.86,.320,.080),smoothstep(.66,.98,band));
    skin=mix(skin,skin*vec3(.92,.80,.70),(1.-smoothstep(.04,.20,u))*.6);
    // Three bars, in the rostro-caudal order a settling juvenile grows them: the head bar
    // behind the eye leaning forward at the throat, the trunk bar with the forward wedge
    // that marks percula, the peduncle bar. The white is a guanine iridophore plate and
    // the black edge is the melanophore band those iridophores position, so the two are
    // one feature and are drawn from one signed distance. Neither edge is ruled: the
    // melanophores stop cell by cell, so both borders wander a little.
    float wander=(fishNoise(vec2(u*30.,band*7.)+vTrim.x*11.)-.5)*.002;
    // The head bar is a crescent that follows the gill cover, bowed back at mid-flank; the
    // trunk bar's wedge is a modest forward point, not an S.
    float b1=abs(u-(.212+.044*sin(3.1416*band)-.020*band))-.040;
    float b2=abs(u-(.512-.058*exp(-pow((band-.50)/.26,2.))))-.056;
    float d=min(min(b1,b2),abs(u-.872)-.030)+wander;
    // percula carries thick black borders where ocellaris has a hairline or none at all,
    // and the black broadens with age: the big female in a group is the blackest fish.
    float edge=.008+.012*band+.013*vTrim.x+(fishNoise(vec2(u*9.,band*3.5)+3.1)-.5)*.018,aa=max(fwidth(d),.0012);
    float white=1.-smoothstep(-aa,aa,d);
    skin=mix(skin,vec3(.010,.011,.014),1.-smoothstep(edge-aa,edge+aa*1.5,d));
    // Living tissue under a thin white plate: a faint warmth comes through it toward the
    // middle of each bar and a cool blue-white at its rim.
    skin=mix(skin,mix(vec3(.72,.75,.79),vec3(.78,.73,.68),smoothstep(-.012,-.040,d)*.50),white);
    silver=white;`,
  chromis:`
    // A blue-green chromis is a pale fish: a faint apple-green over the back washing out
    // to silver-white at the belly, with what blue it has held in the peduncle and in the
    // iridophore flare rather than in the base coat. Measured reflectance for the species
    // carries nothing above green — no yellow, no orange, no red — so the whole coat is
    // built from green and cyan over a silver belly. Most of what the eye takes for its
    // colour is the water, mirrored in the platelets (SHEEN), which is how a shoal of them
    // all but vanishes against open water.
    vec3 skin=mix(vec3(.100,.270,.200),vec3(.260,.500,.360),smoothstep(.04,.34,band));
    skin=mix(skin,vec3(.560,.620,.610),smoothstep(.52,.94,band));
    skin=mix(skin,vec3(.130,.330,.400),smoothstep(.70,1.,u)*.55);
    // A pair of turquoise lines runs from the upper lip to the front of the orbit.
    skin=mix(skin,vec3(.18,.58,.62),exp(-pow((band-(.30+1.5*u))/.030,2.))*(1.-smoothstep(.04,.11,u))*.6);
    // The solid black axil is Chromis atripectoralis, sold beside this fish and mistaken
    // for it; on viridis the upper pectoral base only carries scattered black dots, and
    // even those show solely when the fin swings forward.
    skin*=1.-.13*exp(-pow((u-.292)/.032,2.)-pow((band-.44)/.070,2.));
    // One aggregation runs from green through to blue, and the same fish shifts as it
    // turns, so the per-animal constant only picks where in that range it sits.
    skin=mix(skin,skin*vec3(.60,.94,1.34),vTrim.x*.52);
    // The nesting male goes yellowish while he tends his patch of rubble.
    skin=mix(skin,skin*vec3(1.55,1.14,.40),vTrim.y*.70);
    silver=.70+.30*smoothstep(.45,.85,band);`,
  anthias:`
    // Golden orange, deepest along the back and paling to a peach-yellow belly, with the
    // lavender wash a live sea goldie carries over its cheek and throat.
    vec3 skin=mix(vec3(.62,.170,.070),vec3(.84,.320,.110),smoothstep(.05,.40,band));
    skin=mix(skin,vec3(.86,.480,.280),smoothstep(.56,.96,band));
    skin=mix(skin,vec3(.62,.36,.46),smoothstep(.40,.80,band)*(1.-smoothstep(.10,.26,u))*.45);
    // The species character, and it is not a violet bar: an orange stripe edged in violet
    // running diagonally from below the eye down to the pectoral-fin base.
    float line=(band-(.40+2.2*(u-.12)))/.050;
    float stripe=exp(-line*line)*smoothstep(.10,.13,u)*(1.-smoothstep(.22,.27,u));
    // The terminal male: a violet-magenta head and peduncle over a rose-orange flank. The
    // pale square patch behind the pectoral belongs to P. pleurotaenia, not to this fish,
    // so it is deliberately absent; his one body mark is the red blotch on the pectoral fin.
    vec3 male=mix(vec3(.44,.130,.270),vec3(.68,.270,.200),smoothstep(.12,.50,u));
    male=mix(male,vec3(.50,.150,.250),smoothstep(.66,.96,u));
    skin=mix(skin,mix(male,male*vec3(1.18,.92,1.12),smoothstep(.54,1.,band)),vTrim.y);
    skin=mix(skin,vec3(.88,.380,.100),stripe*.85);
    skin=mix(skin,vec3(.42,.18,.56),stripe*min(1.,abs(line)));
    // Each scale of a sea goldie carries a yellow centre on a rosier rim, which is what
    // makes the flank read as a fine net at arm's length.
    skin=mix(skin,skin*vec3(1.08,1.14,.90),scaleCore*.45);
    silver=.30+.25*vTrim.y;`,
};
// Fin membranes: the pigment across the span, hinge (0) to free margin (1). `tail`,
// `below`, `paired` and `pelvic` name which fin this fragment is on, because the median
// fins share one sheet and a caudal is not painted like a dorsal. `ink` is how much of
// the membrane's opacity its melanin supplies: a black margin is opaque where the clear
// membrane beside it is not.
const FINS={
  clown:`
    // Orange membrane with a heavy black margin on the median fins, a clear rim outside it,
    // and pelvics that are all but solid black.
    vec3 web=mix(vec3(.70,.160,.026),vec3(.86,.270,.050),span);
    float inner=.80+.05*(fishNoise(vec2(vRay.x*.7,3.))-.5);
    float black=smoothstep(inner,inner+.05,span)*(1.-smoothstep(.95,.975,span))*(1.-paired+pelvic);
    // The peduncle bar's black runs on across the base of the caudal, a third of the way out.
    black=max(black,tail*(1.-smoothstep(.18,.34,span)));
    black=max(black,pelvic*.82);
    web=mix(web,vec3(.011,.013,.017),black);
    web=mix(web,vec3(.66,.69,.72),smoothstep(.96,.99,span)*(1.-paired)*tail);
    // The trunk bar does not stop at the skin: it carries on up the soft dorsal and down
    // the anal, which is why those two fins look notched white on a photograph.
    float notchWhite=(1.-tail)*(1.-paired)*(1.-smoothstep(.040,.056,abs(axial-.510)))*(1.-smoothstep(.18,.40,span));
    web=mix(web,vec3(.72,.75,.79),notchWhite);
    ink=black*.92+notchWhite*.4;`,
  chromis:`
    // Hyaline fins the colour of the water it hovers in. Only the outer edges of the
    // caudal lobes take the livery; a blackish dorsal margin, or a caudal that ran out
    // into dark filaments, would make this C. atripectoralis instead.
    vec3 web=mix(vec3(.300,.480,.450),vec3(.520,.640,.620),span);
    float lobe=tail*smoothstep(.34,1.,span)*smoothstep(.34,.04,min(vSkinUv.x,1.-vSkinUv.x));
    web=mix(web,vec3(.160,.380,.420),lobe);
    ink=lobe*.20;`,
  anthias:`
    // Golden membrane on both sexes. The male carries it rose instead, and adds a dusky
    // blue anal, a red blotch on the pectoral and a violet edge along both lobes of the
    // lyre — the three marks that separate a terminal male from a big female.
    vec3 web=mix(vec3(.76,.280,.060),vec3(.86,.440,.110),smoothstep(.16,.82,span));
    web=mix(web,mix(vec3(.72,.200,.220),vec3(.42,.130,.320),smoothstep(.45,1.,span)),vTrim.y*(.50+.44*tail));
    web=mix(web,vec3(.150,.170,.380),vTrim.y*below*(1.-tail)*.55);
    // The blotch sits on the fin's upper rays, not across the whole blade.
    float blotch=vTrim.y*(paired-pelvic)*smoothstep(.22,.60,span)*(1.-smoothstep(.70,.95,span))*(1.-smoothstep(.35,.75,vSkinUv.x));
    web=mix(web,vec3(.66,.080,.060),blotch);
    ink=blotch*.45+vTrim.y*below*(1.-tail)*.25;`,
};
// Guanine platelets under the scales are mirrors, and this is what they reflect: a fish
// in water has almost no surface gloss, because mucus and water share nearly one
// refractive index, so its highlights are the platelets' — tinted, and broken scale by
// scale. The whole point of a chromis, a rose-violet sheen on the sea goldie, and a cool
// silver on the clownfish's white that its orange barely has.
const SHEEN={clown:'vec3(.020,.018,.016)+silver*vec3(.30,.32,.36)',chromis:'silver*vec3(.26,.42,.38)',anthias:'silver*vec3(.22,.12,.30)'};
// Thin-film thickness, in cycles across the swing from face-on to grazing.
const FILM={clown:.6,chromis:1.3,anthias:1.0};
// The iris is the fastest species mark at tank distance. percula's is orange, and
// ocellaris' greyish one is exactly how the trade tells the two apart; a damsel's is a
// thin silvery ring round a large dark pupil; both sexes of sea goldie carry the metallic
// pink-violet orbital ring that runs straight on into the cheek stripe. `rim` is the
// iris's outer edge, where the head's own colour begins to show through the cornea.
const EYE={
  clown:'vec3 iris=vec3(.82,.360,.060),rim=vec3(.50,.100,.012);',
  chromis:'vec3 iris=vec3(.56,.66,.72),rim=vec3(.20,.40,.42);',
  anthias:'vec3 iris=vec3(.70,.400,.110),rim=mix(vec3(.44,.16,.46),vec3(.50,.10,.24),vTrim.y);',
};
// How much light the tissue passes to its shaded side: a fin is a membrane a few cells
// thick, a chromis a thin translucent fish, the clownfish and goldie solid by comparison.
// Kept small: a body two or three centimetres through passes little of the lamp to its
// belly, and more made the belly glow as if lit from inside.
const FLESH={clown:.04,chromis:.09,anthias:.05};

// Where the body's sculpted landmarks sit in its uv, for the relief the shader draws.
function landmarks(kind) {
  const S=SPECIES[kind],e=S.eye,ea=Math.acos(e.v),arc=arcTo(kind,e.u,Math.PI);
  return {eye:[e.u,band(kind,e.u,ea)],eyeR:[e.r/S.len,e.r/arc],mouth:band(kind,S.mouth.corner,S.mouth.a),arc};
}
// The cleft's band at the fragment's u, following mouthAngle.
function mouthBand(kind) {
  const m=SPECIES[kind].mouth;
  return `(${n(landmarks(kind).mouth)}-${n(m.tilt/Math.PI)}*(1.-min(1.,u/${n(m.corner)})))`;
}
// The body's relief that geometry is too coarse to carry: the gill cover's free margin
// and the preopercle groove in front of it, the cleft of the mouth, the nostrils, the
// fleshy rim of the orbit and the lateral line's pored scales. Heights are in model units.
function reliefGLSL(kind) {
  const S=SPECIES[kind],L=landmarks(kind),{at,top,bend,to}=S.line,[eu,eb]=L.eye,[ru,rb]=L.eyeR;
  return `
// The head's sensory canals open through rows of pores: under the orbit, over it, down
// the preopercle's edge and along the lower jaw. They are the finest structure a close
// look at a fish's face finds, and a smooth head has none. 1 at a pore's centre.
float fishPore(float across,float along,float spacing){
  float k=floor(along/spacing+.5),size=.004+.006*fishHash(vec2(k,spacing*7.));along-=spacing*k;
  return exp(-(across*across+along*along)/size);}
float fishPores(vec2 q){
  // In eye radii, so a pore is round whichever way the uv is stretched.
  vec2 o=(q-vec2(${n(eu)},${n(eb)}))/vec2(${n(ru)},${n(rb)});
  float r=length(o),angle=atan(o.y,o.x),p=0.;
  // Under the orbit from the snout side back to below its rear, and over it.
  p+=fishPore(r-1.55,angle*1.55,.48)*smoothstep(-.3,.3,o.y)*smoothstep(-.4,.2,.5-o.x);
  p+=fishPore(r-1.40,angle*1.40,.42)*smoothstep(.45,.75,-o.y/r)*smoothstep(-.2,.3,.3-o.x);
  // Down the preopercle and along the mandible.
  float u=q.x,band=q.y,pre=(u-${n(S.gill[0])}+.070-.012*sin(3.1416*band))/${n(ru)};
  p+=fishPore(pre,band/${n(rb)},.55)*smoothstep(.40,.50,band)*(1.-smoothstep(.80,.88,band));
  float jaw=(band-${mouthBand(kind)}-.07)/${n(rb)};
  p+=fishPore(jaw,u/${n(ru)},.50)*smoothstep(.01,.03,u)*(1.-smoothstep(${n(S.mouth.corner*1.5)},${n(S.mouth.corner*2.2)},u));
  return min(p,1.);
}
float fishRelief(vec2 q){
  float u=q.x,band=q.y,h=0.;
  float edge=${n(S.gill[0])}+${n(S.gill[1])}*sin(3.1416*clamp(band,0.,1.));
  float opening=smoothstep(.10,.24,band)*(1.-smoothstep(.80,.93,band));
  h+=.0018*smoothstep(edge-.07,edge-.002,u)*(1.-smoothstep(edge-.002,edge+.008,u))*opening;
  h-=.0012*exp(-pow((u-edge+.070-.012*sin(3.1416*band))/.006,2.))*opening*(1.-smoothstep(.55,.80,band));
  // The mouth is a slit between hard jaws, not a pair of lips. Above its corner the
  // maxilla's rounded end, a slip of bone under thin skin, is outlined from the cheek.
  float cleft=${mouthBand(kind)},jaw=u/${n(S.mouth.corner)};
  h-=.0010*exp(-pow((band-cleft)/.007,2.))*(1.-smoothstep(.88,1.02,jaw));
  float slip=band-cleft+.060;
  h-=.0004*exp(-pow((jaw-1.10)/.07,2.))*smoothstep(-.012,0.,slip)*(1.-smoothstep(0.,.012,band-cleft));
  // The nostrils, two small pits in front of the eye. The eye itself needs no relief: it
  // sits flush under the head's transparent skin.
  vec2 o=(q-vec2(${n(eu)},${n(eb)}))/vec2(${n(ru)},${n(rb)}),n1=o-vec2(-1.75,-.30),n2=o-vec2(-2.45,-.10);
  h-=.0010*(exp(-dot(n1,n1)/.04)+exp(-dot(n2,n2)/.03));
  float line=exp(-pow((band-${n(top)}-${n(bend)}*pow(u-${n(at)},2.))/.010,2.))*smoothstep(edge,edge+.03,u)*(1.-smoothstep(${n(to-.03)},${n(to)},u));
  h+=${n(.0008*Math.min(1,S.scales[2]*4))}*line*(.4+.6*cos(6.2832*u*${n(S.scales[0])}));
  return h;
}`;
}
// Imbricate scales: discs on a lattice, every other file staggered by half a scale, and
// wherever several overlap the most anterior lies on top, its free rear margin over the
// front of the one behind. Returns the point's position within its top scale (unit disc)
// and that scale's random identity.
const SCALES_GLSL=`
const float SCALE_R=.74;
vec3 fishScale(vec2 p){
  vec2 best=vec2(9.);float bestX=1e9,id=0.;
  float file=floor(p.y);
  for(int j=-1;j<=1;j++){
    float f=file+float(j),shift=mod(f,2.)*.5,col=floor(p.x-shift);
    for(int i=-1;i<=1;i++){
      vec2 c=vec2(col+float(i)+.5+shift,f+.5);
      // No two scales grow quite in line or quite the same size.
      float grow=fishHash(c+5.3);c+=(vec2(fishHash(c+3.7),fishHash(c+9.1))-.5)*.16;
      vec2 d=(p-c)/(SCALE_R*(.92+.16*grow));
      if(dot(d,d)<1.&&c.x<bestX){bestX=c.x;best=d;id=fishHash(c);}
    }
  }
  return vec3(best,id);
}
// A scale rises from its buried front to a rounded shoulder at its free margin.
float fishScaleHeight(vec2 d){return (.55+.45*d.x)*(1.-smoothstep(.74,1.,length(d)));}`;
const NOISE_GLSL=`
float fishHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float fishNoise(vec2 p){vec2 i=floor(p),f=fract(p);f*=f*(3.-2.*f);
  return mix(mix(fishHash(i),fishHash(i+vec2(1,0)),f.x),mix(fishHash(i+vec2(0,1)),fishHash(i+vec2(1,1)),f.x),f.y);}`;

/** The skin, fin and eye shading for one species. Every animal of that species shares
 *  this material; what differs between them travels in the per-instance aFishTrim:
 *  x tail phase, y beat amplitude, z a per-animal shade — relative body size on the
 *  clownfish, where the black borders broaden with age — and w the sexed-up individual,
 *  the terminal male anthias or the chromis holding the nest. aFishGait carries the
 *  rest of the animal's motion: x the pectoral phase, y how hard the pectorals row, z the
 *  body's bend into a turn. */
function fishMaterial(kind) {
  const S=SPECIES[kind],[rows,files,relief]=S.scales,[hinge,margin,thin]=S.veil,L=landmarks(kind);
  // percula rows with its pectorals hard enough to drive the whole fish and only folds
  // them in for a caudal burst; the two open-water species use theirs to trim and hover,
  // so their stroke is smaller than the tail that carries them.
  const stroke=kind==='clown'?[.050,.034]:kind==='chromis'?[.024,.010]:[.030,.014];
  return fromBelow(underwater(new THREE.MeshStandardMaterial({roughness:.38,metalness:0,side:THREE.DoubleSide,transparent:true,forceSinglePass:true}),{
    key:`fish-${kind}`,transmission:'fishTransmission',wrap:'fishWrap',
    // fishSpecular is the reflectance itself, the platelets' tint rather than a fixed
    // dielectric one; underwater() scales three's 4%, hence the 25.
    specular:'fishSpecular*25.',
    vertex:`attribute float part;attribute vec2 finRay;attribute vec4 aFishTrim;attribute vec4 aFishGait;varying float vPart;varying vec3 vAnatomy;varying vec2 vSkinUv;varying vec2 vTrim;varying vec2 vRay;
      #define fishTrim aFishTrim
      #define fishGait aFishGait
      // The propulsive wave grows toward the tail, and a turn bends the whole body the same
      // way: a fish turns as a C, not as a rigid arrow swung about its middle.
      float fishFlex(float x) {float q=clamp((.30-x)/1.14,0.,1.);return (sin(fishTrim.x-q*3.7)*fishTrim.y+fishGait.z)*q*q;}
      float fishSlope(float x){float q=clamp((.30-x)/1.14,0.,1.);return -(2.*q*(fishTrim.y*sin(fishTrim.x-q*3.7)+fishGait.z)-3.7*q*q*fishTrim.y*cos(fishTrim.x-q*3.7))/1.14;}`,
    normal:`objectNormal=normalize(vec3(normal.x-fishSlope(position.x)*normal.z,normal.y,normal.z));`,
    begin:`vPart=part;vAnatomy=position;vSkinUv=uv;vTrim=fishTrim.zw;vRay=finRay;
      transformed.z+=fishFlex(position.x);
      // A pectoral rows through an abduction–adduction cycle rather than flapping: the
      // blade sweeps out and then back along the flank, so the stroke has a fore-aft part.
      if(part>1.5&&part<3.5){
        float hinge=clamp((.30-position.x)*3.4,0.,1.),row=sin(fishGait.x)*fishGait.y;
        transformed.z+=sign(position.z)*row*hinge*${n(stroke[0])};
        transformed.x-=row*hinge*hinge*${n(stroke[1])};
      }
      ${kind==='anthias'?`// Both sexes carry the lyre and a prolonged third dorsal spine; on the terminal
      // male the lobe tips run out a little further and that spine stands about twice the
      // fin height, not the whips the species is often drawn with.
      if(part>.5&&part<1.5){
        if(position.x<${n(axis(kind,1))}){float lobe=uv.y*uv.y*smoothstep(.12,.24,abs(position.y));transformed.x-=fishTrim.w*.12*lobe;transformed.y+=sign(position.y)*fishTrim.w*.035*lobe;}
        else if(position.y>.10){float spine=uv.y*uv.y*exp(-pow((uv.x-.150)/.034,2.));transformed.y+=(.045+.11*fishTrim.w)*spine;transformed.x-=.05*fishTrim.w*spine;}
      }`:''}`,
    fragment:`varying float vPart;varying vec3 vAnatomy;varying vec2 vSkinUv;varying vec2 vTrim;varying vec2 vRay;
      float fishTransmission=${n(FLESH[kind])};float fishWrap=.4;vec3 fishSpecular=vec3(.02);float fishSilver=0.;vec3 fishScaleHit=vec3(0.,0.,.5);float fishFine=0.;vec2 fishScaleRate=vec2(1.);const vec2 fishGrain=vec2(480.,170.);
      ${NOISE_GLSL}${SCALES_GLSL}${reliefGLSL(kind)}`,
    color:`
      // The material is double sided for the fins; the body's inner face is never seen and
      // would otherwise be shaded under the outer one.
      if(vPart<.5&&!gl_FrontFacing)discard;
      float u=vSkinUv.x,band=vSkinUv.y,span=clamp(vSkinUv.y,0.,1.);
      // Scales are largest at mid-flank and shrink toward the back, the belly, the head and
      // the peduncle. They fade in behind the scaleless snout, stay faint over the small
      // embedded scales of the cheek and gill cover, and fade out once one falls under a pixel.
      vec2 scaleAt=vec2(${n(rows)}*(u+.025*sin(6.2832*u)),${n(files)}*(band+.03*sin(6.2832*band)));
      fishScaleRate=vec2(${n(rows)}*(1.+.1571*cos(6.2832*u)),${n(files)}*(1.+.1885*cos(6.2832*band)));
      // Each fine term is searched for only where it can show, which on a wallpaper is most
      // of the time nowhere: a fish a few hundred pixels long has no visible scale, pore or
      // grain, and skipping them is most of what the skin costs. fishFine falls from 1 to 0
      // as a hundredth of the body's length shrinks to a pixel.
      fishFine=1.-smoothstep(.0025,.007,max(fwidth(vSkinUv.x),fwidth(vSkinUv.y)));
      float scaleDetail=(1.-smoothstep(.22,.60,max(fwidth(scaleAt.x),fwidth(scaleAt.y))))*(.12+.88*smoothstep(${n(S.gill[0]-.05)},${n(S.gill[0]+S.gill[1]+.12)},u))*smoothstep(.07,.16,u)*smoothstep(.03,.12,band)*(1.-smoothstep(.93,.99,u));
      // A frugal frame (FISH_COARSE, eco) leaves the scales and the micro relief out at any
      // distance; the pigment pattern, the sheen and the fins carry the fish there.
      #ifdef FISH_COARSE
      scaleDetail=0.;fishFine=0.;
      #endif
      if(scaleDetail>0.)fishScaleHit=fishScale(scaleAt);
      float scaleCore=(1.-smoothstep(.10,.75,length(fishScaleHit.xy)))*scaleDetail;
      if(vPart<.5){
        float silver=0.;
        ${SKIN[kind]}
        // Each scale's pigment cells were laid down on their own: a slightly different shade.
        // Close up the colour itself is grained, the chromatophores showing as specks.
        skin*=1.+(fishScaleHit.z-.5)*${n(Math.min(.12,relief*.6))}*scaleDetail;
        vec2 cells=vSkinUv*fishGrain*1.7;
        float speck=1.-smoothstep(.25,.7,max(fwidth(cells.x),fwidth(cells.y)));
        if(speck>0.)skin*=1.-.10*smoothstep(.62,.9,fishNoise(cells))*speck;
        // The mouth's cleft and the gill cover's margin are shaded cavities as well as
        // relief: the slit is dark inside, and the flank under the cover's edge is in its
        // shadow.
        float gill=${n(S.gill[0])}+${n(S.gill[1])}*sin(3.1416*span);
        skin*=1.-.10*smoothstep(gill-.004,gill+.004,u)*(1.-smoothstep(gill+.004,gill+.020,u))*smoothstep(.12,.26,band)*(1.-smoothstep(.78,.92,band));
        if(fishFine>0.)skin*=1.-.22*fishPores(vSkinUv)*fishFine;
        skin*=1.-.55*exp(-pow((band-${mouthBand(kind)})/.008,2.))*(1.-smoothstep(${n(S.mouth.corner*.8)},${n(S.mouth.corner)},u));
        // A scale's buried front is a shade darker than its exposed margin, and pigment
        // cells are never laid on evenly: a soft mottle, a little different on every fish.
        skin*=1.-${n(.10*relief)}*(1.-fishScaleHeight(fishScaleHit.xy))*scaleDetail;
        skin*=1.-${n(.6*relief)}*smoothstep(.70,.95,length(fishScaleHit.xy))*scaleDetail;
        skin*=.90+.20*fishNoise(vec2(u*23.,band*8.)+vTrim.x*17.);
        // Countershading, spread down the upper flank rather than drawn as a dark line along
        // the ridge, and a per-animal shift, so no two of a species read identical.
        skin*=1.-.20*(1.-smoothstep(0.,.32,band));
        skin*=vec3(.93+.14*vTrim.x,.96+.08*vTrim.x,1.03-.10*vTrim.x);
        diffuseColor.rgb=skin;
        fishSilver=silver*(.70+.60*fishScaleHit.z)*mix(1.,.6,scaleDetail*(1.-fishScaleHeight(fishScaleHit.xy)));
        fishTransmission=${n(FLESH[kind])}*(1.+silver*${kind==='clown'?'2.5':'0.'});
      }else if(vPart<3.5){
        // Which fin this is. The three median fins are lofted from one sheet, so a caudal
        // is told from a dorsal by sitting behind the gap between the anal fin's last ray
        // and the front of the tail, and an anal from a dorsal by sitting below the spine.
        float tail=step(vAnatomy.x,${n(axis(kind,1)+.06)}),below=step(vAnatomy.y,0.);
        float paired=step(1.5,vPart),pelvic=step(2.5,vPart),ink=0.;
        float axial=(${n(SNOUT)}-vAnatomy.x)/${n(S.len)};
        ${FINS[kind]}
        // The rays: bone splints in the membrane. A soft ray is jointed every few
        // millimetres and forks in its outer half; a spine is neither.
        float spine=step(.5,vRay.y),ray=abs(fract(vRay.x+.5)-.5);
        float fork=(1.-spine)*.16*smoothstep(.45,1.,span),aaRay=max(fwidth(vRay.x),.02);
        float rib=1.-smoothstep(.03,.03+aaRay*1.5,abs(ray-fork+.04*(fishNoise(vec2(vRay.x*7.,span*3.))-.5)));
        rib*=1.-(1.-spine)*.10*smoothstep(.80,.97,cos(span*${n(Math.PI*2/.075)}))*step(.18,span);
        diffuseColor.rgb=web*(.94+.14*rib)*(.94+.12*vTrim.x);
        // The membrane between the splints is a couple of cell layers, clear enough to see
        // the water through; the rays and the melanin carry most of the opacity. Thickest
        // at the hinge, thinnest at the free margin, and the paired fins thinner again.
        float veil=(${n(margin)}+${n(hinge-margin)}*pow(1.-span,1.4))*(.78+.22*rib)*(paired>.5?.70:1.);
        // Toward the free edge the membrane thins to a film the rays outrun, so a fin has no
        // edge of its own: the web between the rays fades first, the rays last, each ray to
        // its own length, and the margin breaks up ray by ray instead of ending on a line.
        float tip=fishNoise(vec2(vRay.x*2.3,7.));
        float fade=1.-smoothstep(${n(thin)}+.10*tip,1.+.06*tip,span-.06*rib);
        ink*=1.-smoothstep(.93,1.,span);
        diffuseColor.a=max(veil*fade,ink);
        if(diffuseColor.a<.02)discard;
        // A fin is a film far thinner than light's scattering length in it, so what it
        // carries spreads all round it.
        fishTransmission=.85*(1.-.5*ink);fishWrap=.8;fishSpecular=vec3(.012);
      }else{
        vec2 e=vSkinUv;float r=length(e),angle=atan(e.y,e.x),pupil=${n(S.eye.pupil)};
        ${EYE[kind]}
        // A fish's pupil fills most of the eye: the iris is only a narrow ring round it,
        // radially fibred, dusky at the pupil's margin and paling outward until, toward
        // the rim, the cornea is the head's own skin and the eye fades into it.
        float fibre=.55*fishNoise(vec2(angle*9.55,r*6.))+.45*fishNoise(vec2(angle*25.5,r*11.));
        vec3 eyeColor=iris*(.80+.30*fibre)*mix(.50,1.,smoothstep(pupil,pupil+.18,r));
        eyeColor*=1.-.35*smoothstep(.68,.85,fishNoise(e*14.+3.));
        eyeColor=mix(eyeColor,rim,smoothstep(.70,.94,r));
        diffuseColor.rgb=mix(vec3(.004,.005,.007),eyeColor,smoothstep(pupil-.02,pupil+.01,r));
        diffuseColor.a=1.-smoothstep(.86,1.02,r);
        fishTransmission=0.;fishSpecular=vec3(.035);
      }
    `,
    surfaceNormal:`
      {
        // The body's relief, as a bump on the shading normal: finite differences across
        // the analytic height field, carried to the screen through uv's own derivatives.
        float body=1.-step(.5,vPart);
        vec2 q=vSkinUv,du=vec2(.0012,0.);
        vec2 grad=vec2(0.);
        if(fishFine>0.&&body>.5){float h0=fishRelief(q);grad=vec2(fishRelief(q+du.xy)-h0,fishRelief(q+du.yx)-h0)/.0012*fishFine;}
        // Each scale's shoulder, and its own small tilt: the platelets of neighbouring
        // scales never face quite the same way, so a highlight breaks scale by scale.
        vec2 d=fishScaleHit.xy;float s0=fishScaleHeight(d);
        vec2 sgrad=vec2(fishScaleHeight(d+vec2(.02,0.))-s0,fishScaleHeight(d+vec2(0.,.02))-s0)/(.02*SCALE_R);
        // Skin is never a polished shell: a fine grain of cells and mucus breaks every
        // highlight up, fading out once it falls under a pixel.
        vec2 grain=q*fishGrain,dg=vec2(.35,0.);float grainFade=1.-smoothstep(.25,.7,max(fwidth(grain.x),fwidth(grain.y)));
        if(fishFine>0.&&grainFade>0.&&body>.5){float g0=fishNoise(grain);grad+=vec2(fishNoise(grain+dg.xy)-g0,fishNoise(grain+dg.yx)-g0)/.35*fishGrain*.00005*grainFade;}
        grad+=(sgrad*${n(.0016*relief)}+(vec2(fishHash(vec2(fishScaleHit.z,7.)),fishHash(vec2(fishScaleHit.z,3.)))-.5)*${n(.012*relief)})*fishScaleRate*scaleDetail;
        vec2 dh=vec2(dot(grad,dFdx(vSkinUv)),dot(grad,dFdy(vSkinUv)))*body;
        vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition),r1=cross(sy,normal),r2=cross(normal,sx);
        float det=dot(sx,r1)*faceDirection;
        if(body>.5&&abs(det)>1e-12)normal=normalize(abs(det)*normal-sign(det)*(dh.x*r1+dh.y*r2));
      }
      if(vPart<.5){
        float nv=abs(dot(normal,normalize(vViewPosition)));
        float flank=smoothstep(.06,.30,vSkinUv.y)*(1.-smoothstep(.70,.95,vSkinUv.y));
        // The platelets are a stack of thin films: their colour slides as the angle to the
        // eye changes, and every scale starts the slide from its own place.
        vec3 film=.5+.5*cos(6.2832*(${n(FILM[kind])}*(1.-nv)+fishScaleHit.z*.18+vec3(0.,.33,.67)));
        float silver=fishSilver;
        fishSpecular=vec3(.012)+(${SHEEN[kind]})*mix(vec3(1.),film*1.6,.40)*(.35+.65*flank)*(.75+.5*vTrim.x);
        // Mucus over scales is wet; each scale's margin breaks it, and the dorsal ridge
        // and the belly keel stay a little rougher, or the back reads as a white stripe.
        roughnessFactor=.30-.10*fishSilver+.08*(1.-smoothstep(.12,.30,vSkinUv.x))+.20*(1.-smoothstep(.05,.26,vSkinUv.y))+.08*smoothstep(.78,1.,vSkinUv.y)
          +.10*scaleDetail*(1.-fishScaleHeight(fishScaleHit.xy))+.06*fishNoise(vSkinUv*vec2(60.,20.));
      }else if(vPart>3.5){
        // The lens is glass-smooth under the cornea; the iris round it is a touch softer.
        roughnessFactor=mix(.05,.40,smoothstep(${n(S.eye.pupil-.02)},${n(S.eye.pupil+.04)},length(vSkinUv)));
      }else{
        // A fin is a membrane stretched between round splints and the geometry pleats it;
        // each ray's own roundness is added here so a ray takes its own thin highlight.
        float ray=fract(vRay.x+.5)-.5;
        normal=normalize(normal+vec3(.20,.08,0.)*clamp(ray*6.,-1.,1.)*(1.-smoothstep(.05,.18,abs(ray))));
        roughnessFactor=.50;
      }
    `,
  }));
}
// The scene's ground light is the sand's bounce, set for the rock and coral that stand on
// it. A fish hangs well up in the water column, where what the bed sends back has come up
// through the water, is bluer and much weaker than the light from above; given the full
// warm bounce, an orange belly glowed as brightly as the lit back and the fish read as
// evenly lit stickers. Its underside instead falls off toward the water's own blue, the
// more so the higher the fish swims.
function fromBelow(material){
  const compile=material.onBeforeCompile;
  material.onBeforeCompile=(shader,renderer)=>{
    compile(shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      {float under=smoothstep(.15,-.85,inverseTransformDirection(normal,viewMatrix).y)*smoothstep(.8,4.,vReefWorld.y);
      reflectedLight.indirectDiffuse*=mix(vec3(1.),vec3(.30,.40,.62),under);
      reflectedLight.indirectSpecular*=1.-.5*under;}`);
  };
  return material;
}

/** Two draw calls per species rather than one per animal: the same muscle-wave shader over
 *  the FULL model for the fish near the camera and the FAR one for the rest, with
 *  per-instance phase, gait and transform. `update(camera)` sorts them each frame; without
 *  a camera every fish is drawn FULL.
 */
// How large a fish must stand in the frame to be drawn FULL: its size over its distance,
// in half frame heights, so a unit of fish spanning an eighth of the frame or more.
const NEAR=.25;
export function createFishSchool(scene,simulation){
  const groups=[];
  for(const kind of ['clown','chromis','anthias']){
    const fish=simulation.fish.filter(f=>f.kind===kind),material=fishMaterial(kind);
    const lod=res=>{
      const geometry=makeFishGeometry(kind,res);
      const data=new Float32Array(fish.length*4),attribute=new THREE.InstancedBufferAttribute(data,4).setUsage(THREE.DynamicDrawUsage);
      const gait=new Float32Array(fish.length*4),gaitAttribute=new THREE.InstancedBufferAttribute(gait,4).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aFishTrim',attribute);geometry.setAttribute('aFishGait',gaitAttribute);
      const mesh=new THREE.InstancedMesh(geometry,material,fish.length);mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh); // tiny fixed population, shader-deformed bounds
      // A fish under an overhang is in its shadow. They cast none: the shadow map is drawn
      // once, for the rock, and a frozen fish silhouette on the sand would be worse than none.
      mesh.receiveShadow=true;
      return {data,attribute,gait,gaitAttribute,mesh};
    };
    const near=lod(FULL),far=lod(FAR);
    // Trim z shades each animal a little differently — for the clownfish it instead
    // carries relative size, because percula's black borders broaden with age and the
    // biggest fish on an anemone is the blackest. Trim w marks the sexed-up individual:
    // the terminal male anthias, and the chromis holding the nest.
    const largest=Math.max(...fish.map(f=>f.size));
    groups.push({fish,...near,lods:[near,far],material,trim:fish.map((f,i)=>[kind==='clown'?f.size/largest:(i*.6180339887+.31)%1,(kind==='anthias'||kind==='chromis')&&f.rank===0?1:0])});
  }
  const dummy=new THREE.Object3D(),euler=new THREE.Euler(0,0,0,'YZX');
  return {
  /** Eco drops the scales and the micro relief (FISH_COARSE). */
  setQuality(quality){
    const coarse=quality==='eco';
    for(const {material} of groups){if(Boolean(material.defines?.FISH_COARSE)===coarse)continue;
      material.defines=coarse?{FISH_COARSE:1}:{};material.needsUpdate=true;}
  },
  update(camera){
    for(const group of groups){
      const [near,far]=group.lods;near.mesh.count=far.mesh.count=0;
      for(let i=0;i<group.fish.length;i++){
        const f=group.fish[i];
        const lod=!camera||f.size*camera.projectionMatrix.elements[5]>NEAR*f.position.distanceTo(camera.position)?near:far,k=lod.mesh.count++;
        dummy.position.copy(f.position);dummy.scale.setScalar(f.size);euler.set(f.roll,f.yaw,f.pitch);dummy.quaternion.setFromEuler(euler);dummy.updateMatrix();lod.mesh.setMatrixAt(k,dummy.matrix);
        // The simulation owns effort and amplitude. No hidden idle oscillation here;
        // a coast is straight. The travelling wave runs from the head toward the tail.
        lod.data.set([f.phase,f.tailAmplitude,...group.trim[i]],k*4);
        lod.gait.set([f.pectoral,f.rowing,f.bend,0],k*4);
      }
      for(const {attribute,gaitAttribute,mesh} of group.lods){attribute.needsUpdate=true;gaitAttribute.needsUpdate=true;mesh.instanceMatrix.needsUpdate=true;}
    }
  },groups};
}
