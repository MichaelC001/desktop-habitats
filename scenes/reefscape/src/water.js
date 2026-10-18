import * as THREE from 'three';
import { groundHeight, smoothstep } from './math.js';
import { TANK } from './layout.js';

export const waterTime={value:0};
export const SURFACE=TANK.surface;
// The lamp bank hangs over the tank, a little toward the front-left, so its light comes
// down nearly vertical: an overhang shades what is under it and the arch's passage is
// dark, which a lamp leaning in from the camera side can never show. The key light, its
// shadow map and the glitter the surface draws on the bed all take this one direction, so
// a shadow and the caustic line at its foot lean the same way, which is what stops the
// light reading as two unrelated patterns pasted onto one scene.
export const LAMP=(()=>{const l=Math.hypot(-2.2,13,2.0);return {x:-2.2/l,y:13/l,z:2.0/l};})();
// How far up that direction the lamp bank hangs: the key light's position, and the point
// the shafts in the water fan out from.
export const LAMP_RANGE=14.2;
// Surface ripples, at the actual aquarium depth (10 cm/unit), not ocean swell.
// omega² = g k tanh(kh). Pump circulation below is a separate forced flow.
const g=98.1,h=SURFACE;
// Eleven components from 30 cm down to 5 cm, their directions a golden angle apart so no
// two run parallel, each with the same curvature (amplitude falling as 1/k²). Curvature
// is what folds the lamp's rays, so every octave draws its share of the net of cells on
// the bed, instead of a few long waves drawing stripes.
const WAVE_CURVATURE=.05;
export const WAVES=Array.from({length:11},(_,i)=>{
  const k=2.1*1.19**i,angle=.18+i*2.39996;
  return {a:WAVE_CURVATURE/(k*k),k,angle,phase:(i*1.618034%1)*6.2832,dx:Math.cos(angle),dz:Math.sin(angle),omega:Math.sqrt(g*k*Math.tanh(k*h))};
});
// The set keeps its dispersion-correct shape but the glitter runs at a fortieth of real
// time. At full speed a 30 cm ripple sweeps its cells across the bed at 70 cm/s, the
// flicker of a tank with a wavemaker on, and the eleven-wave net, with the shafts drawn
// from the same map, still flickered at a fifteenth. The swell below runs on this clock
// too. The rate is tuned to how the glitter reads on a wallpaper watched for hours, not to
// any physical rate: the cells should drift over the coral, not flicker.
const RIPPLE_TIME=.025;
const n=x=>Number(x).toFixed(7);
// Two opposed circulation pumps. Slow alternating strength and a recirculating
// return path approximate wavemaker flow; no claim of solving Navier–Stokes.
const PULSES=[{amp:.25,omega:.88,phase:.2},{amp:.115,omega:.49,phase:1.8}];
function base(p,out){
  const y=Math.max(0,Math.min(h,p.y));
  const wall=Math.max(0,1-(p.x/9.65)**8),bed=.12+.88*smoothstep(0,.9,p.y-groundHeight(p.x,p.z));
  const horizontal=(.64+.36*Math.sin(Math.PI*y/h))*wall*bed;
  out.set(horizontal,.045*Math.sin(p.x*.30)*Math.sin(Math.PI*y/h),.12*Math.sin(p.x*.23+p.z*.37)*horizontal);
  return out;
}
export function currentAt(p,t,out){
  base(p,out);let drive=.10;
  for(const q of PULSES)drive+=q.amp*Math.cos(q.omega*t+q.phase);
  return out.multiplyScalar(drive);
}
export function responseAt(p,t,tau,out){
  base(p,out);let drive=.10;
  for(const q of PULSES)drive+=q.amp*Math.cos(q.omega*t+q.phase-Math.atan(q.omega*tau))/Math.sqrt(1+(q.omega*tau)**2);
  return out.multiplyScalar(drive);
}
// groundHeight from math.js as a GLSL expression of a vec2 (x, z).
const bedHeight=p=>`(-.30+.12*sin(${p}.x*.49+${p}.y*.22)+.075*sin(${p}.y*.75-${p}.x*.25)+.25*exp(-((${p}.x-6.)*(${p}.x-6.)/17.+(${p}.y+1.)*(${p}.y+1.)/13.)))`;
// Same coefficients and analytic tau db/dt + b = u response as the CPU.
export const responseGLSL=`
float reefBed(vec2 p){return ${bedHeight('p')};}
vec2 reefResponse(vec3 p,float t,float tau){
  float y=clamp(p.y,0.,${n(h)});
  float boundary=(.12+.88*smoothstep(0.,.9,p.y-reefBed(p.xz)))*max(0.,1.-pow(p.x/9.65,8.));
  float profile=(.64+.36*sin(3.14159265*y/${n(h)}))*boundary;
  float drive=.10;
  ${PULSES.map(q=>`drive+=${n(q.amp)}*cos(${n(q.omega)}*t+${n(q.phase)}-atan(${n(q.omega)}*tau))/sqrt(1.+pow(${n(q.omega)}*tau,2.));`).join('\n')}
  return vec2(profile,.12*sin(p.x*.23+p.z*.37)*profile)*drive;
}`;
// The wave set at surface point q, ripple time st and real time t, as GLSL. A real
// surface is never a sum of straight crests: three slow fields bend every wave's crests,
// and three slow swells raise and lower each set over a minute or so. They are shared
// across the set so each wave costs one sine. Both vary far more slowly than a crest, so
// the slopes below treat them as constant.
const waveField=`vec3 warp=1.1*sin(vec3(dot(q,vec2(.62,.31)),dot(q,vec2(-.27,.58)),dot(q,vec2(.45,-.50)))+st*vec3(.13,-.17,.11)+vec3(0.,2.1,4.2));
  vec3 swell=1.+.35*sin(st*vec3(.09,.071,.113)+vec3(1.,3.3,5.6));`;
