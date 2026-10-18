import { randomGenerator, clamp } from './math.js';

export const REACH=.90;
const GOLDEN=Math.PI*(3-Math.sqrt(5)),ROOT_RADIUS=.24;
// Tentacles on a host of unit scale; a crown grows with the disc's area and a little more.
export const HOST_DENSITY=180;
// The host's column height in units of its scale: short, most of it in the rock.
export const HOST_COLUMN=.30;

// The host is a bubble-tip anemone (Entacmaea quadricolor) in full expansion: a dense
// crown of several hundred slender tentacles of uneven length standing up and out from
// the disc. Compact is an explicit shape choice for the small specimens, not a claim that
// every juvenile has short tentacles. All lengths here are in tank units.
export function crownProfile(spec){
  const S=spec.radius/REACH,compact=spec.form==='compact';
  // Each cycle doubles the last, as an anemone's tentacle cycles do, densely enough to hide the disc.
  const cycles=compact?(S>.65?[10,10,20,40,80]:S>.40?[8,8,16,32]:[8,8,16]):null;
  return {S,compact,rim:compact?.53:.36,height:compact?.43:HOST_COLUMN,
    count:compact?cycles.reduce((a,b)=>a+b,0):Math.round(HOST_DENSITY*Math.pow(S,1.3)),cycles};
}

export function buildCrown(spec,index=0){
  const profile=crownProfile(spec),{S,compact,count,cycles,rim}=profile;
  // Separate streams: editing one little crown cannot reshuffle the finished host.
  const rng=randomGenerator(8945+index*977),roots=[];
  if(!compact){
    for(let i=0;i<count;i++){
      const rr=Math.sqrt(ROOT_RADIUS*ROOT_RADIUS+(1-ROOT_RADIUS*ROOT_RADIUS)*(i+.5)/count),ring=(rr-ROOT_RADIUS)/(1-ROOT_RADIUS);
      const angle=i*GOLDEN+(rng()-.5)*.44,radius=clamp(rr+(rng()-.5)*.10,ROOT_RADIUS*.9,1);
      // Short, thick tentacles of uneven length, as in a living crown where some are
      // extending and others contracting: a mound of bulbs, not a burst of long fingers.
      // The outer rings are no longer than the inner; they lean out and droop instead.
      const length=.40*Math.pow(S,1.15)*(.92-.12*ring)*(.62+.60*rng()),girth=.025*Math.pow(S,.90)*(.70+.60*rng()**1.5);
      // The outer rings droop over the rim and hide the column; a few tentacles hook sharply.
      const tilt=.18+.95*Math.pow(ring,1.2)+(rng()-.5)*.24,curl=(.10+.55*rng())*(.55+.75*ring)+(rng()<.12?.6:0);
      roots.push({angle,radius,ring,length,girth,tilt,curl,tone:rng(),lag:rng(),seed:rng(),flex:1});
    }
  }else{
    // Successive, staggered tentacle cycles around a bare oral centre, not random spines
    // on a sphere. The small angular/radial jitter removes a machined rosette appearance.
    // Inner tentacles are a little longer; the outer ones form a short, outward skirt.
    const radii=cycles.length===5?[.26,.38,.52,.68,.89]:cycles.length===4?[.31,.47,.66,.89]:[.35,.60,.88];
    const turn=rng()*Math.PI*2,diameter=2*rim*S;
    cycles.forEach((n,c)=>{
      for(let i=0;i<n;i++){
        const ring=c/(cycles.length-1),angle=turn+(i+(c%2)*.5+(rng()-.5)*.23)*Math.PI*2/n;
        const radius=radii[c]+(rng()-.5)*.022;
        const length=diameter*(.43-.14*ring)*(.90+.20*rng());
        roots.push({angle,radius,ring,length,girth:diameter*.044*(.88+.22*rng()),
          tilt:.20+.68*ring+(rng()-.5)*.10,curl:.13+.24*rng(),tone:rng(),lag:rng(),seed:rng(),flex:.46+.12*rng()});
      }
    });
    // Density and diameter must agree. Cap root radii to the nearest neighbour spacing;
    // otherwise densely packed crowns fuse into one lump where the tentacles emerge.
    for(const a of roots){
      let near=Infinity;
      for(const b of roots)if(a!==b)near=Math.min(near,Math.hypot(Math.cos(a.angle)*a.radius-Math.cos(b.angle)*b.radius,Math.sin(a.angle)*a.radius-Math.sin(b.angle)*b.radius)*rim*S);
      a.girth=Math.min(a.girth,near*.42);
    }
  }
  return {...profile,roots};
}

// Farthest-point ordering makes every prefix spatially balanced. Arbitrarily dropping
// every nth instance left small crowns with holes and could under-sample an entire one.
export function crownOrder(roots){
  const order=[],used=new Uint8Array(roots.length),distance=new Float64Array(roots.length).fill(Infinity);
  let next=0;
  for(let n=0;n<roots.length;n++){
    order.push(next);used[next]=1;const a=roots[next];
    for(let i=0;i<roots.length;i++)if(!used[i]){
      const b=roots[i],d=(Math.cos(a.angle)*a.radius-Math.cos(b.angle)*b.radius)**2+(Math.sin(a.angle)*a.radius-Math.sin(b.angle)*b.radius)**2;
      distance[i]=Math.min(distance[i],d);
    }
    next=-1;for(let i=0;i<roots.length;i++)if(!used[i]&&(next<0||distance[i]>distance[next]))next=i;
  }
  return order;
}

export function crownBudget(crown,quality){
  const fraction=quality==='eco'?.57:quality==='balanced'?.70:1;
  return Math.min(crown.count,Math.max(crown.compact?36:0,Math.round(crown.count*fraction)));
}
