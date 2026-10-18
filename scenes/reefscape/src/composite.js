import * as THREE from 'three';
import { extinctionGLSL, inscatterGLSL, shadowGLSL, waterTime, causticMap } from './water.js';
import { createPostprocessing } from '../../shared/postprocessing.js';

// What each quality profile spends on the pass. Eco keeps the contact shading and the
// water's glow at fewer samples and drops the lens, whose defocus and bloom read the
// beauty pass at mip levels that would otherwise be rebuilt every frame.
const PROFILES={eco:{ao:5,volume:5,lens:false},full:{ao:10,volume:10,lens:true}};
// The lens: how far out of focus a subject at twice the focus distance falls, in pixels at
// 972 px of frame height, and the widest blur allowed. A long lens on a tank is shallow,
// but this is a wallpaper, not a macro shot, so only the far water and the nearest flecks
// soften.
const DEFOCUS=1.8,MAX_DEFOCUS=6;
// Bloom: the share of light above the knee that spreads, and the knee in linear radiance.
const BLOOM=.055,BLOOM_KNEE=.9;
// White balance, as linear RGB gains: a touch warm, as a camera set for a reef tank keeps
// the sand from going cold without losing the actinic cast.
const WHITE_BALANCE=[1.02,1.0,1.0];
export function createComposite(camera,shadow) {
  const composite=createPostprocessing(camera, { uniforms: {...shadow,reefTime:waterTime,reefCaustics:causticMap,focus:{value:10},eye:{value:new THREE.Vector3()},rayX:{value:new THREE.Vector3()},rayY:{value:new THREE.Vector3()},rayZ:{value:new THREE.Vector3()}},
    fragmentShader: `uniform sampler2D beauty;uniform sampler2D depth;uniform vec2 size;uniform vec2 nearFar;uniform float aoRadiusScale;
      uniform vec3 eye;uniform vec3 rayX;uniform vec3 rayY;uniform vec3 rayZ;uniform float reefTime;uniform float focus;varying vec2 vUv;
      #include <packing>
      ${extinctionGLSL}${shadowGLSL}${inscatterGLSL}
      float distanceAt(vec2 p){float z=texture2D(depth,p).x;return nearFar.x*nearFar.y/(nearFar.y-z*(nearFar.y-nearFar.x));}
      // A lens's lateral colour: red lands a hair outside green toward the frame edge, blue
      // a hair inside. Read at a mip level, so the same fetch does the defocus.
      vec3 lens(vec2 uv,float lod){
        vec2 spread=(uv-.5)*.0009;
        return vec3(textureLod(beauty,uv+spread,lod).r,textureLod(beauty,uv,lod).g,textureLod(beauty,uv-spread,lod).b);
      }
      vec3 bloomAt(vec2 uv,float lod){
        vec2 texel=exp2(lod)/size;
        vec3 c=textureLod(beauty,uv+texel*vec2(.5,.5),lod).rgb+textureLod(beauty,uv+texel*vec2(-.5,.5),lod).rgb
          +textureLod(beauty,uv+texel*vec2(.5,-.5),lod).rgb+textureLod(beauty,uv+texel*vec2(-.5,-.5),lod).rgb;
        return max(c*.25-${BLOOM_KNEE.toFixed(3)},0.);
      }
      void main(){
        float center=distanceAt(vUv);
        // Thin-lens circle of confusion, as a mip level: a pixel's neighbourhood averaged
        // over the blur radius. Mild, and soft-edged where near meets far.
        #ifdef LENS
        float blur=min(${MAX_DEFOCUS.toFixed(1)},${DEFOCUS.toFixed(2)}*abs(1.-focus/center))*size.y/972.;
        vec3 color=lens(vUv,log2(max(1.,blur)));
        #else
        vec3 color=texture2D(beauty,vUv).rgb;
        #endif
        float occlusion=0.;
        for(int i=0;i<AO_SAMPLES;i++){
          float a=float(i)*2.399963;float radius=2.5+float(i)*14.85/float(AO_SAMPLES-1);
          float difference=center-distanceAt(vUv+vec2(cos(a),sin(a))*radius*aoRadiusScale/size);
          occlusion+=smoothstep(.012,.13,difference)*(1.-smoothstep(.2,.8,difference));
        }
        // Open water (the back wall and the surface, which write zero alpha) occludes nothing.
        color*=max(.0,1.-occlusion*1.32/float(AO_SAMPLES)*texture2D(beauty,vUv).a);
        // Light through water is a volume, not a backdrop: march the camera ray from the
        // front glass to the first surface and sum what the water scatters back along it,
        // each sample thinned by the water between it and the glass and dark where the rock
        // shades it from the lamp. The march stops at the depth buffer, so a near rock
        // carries less of the glow than the open water beside it. A per-pixel offset turns
        // the steps of a short march into fine grain instead of contour bands.
        vec3 forward=normalize(rayZ);
        vec3 ray=normalize(rayZ+rayX*(vUv.x*2.-1.)+rayY*(vUv.y*2.-1.));
        float air=reefAirPath(eye,ray);
        float span=clamp(center/max(.05,dot(ray,forward))-air,0.,34.);
        float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
        vec3 glow=vec3(0.);
        for(int i=0;i<VOLUME_SAMPLES;i++){
          float s=span*(float(i)+jitter)/float(VOLUME_SAMPLES);vec3 p=eye+ray*(air+s);
          glow+=reefInscatter(p,ray,reefTime,reefLit(p))*reefTransmittance(s);
        }
        color+=glow*span/float(VOLUME_SAMPLES);
        // Bloom from the brightest light only: the LED bank in Snell's window and the
        // glitter on wet tissue spread a little into the dark water around them.
        #ifdef LENS
        color+=(bloomAt(vUv,2.)*.25+bloomAt(vUv,3.5)*.35+bloomAt(vUv,5.)*.4)*${BLOOM.toFixed(3)}*8.;
        #endif
        color*=vec3(${WHITE_BALANCE.join(',')});
        float vignette=dot((vUv-.5)*vec2(1.,.85),(vUv-.5)*vec2(1.,.85));color*=1.-vignette*.16;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // Fine film grain on the display values, strongest in the mid-tones, where a real
        // sensor's noise sits; it also breaks up banding in the dark water gradient.
        float noise=fract(sin(dot(gl_FragCoord.xy+fract(reefTime*7.13)*97.,vec2(12.9898,78.233)))*43758.5453)
          +fract(sin(dot(gl_FragCoord.yx+fract(reefTime*3.71)*61.,vec2(39.346,11.135)))*24634.6345)-1.;
        float luma=dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722));
        gl_FragColor.rgb+=noise*.010*(.35+luma*(1.-luma)*2.6);
      }`
  });
  /** Switch the pass to a quality profile's budget. */
  function setQuality(quality){
    const {ao,volume,lens}=PROFILES[quality==='eco'?'eco':'full'],{post,target}=composite;
    if(post.defines.AO_SAMPLES===ao&&Boolean(post.defines.LENS)===lens)return;
    post.defines={AO_SAMPLES:ao,VOLUME_SAMPLES:volume,...(lens?{LENS:1}:{})};post.needsUpdate=true;
    // Bloom and defocus read the beauty pass at coarser mip levels, built after each render.
    // The target's storage is fixed when it is first drawn to, so disposing it lets the
    // renderer allocate it again with or without the mip chain.
    target.texture.generateMipmaps=lens;target.texture.minFilter=lens?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;target.dispose();
  }
  setQuality('detail');
  return {...composite,setQuality};
}