// One wave: declares its phase `w` and amplitude `a`.
const wave=(w,i)=>`float w=${n(w.k)}*dot(q,vec2(${n(w.dx)},${n(w.dz)}))-${n(w.omega)}*st+${n(w.phase)}+warp[${i%3}];float a=${n(w.a)}*swell[${(i+1)%3}];`;
const IOR=1.333;
// The caustics are traced, not guessed. Every frame a grid of points on the surface each
// bends the lamp's ray through its own facet and drops it onto two levels of the tank, the
// sand and the rock tops; the grid, deformed to where its rays land, is drawn additively
// into a small map, each patch as bright as its area on the surface over its area where it
// landed. Rays that converge pile into the bright net; folded patches overlap and add.
// The bed, rock, corals and the surface's mirror read the map where their own unbent ray
// crossed the surface, and the shafts in the water read it too, so each shaft comes down
// onto its own line of light.
//
// The rays fan out gently from a virtual source far up the refracted lamp direction over
// the tank's middle: the bank is a long bar near the water, so its light spreads a little
// across the tank, much less than from a single point. At the middle the rays come down
// exactly along the key light, so a shadow and the caustics at its foot still agree.
const FAN_HEIGHT=34;
// Horizontal travel per unit depth of the lamp's ray once bent into flat water.
const DESCENT=(()=>{const x=-LAMP.x/IOR,z=-LAMP.z/IOR,y=Math.sqrt(1-x*x-z*z);return {x:x/y,z:z/y};})();
const FAN={x:-DESCENT.x*FAN_HEIGHT,y:h+FAN_HEIGHT,z:1-DESCENT.z*FAN_HEIGHT};
// The surface ripples are gentle, but the lamp's optics focus them hard; the facets are
// tilted this much more than the waves' own slopes, which with water's index makes their
// rays bend .85 times the slope: with the chop's finer folds the net comes to its
// sharpest at the sand and is still gathering on the rock tops.
const LENS_GAIN=.85/(1-1/IOR);
// The map covers every surface point whose unbent ray reaches the bed or the water in
// view, in the surface's own coordinates; at detail one texel is 2 cm of surface.
const CAUSTIC_MAP={x:-11.5,z:-4.4,width:22,depth:11.6};
// The two levels the rays are dropped onto: the sand and the tops of the rock. Between
// them the map blends; above the rock tops the light has not yet focused and evens out
// toward the surface.
const SLICES=[0,3.2];
// A fold has zero area where it lands, so its brightness is capped, as the bank's
// size and the water's blur cap a real one.
const CAUSTIC_PEAK=10;
// The share of each frame's splat that enters the map; the rest is the frames before it.
const CAUSTIC_BLEND=.1;
// Grid points per side, and the map's size, by quality. The net's own scale is set by the
// waves, so a coarser grid into a smaller map keeps its look at eco, only softer.
const CAUSTIC_GRID={eco:[224,118],balanced:[320,168],detail:[448,236],native:[448,236]};
const CAUSTIC_TEXELS={eco:[384,202],balanced:[512,270],detail:[1024,540],native:[1024,540]};
// The finest ripples cast too: the first chop waves, at these shares of their seen slope,
// fold the lamp's rays into the fine filaments inside the swell's broad cells. Their seen
// slope is steeper than the light they cast, as the swell's is.
const CAST_CHOP=[.25,.2,.15];
// Rock and coral stand among the light rather than under a flat sheet of it: their rough,
// curved faces spread each line, so above the sand the net is blurred this much more and
// its contrast scaled down, and lit rock reads gently dappled.
const RAISED_BLUR=.06,RAISED_CONTRAST=.55;
// The caustics' blur radius per unit depth, and the share of the light that never focuses.
const CAUSTIC_SOFTNESS=.0025,CAUSTIC_DIFFUSE=.3;
export const causticMap={value:null};
// Shared by every shader that reads the map; guarded, because the irradiance and the
// in-scatter both need it and some shaders take both.
const causticMapGLSL=`
#ifndef REEF_CAUSTIC_MAP
#define REEF_CAUSTIC_MAP
uniform sampler2D reefCaustics;
// Where the lamp's unbent ray through p crossed the surface, on the map.
vec2 reefCausticUV(vec3 p){
  vec2 fan=vec2(${n(FAN.x)},${n(FAN.z)});
  return (fan+(p.xz-fan)*${n(FAN_HEIGHT)}/max(${n(FAN.y)}-p.y,1.)-vec2(${n(CAUSTIC_MAP.x)},${n(CAUSTIC_MAP.z)}))/vec2(${n(CAUSTIC_MAP.width)},${n(CAUSTIC_MAP.depth)});
}
// Off the map's edge the light is even.
float reefCausticCover(vec2 uv){vec2 e=min(uv,1.-uv)*vec2(${n(CAUSTIC_MAP.width)},${n(CAUSTIC_MAP.depth)});return smoothstep(0.,1.,min(e.x,e.y));}
#endif`;
export const causticGLSL=`${causticMapGLSL}
// The lamp's light arriving at p, its caustics blurred over the given radius, and never
// sharper than the map's own texels, so a close view never sees them.
vec3 reefIrradianceBlurred(vec3 p,float blur){
  float depth=clamp(${n(h)}-p.y,.02,9.),texels=blur*float(textureSize(reefCaustics,0).x)/${n(CAUSTIC_MAP.width)};
  // Four taps a blur radius apart, each read from the mip level whose texels span that
  // radius, so the blur is smooth however wide it gets.
  vec2 uv=reefCausticUV(p),r=blur*max(1.,.7/texels)/vec2(${n(CAUSTIC_MAP.width)},${n(CAUSTIC_MAP.depth)});
  float lod=max(0.,log2(texels));
  vec2 slices=.25*(textureLod(reefCaustics,uv+r*vec2(1.,.4),lod).rg+textureLod(reefCaustics,uv+r*vec2(-.4,1.),lod).rg
    +textureLod(reefCaustics,uv-r*vec2(1.,.4),lod).rg+textureLod(reefCaustics,uv-r*vec2(-.4,1.),lod).rg);
  float shallow=${n(h-SLICES[1])};
  slices.g=mix(1.,slices.g,${n(RAISED_CONTRAST)});
  float focus=depth<shallow?mix(1.,slices.g,depth/shallow):mix(slices.g,slices.r,min(1.,(depth-shallow)/${n(SLICES[1]-SLICES[0])}));
  // A share of the bank's light reaches every point by too many paths to focus, so the
  // cells between the lines hold a mid-tone instead of going dark.
  focus=mix(1.,${n(CAUSTIC_DIFFUSE)}+${n(1-CAUSTIC_DIFFUSE)}*focus,reefCausticCover(uv));
  // The bank sits over the front half of the tank, so the rear hardscape is lit at a slant
  // and through more water: it falls off toward the back wall instead of meeting it lit.
  float reach=.46+.54*smoothstep(-4.6,-.6,p.z);
  float path=depth*length(p-vec3(${n(FAN.x)},${n(FAN.y)},${n(FAN.z)}))/(${n(FAN.y)}-p.y);
  return reefDownwelling(path)*focus*reach;
}
// The bank is not a point, so the farther below the surface, the softer each line.
vec3 reefIrradiance(vec3 p,float t){return reefIrradianceBlurred(p,(${n(h)}-p.y)*${n(CAUSTIC_SOFTNESS)}+${n(RAISED_BLUR)}*smoothstep(.4,1.5,p.y));}`;
/** The splatting pass that draws the caustic map into `causticMap` each frame, before the
 *  beauty pass reads it. */
export function createCaustics(){
  const map=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter});
  causticMap.value=map.texture;
  const uniforms={reefTime:waterTime,texels:{value:new THREE.Vector2(1,1)},blend:{value:1}};
  const scene=new THREE.Scene(),camera=new THREE.Camera();
  // The grid runs this far past the map on every side, so rays bent in from beyond its
  // edge still land on it.
  const margin=1;
  const slice=(y,channel)=>new THREE.ShaderMaterial({uniforms,side:THREE.DoubleSide,depthTest:false,depthWrite:false,
    blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
    vertexShader:`uniform float reefTime;uniform vec2 texels;varying vec2 vSource;
      void main(){
        vec2 origin=vec2(${n(CAUSTIC_MAP.x)},${n(CAUSTIC_MAP.z)}),size=vec2(${n(CAUSTIC_MAP.width)},${n(CAUSTIC_MAP.depth)});
        vec2 q=origin-${n(margin)}+(position.xy+.5)*(size+${n(2*margin)});
        float t=reefTime,st=t*${n(RIPPLE_TIME)};vec2 slope=vec2(0.);
        ${waveField}
        ${WAVES.map((w,i)=>`{${wave(w,i)}slope+=a*${n(w.k)}*vec2(${n(w.dx)},${n(w.dz)})*cos(w);}`).join('\n        ')}
        ${CHOP.slice(0,CAST_CHOP.length).map((c,i)=>`slope+=${n(CAST_CHOP[i])}*${chop(c,i)};`).join('\n        ')}
        // The lamp's ray in air that flat water would bend onto the fan, bent instead by
        // this point's facet.
        vec3 fan=vec3(${n(FAN.x)},${n(FAN.y)},${n(FAN.z)}),unbent=normalize(vec3(q.x,${n(h)},q.y)-fan);
        vec3 air=vec3(unbent.x*${n(IOR)},0.,unbent.z*${n(IOR)});air.y=-sqrt(max(0.,1.-dot(air.xz,air.xz)));
        vec3 ray=refract(air,normalize(vec3(-${n(LENS_GAIN)}*slope.x,1.,-${n(LENS_GAIN)}*slope.y)),${n(1/IOR)});
        vec2 landed=q+ray.xz*${n(h-y)}/max(-ray.y,.2);
        // Back onto the map along the fan, so an unbent ray lands where it started.
        vec2 onMap=fan.xz+(landed-fan.xz)*${n(FAN_HEIGHT/(FAN.y-y))};
        vSource=(q-origin)/size*texels;
        gl_Position=vec4((onMap-origin)/size*2.-1.,0.,1.);
      }`,
    fragmentShader:`uniform float blend;varying vec2 vSource;
      void main(){
        // The patch's area on the surface, in texels, per texel it covers where it landed.
        vec2 dx=dFdx(vSource),dy=dFdy(vSource);
        gl_FragColor=vec4(${channel}*min(abs(dx.x*dy.y-dx.y*dy.x),${n(CAUSTIC_PEAK)})*blend,0.);
      }`});
  const materials=[slice(SLICES[0],'vec3(1.,0.,0.)'),slice(SLICES[1],'vec3(0.,1.,0.)')];
  const meshes=materials.map(m=>{const mesh=new THREE.Mesh(new THREE.BufferGeometry(),m);mesh.frustumCulled=false;scene.add(mesh);return mesh;});
  // Splatting is aliased: the same ray density lands differently on the texels from one
  // frame to the next, which shows as frame-rate sparkle. Each frame is averaged into the
  // map over a few frames instead, and the first after a resize fills it outright.
  const fade=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
    blending:THREE.CustomBlending,blendSrc:THREE.ZeroFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:'uniform float blend;void main(){gl_FragColor=vec4(0.,0.,0.,blend);}'}));
  fade.frustumCulled=false;fade.renderOrder=-1;scene.add(fade);
  let tier=null,fresh=true;
  return {
    setQuality(quality){
      const next=CAUSTIC_GRID[quality]?quality:'balanced';if(next===tier)return;tier=next;
      const [columns,rows]=CAUSTIC_GRID[tier],[tw,th]=CAUSTIC_TEXELS[tier],grid=new THREE.PlaneGeometry(1,1,columns-1,rows-1);
      for(const mesh of meshes){mesh.geometry.dispose();mesh.geometry=grid;}
      map.setSize(tw,th);uniforms.texels.value.set(tw,th);fresh=true;
    },
    render(renderer){
      uniforms.blend.value=fresh?1:CAUSTIC_BLEND;fresh=false;
      const clear=renderer.autoClear;renderer.autoClear=false;
      renderer.setRenderTarget(map);renderer.render(scene,camera);renderer.autoClear=clear;
    },
    dispose(){meshes[0].geometry.dispose();materials.forEach(m=>m.dispose());map.dispose();},
  };
}
// Clear reef water, per unit (10 cm), with absorption and scattering kept apart. Water
// absorbs red fastest and blue least; suspended matter scatters, a little more at short
// wavelengths. Every line of sight loses light to both, so the far rock is dimmer and
// bluer and the back of the tank sinks toward deep blue; but the scattering also sends
// light back, so distance fades into blue haze rather than black. The path is measured
// from the front glass, because every camera stands in air in front of the tank. One
// extinction serves every surface, the motes, the back wall, the surface and the post
// pass's own march.
export const ABSORB=[.045,.016,.010];
export const SCATTER=[.012,.016,.020];
export const EXTINCTION=ABSORB.map((a,i)=>a+SCATTER[i]);
// Light heading down keeps most of what scatters forward, so it fades with the diffuse
// attenuation coefficient, the usual Kd ≈ 1.25a + .25s, rather than the full extinction.
const DOWNWELLING=ABSORB.map((a,i)=>1.25*a+.25*SCATTER[i]);
// The tank's rear pane is lost in the blue, so the back wall is painted as this much more
// water carrying on past it, and the surface's mirror shows the same water at its horizon.
export const BEYOND=14;
export const extinctionGLSL=`
float reefAirPath(vec3 eye,vec3 ray){return eye.z>${n(TANK.front)}?(eye.z-${n(TANK.front)})/max(-ray.z,.05):0.;}
float reefWaterPath(vec3 p,vec3 eye){vec3 ray=p-eye;float d=length(ray);return max(0.,d-reefAirPath(eye,ray/max(d,1e-5)));}
vec3 reefTransmittance(float path){return exp(-vec3(${EXTINCTION.map(n).join(',')})*path);}
vec3 reefDownwelling(float depth){return exp(-vec3(${DOWNWELLING.map(n).join(',')})*depth);}`;
// The light the water column holds, which its scattering sends toward the eye. The diffuse
// part is the lamp's white and actinic light after it has spread through the water, so it
// is already the clear royal blue of a reef tank, a little cyan just under the surface, where
// it is strongest, and deeper blue as it fades with depth. A shaft is the light on its
// way to one of the caustic net's lines, so it reads the caustic map where its own ray
// left the surface. The map is read at a coarser level the deeper the point, as the
// water's forward scattering widens a shaft on its way down, and its contrast against
// the broad mean around it is raised, since a shaft is only the strongest of the lines
// carried up into the water. Shafts carry the lamp's own cool white.
const WATER_LIGHT=[.03,.085,.38],SHAFT_LIGHT=[.30,.42,.60];
// How widely the map is averaged for a shaft just under the surface and at the bed, in
// units; how many mip levels coarser the mean a shaft stands out from is; how hard it
// stands out; and the level below which a stretch of water holds no shaft at all.
const SHAFT_BLUR=[.6,.8],SHAFT_SPREAD=2,SHAFT_CONTRAST=6,SHAFT_FLOOR=.75,SHAFT_GAIN=.6;
// Water scatters mostly forward: a shaft is brightest seen looking up toward the lamp and
// faint seen across. Two Henyey-Greenstein lobes, a sharp forward one and a broad one,
// scaled so that light scattered evenly in every direction would read 1.
const PHASE=[[.35,.8],[.65,.35]];
export const inscatterGLSL=`${causticMapGLSL}
float reefShafts(vec3 p,float t){
  float depth=clamp(${n(h)}-p.y,0.,${n(h)});
  vec2 uv=reefCausticUV(p);
  float lod=log2(mix(${n(SHAFT_BLUR[0])},${n(SHAFT_BLUR[1])},depth/${n(h)})*float(textureSize(reefCaustics,0).x)/${n(CAUSTIC_MAP.width)});
  float line=textureLod(reefCaustics,uv,lod).r,mean=textureLod(reefCaustics,uv,lod+${n(SHAFT_SPREAD)}).r;
  float shaft=max(0.,mean+${n(SHAFT_CONTRAST)}*(line-mean)-${n(SHAFT_FLOOR)});
  // Brightest under the bank, fading toward the tank's ends.
  float across=uv.x*${n(CAUSTIC_MAP.width)}+${n(CAUSTIC_MAP.x)};
  return ${n(SHAFT_GAIN)}*shaft*exp(-across*across/90.)*reefCausticCover(uv);
}
vec3 reefAmbientLight(vec3 p){
  float depth=clamp(${n(h)}-p.y,0.,12.);
  return vec3(${WATER_LIGHT.map(n).join(',')})*reefDownwelling(depth)*(.25+.75*exp(-.45*depth));
}
vec3 reefBeamLight(vec3 p,float t,float lit){
  // A shaft needs some water to scatter in before it shows, so none is drawn on the surface.
  float depth=clamp(${n(h)}-p.y,0.,12.);
  return vec3(${SHAFT_LIGHT.map(n).join(',')})*reefDownwelling(depth)*reefShafts(p,t)*lit*exp(-.1*depth)*smoothstep(.1,1.,depth);
}
float reefPhase(vec3 ray){
  float mu=dot(ray,vec3(${n(LAMP.x)},${n(LAMP.y)},${n(LAMP.z)}));
  ${PHASE.map(([w,g])=>`float hg${Math.round(g*100)}=${n(1-g*g)}/pow(${n(1+g*g)}-${n(2*g)}*mu,1.5);`).join('')}
  return ${PHASE.map(([w,g])=>`${n(w)}*hg${Math.round(g*100)}`).join('+')};
}
vec3 reefInscatter(vec3 p,vec3 ray,float t,float lit){
  return vec3(${SCATTER.map(n).join(',')})*(reefAmbientLight(p)+reefBeamLight(p,t,lit)*reefPhase(ray));
}
// The water past the back pane, as the back wall paints it: the glow of BEYOND more units
// of it seen from p along ray.
vec3 reefFarWater(vec3 p,vec3 ray,float t){
  vec3 extinction=vec3(${EXTINCTION.map(n).join(',')});
  return reefInscatter(p,ray,t,1.)*(1.-exp(-extinction*${n(BEYOND)}))/extinction;
}`;
// The underside of the surface, seen from below. A ray meeting a facet steeper than the
// critical angle (48.6 degrees off its normal) is turned back by total internal reflection,
// so most of the surface seen from inside a tank is a rippling mirror of the lit water and
// reef under it. Inside Snell's window the facet opens onto the air above: the lit hood and,
// where the refracted ray finds it, the LED bank itself, small and very bright. Fresnel
// fades one into the other at the window's edge, so the boundary is a soft silver ring
// rather than a cut. The swell is the dispersion-correct set above; the chop is finer, and
// only its longest waves cast, faintly. It thins with distance, as a surface does
// once its facets fall below what a pixel resolves, so it never sparkles into aliasing.
const CHOP=[[13.,.3,.9,.06],[19.,-1.1,1.4,.05],[27.,.8,2.1,.04],[38.,2.,2.9,.03],[53.,-.6,3.6,.022]].map(([k,angle,speed,slope])=>({k,dx:Math.cos(angle),dz:Math.sin(angle),speed,slope}));
// One chop wave's slope at surface point q and real time t, as GLSL.
const chop=(c,i)=>`${n(c.slope)}*vec2(${n(c.dx)},${n(c.dz)})*cos(${n(c.k)}*dot(q,vec2(${n(c.dx)},${n(c.dz)}))+${n(c.speed)}*t*.1+${(i*1.7+.4).toFixed(2)}*sin(q.y*.9+q.x*.4))`;
// The swell drawn on the underside is steeper than the one that casts the caustics: the
// caustic set stands for what the lamp focuses, this for what the eye sees of it.
const SURFACE_RELIEF=3;
// The bed and reef as the mirror shows them: sand and rock under the key light, before the
// caustics and the water between.
const BED_SEEN=[.36,.36,.32],MIRROR_BLUR=.02;
// The fixture over the tank: a bar of LED clusters along x at the lamp's height, each a
// soft disc a few degrees across. The environment map paints the same bank.
export const LED_BANK={y:LAMP.y*LAMP_RANGE,z:LAMP.z*LAMP_RANGE,xs:[-7.5,-2.5,2.5,7.5],radius:.9,radiance:9};
/** What a glossy surface in the tank reflects, as an equirectangular HDR map: the LED bank
 *  squeezed into Snell's window overhead, the silvered underside of the surface around
 *  it, the deep blue water at the horizon and the warm bed below. three prefilters it for
 *  roughness, so the bank becomes a soft highlight on a wet fish and a faint sheen on rock. */
export function createEnvironment(){
  const W=256,H=128,data=new Uint16Array(W*H*4),half=THREE.DataUtils.toHalfFloat,eye=[0,4,0],critical=Math.asin(1/IOR);
  const bank=LED_BANK.xs.map(x=>{const d=[x-eye[0],LED_BANK.y-eye[1],LED_BANK.z-eye[2]],l=Math.hypot(...d);return {d:d.map(v=>v/l),r:LED_BANK.radius/l};});
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const lat=((y+.5)/H-.5)*Math.PI,lon=((x+.5)/W-.5)*2*Math.PI,dir=[Math.cos(lat)*Math.cos(lon),Math.sin(lat),Math.cos(lat)*Math.sin(lon)];
    const up=Math.max(0,dir[1]),zenith=Math.acos(Math.min(1,up));
    // Water body toward the horizon, warm bed bounce below.
    let c=[.004,.016,.045].map((v,i)=>v*(1-smoothstep(.0,.9,-dir[1]))+[.034,.032,.026][i]*smoothstep(.1,.9,-dir[1]));
    // The underside of the surface: a dim mirror out to the window's edge, a bright ring at it.
    const ring=Math.exp(-(((zenith-critical)/.06)**2)),mirror=smoothstep(.15,.6,up);
    c=c.map((v,i)=>v+[.010,.030,.065][i]*mirror+[.05,.09,.13][i]*ring);
    if(zenith<critical){
      // Inside the window, a direction is the air direction bent toward the vertical.
      const air=Math.asin(Math.min(1,Math.sin(zenith)*IOR)),s=Math.sin(air)/Math.max(1e-5,Math.sin(zenith));
      const a=[dir[0]*s,Math.cos(air),dir[2]*s];let led=0;
      for(const b of bank){const dot=a[0]*b.d[0]+a[1]*b.d[1]+a[2]*b.d[2],r=b.r*1.4;led+=smoothstep(1-r*r*.5*1.8,1-r*r*.5*.3,dot);}
      // The key light already carries the bank's direct light; this is only its image.
      c=c.map((v,i)=>v*.4+[.020,.032,.045][i]+[.86,.92,1][i]*LED_BANK.radiance*.2*led);
    }
    for(let i=0;i<3;i++)data[(y*W+x)*4+i]=half(c[i]);data[(y*W+x)*4+3]=half(1);
  }
  const texture=new THREE.DataTexture(data,W,H,THREE.RGBAFormat,THREE.HalfFloatType);
  texture.mapping=THREE.EquirectangularReflectionMapping;texture.colorSpace=THREE.LinearSRGBColorSpace;
  texture.magFilter=texture.minFilter=THREE.LinearFilter;texture.needsUpdate=true;return texture;
}
export const surfaceGLSL=`
vec3 reefAboveWater(vec3 s,vec3 ray){
  // The hood over a reef tank is lit by its own lamps and reflects them, so through the
  // window it reads as a bright cyan-white, brightest straight up.
  vec3 light=vec3(.30,.48,.70)*(.4+.6*ray.y);
  ${LED_BANK.xs.map(x=>`{vec3 to=vec3(${n(x)},${n(LED_BANK.y)},${n(LED_BANK.z)})-s;float d=length(to),c=max(dot(ray,to/d),0.);
    float r=${n(LED_BANK.radius)}/d;
    light+=vec3(.78,.84,1.)*(${n(LED_BANK.radiance)}*smoothstep(1.-r*r*.8,1.-r*r*.2,c)+.6*pow(c,24.))+vec3(.42,.52,1.)*(.5*pow(c,10.)+.1*pow(c,4.));}`).join('\n')}
  return light;
}
vec3 reefSurfaceUnderside(vec3 s,vec3 dir,float t){
  vec2 q=s.xz;float st=t*${n(RIPPLE_TIME)};vec2 slope=vec2(0.);
  // A wave finer than a couple of pixels cannot be drawn, only aliased, so each fades out
  // as its wavelength nears the pixel's footprint on the surface.
  float footprint=length(fwidth(q));
  ${waveField}
  ${WAVES.map((w,i)=>`{${wave(w,i)}slope+=(1.-smoothstep(.5,1.4,${n(w.k)}*footprint))*a*${n(w.k*SURFACE_RELIEF)}*vec2(${n(w.dx)},${n(w.dz)})*cos(w);}`).join('\n  ')}
  ${CHOP.map((c,i)=>`slope+=(1.-smoothstep(.5,1.4,${n(c.k)}*footprint))*${chop(c,i)};`).join('\n  ')}
  vec3 facet=normalize(vec3(-slope.x,1.,-slope.y));
  float cosI=clamp(dot(dir,facet),0.,1.),sin2T=${n(IOR*IOR)}*(1.-cosI*cosI);
  // The mirror holds the water under the surface. Turned back nearly level it shows the
  // water's own glow; turned steeper by a facet it finds the lit bed and reef, caught in
  // their caustics and veiled by the water between, so every ripple is a bright line on
  // one flank and the blue water on the other, and the underside reads as one membrane.
  vec3 down=reflect(dir,facet);
  vec3 water=vec3(${SCATTER.map(n).join(',')})*reefAmbientLight(s-vec3(0.,1.,0.))*(1.-exp(-vec3(${EXTINCTION.map(n).join(',')})*${n(BEYOND)}))/vec3(${EXTINCTION.map(n).join(',')});
  vec3 bed=vec3(s.x,${bedHeight('s.xz')},s.z);
  vec3 veil=reefTransmittance((s.y-bed.y)/max(-down.y,.12));
  // Seen in a rippled mirror, the caustics below are softened further.
  vec3 lit=vec3(${BED_SEEN.map(n).join(',')})*reefIrradianceBlurred(bed,${n(MIRROR_BLUR)});
  vec3 mirror=mix(water,water*(1.-veil)+lit*veil,smoothstep(.0,.45,-down.y));
  float cosT=sqrt(max(1.-sin2T,0.));
  vec3 refracted=normalize(${n(IOR)}*dir+(cosT-${n(IOR)}*cosI)*facet);
  // Schlick's approximation from the air side, where it holds through the window's edge.
  // A pixel spans many facets, so the edge of total reflection is a soft band, not a cut.
  float fresnel=max(.02+.98*pow(1.-cosT,5.),smoothstep(.55,1.,sin2T));
  return mix(reefAboveWater(s,refracted),mirror,fresnel);
}`;
// The key light's own shadow map, read by whatever lights the water itself: a mote in
// the arch's shadow stays dark because the lamp never reached it. The map is three's
// RGBA-packed depth, so <packing> must precede this.
export const shadowGLSL=`uniform sampler2D reefShadowMap;uniform mat4 reefShadowMatrix;
float reefLit(vec3 p){vec4 c=reefShadowMatrix*vec4(p,1.);c.xyz/=c.w;
  if(c.x<0.||c.x>1.||c.y<0.||c.y>1.||c.z>1.)return 1.;
  return step(c.z,unpackRGBAToDepth(texture2D(reefShadowMap,c.xy))+.0015);}`;

// The actinic channel of the LED bank: royal-blue emitters with a few violet ones, linear
// RGB. It deepens the tank's blue a little, but its real work is exciting the corals'
// fluorescent proteins; the white channel and the water carry the overall colour. The
// light itself is built in main.js; fluorescent tissue reads the same numbers.
export const ACTINIC=(()=>{const l=Math.hypot(3,12,-2);return {color:[.12,.24,1],intensity:.85,x:3/l,y:12/l,z:-2/l};})();
// Water against tissue or stone: ((1.40-1.33)/(1.40+1.33))^2 is far below the air-side
// .04, but wet surfaces are never optically clean, so a quarter of .04 (F0 .01) stands.
const UNDERWATER_SPECULAR=.25;
// A GLSL float, or vec3 when `vec`, from a number, an [r,g,b] array or a GLSL expression.
const glsl=(v,vec=false)=>Array.isArray(v)?`vec3(${v.map(n).join(',')})`:typeof v==='number'?(vec?`vec3(${n(v)})`:n(v)):`(${v})`;
/** PBR lighting with short in-water paths. Camera air path is deliberately excluded.
 *  Geometry is kept in the bounded tank; neither fog nor sun rays hide bad modelling.
 *
 *  The string hooks splice GLSL into three's standard/physical shaders. The optional
 *  tissue terms are all off by default:
 *  - `transmission`: thin-tissue translucency, the share of light striking the far side of
 *    a membrane that comes through it (0 to about .6). A number, or a GLSL float
 *    expression evaluated per fragment, so a tentacle can pass more at its tip than at
 *    its base. It is energy-normalised like the diffuse term and leans toward the viewer
 *    when the light is behind the tissue.
 *  - `wrap`: how far the light carried through the tissue spreads round toward its lit
 *    face, 0 to 1. A membrane lets it out of its far side only (.4, the default); a strand
 *    thinner than light's scattering length in tissue, a bubble-tip's tentacle or a sea
 *    fan's mesh, glows all round (about .8). A number or a GLSL float expression.
 *  - `transmissionColor`: what the tissue does to the light passing through it, as an
 *    [r,g,b] array or GLSL vec3 expression. Defaults to the surface's own diffuse colour.
 *  - `specular`: scales the surface's reflectance at normal incidence (F0). Tissue, shell
 *    and stone meet water, not air, and the smaller step in refractive index reflects far
 *    less than three's air-side F0 of .04; the default .25 gives F0 .01. 1 restores air.
 *    A number, or a GLSL float or vec3 expression evaluated per fragment, so a wet eye or
 *    a mucus-glazed patch can shine more than the skin around it, and a fish's guanine
 *    platelets can reflect in their own tint.
 *  - `contact`: true to darken ambient light near the sand bed, where the bed blocks the
 *    light the water sends from below, so an animal close to the sand sits on it rather
 *    than floating. The screen-space pass in composite.js already shades contact with
 *    rock and coral.
 *  - `fluorescence`: fluorescent pigment, the colour re-emitted per unit of absorbed
 *    actinic light, as an [r,g,b] array or GLSL vec3 expression evaluated per fragment, so
 *    it can read a per-vertex pigment or light only a polyp's mouth (about .2 to 1.5 per
 *    channel; green-fluorescent protein is near [.25,1,.35]). It glows under the blue
 *    channel only, so it reads as a coral's fluorescence rather than as paint: it shows on
 *    the shaded side of a branch the key light never reaches, dimmed only by the water
 *    between the lamp and the tissue and between the tissue and the eye.
 *  - `recede`: how far the surface has sunk into the water beyond the back pane, 0 to 1,
 *    as a number or GLSL float expression. At 1 it shows exactly what the back wall paints
 *    there, so a bed running under the rear glass dissolves into the water instead of
 *    stopping at a line, and the post pass's contact shading leaves it alone as it does the wall.
 */
export function underwater(material,{vertex='',begin='',normal='',fragment='',color='',map='',surfaceNormal='',key='reef',transmission=0,wrap=.4,transmissionColor=null,fluorescence=null,specular=UNDERWATER_SPECULAR,contact=false,recede=0}={}){
  const actinic=`vec3(${n(ACTINIC.x)},${n(ACTINIC.y)},${n(ACTINIC.z)})`;
  material.onBeforeCompile=shader=>{
    shader.uniforms.reefTime=waterTime;shader.uniforms.reefCaustics=causticMap;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nuniform float reefTime;varying vec3 vReefWorld;${vertex}`)
      .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>\n${normal}`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>\n${begin}`)
      .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>\nvec4 reefPosition=vec4(transformed,1.);
      #ifdef USE_INSTANCING
      reefPosition=instanceMatrix*reefPosition;
      #endif
      vReefWorld=(modelMatrix*reefPosition).xyz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform float reefTime;varying vec3 vReefWorld;vec3 reefLight=vec3(1.);${extinctionGLSL}${causticGLSL}${recede?inscatterGLSL:''}${fragment}`)
      .replace('#include <map_fragment>',map||'#include <map_fragment>')
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+surfaceNormal)
      .replace('#include <color_fragment>',`#include <color_fragment>\n${color}`)
      .replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
      #undef RE_Direct
      void RE_Direct_Reef(const in IncidentLight directLight,const in vec3 geometryPosition,const in vec3 geometryNormal,const in vec3 geometryViewDir,const in vec3 geometryClearcoatNormal,const in PhysicalMaterial material,inout ReflectedLight reflectedLight){
        IncidentLight light=directLight;light.color*=reefLight;
        RE_Direct_Physical(light,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
        ${transmission?`{// Light striking the far face, wrapped past the terminator, diffused through
        // the membrane and scattered mostly onward, so backlit tissue glows when seen against
        // the lamp and only faintly from the side.
        float wrap=${glsl(wrap)},back=clamp(dot(-geometryNormal,light.direction)*(1.-wrap)+wrap,0.,1.);
        float forward=pow(clamp(dot(-geometryViewDir,light.direction),0.,1.),3.);
        reflectedLight.directDiffuse+=light.color*${transmissionColor?glsl(transmissionColor,true):'material.diffuseColor'}*RECIPROCAL_PI*back*back*(.55+1.2*forward)*${glsl(transmission)};}`:''}
      }
      #define RE_Direct RE_Direct_Reef`)
      .replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
      material.specularColor*=${glsl(specular)};`)
      .replace('#include <lights_fragment_begin>','reefLight=reefIrradiance(vReefWorld,reefTime);\n#include <lights_fragment_begin>')
      .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      ${contact?`reflectedLight.indirectDiffuse*=mix(.45,1.,smoothstep(0.,.9,vReefWorld.y-${bedHeight('vReefWorld.xz')}));`:''}
      ${fluorescence?`{vec3 actinicView=normalize((viewMatrix*vec4(${actinic},0.)).xyz);
        float absorbed=${n(ACTINIC.intensity*ACTINIC.color[2])}*reefLight.b*(.35+.65*max(dot(normal,actinicView),0.));
        totalEmissiveRadiance+=${glsl(fluorescence,true)}*absorbed*RECIPROCAL_PI;}`:''}`)
      .replace('#include <opaque_fragment>',`${recede?`outgoingLight=mix(outgoingLight,reefFarWater(vReefWorld,normalize(vReefWorld-cameraPosition),reefTime),${glsl(recede)});`:''}
        outgoingLight*=reefTransmittance(reefWaterPath(vReefWorld,cameraPosition));
        #include <opaque_fragment>
        ${recede?`// As open water it takes no contact shading in the post pass, as the back wall takes none.
        gl_FragColor.a*=1.-${glsl(recede)};`:''}`);
  };
  material.customProgramCacheKey=()=>key;return material;
}
