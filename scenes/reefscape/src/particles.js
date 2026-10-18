import * as THREE from 'three';
import { randomGenerator } from './math.js';
import { currentAt, extinctionGLSL, shadowGLSL, inscatterGLSL, waterTime, causticMap } from './water.js';

/** Suspended matter. Real tank water is never optically empty: there is always detritus
 *  and marine snow drifting in the circulation, and it is most of what tells the eye the
 *  water has a front and a back. It is sparse in a clean reef tank, so a light dusting:
 *  flecks that occlude a little and catch the lamp, not points of light. A fleck is sized
 *  by its own distance, so the near ones read as soft out-of-focus discs and the far ones
 *  as fine haze, and it is lit by the same light the water around it scatters, so it
 *  brightens in a shaft and toward the surface and goes dark in the rock's shadow. */
// The share of the light reaching a fleck that it sends back toward the eye: dun detritus
// has a low albedo, and a fleck seen edge-on shows little of it.
const MOTE_GAIN=.8;
export function createParticles(scene,simulation,shadow){
  const rng=randomGenerator(846),N=2200,pos=new Float32Array(N*3),vel=new THREE.Vector3(),point=new THREE.Vector3();
  // grain.x scales the fleck, grain.y its brightness, grain.z a phase for its own small
  // tumble in the eddies. A few large slow flecks among many fine ones.
  const grain=new Float32Array(N*3),sink=new Float32Array(N);
  for(let i=0;i<N;i++){
    pos.set([(rng()-.5)*21,rng()*8,-4+rng()*10],i*3);
    const big=rng()<.06,size=big?1.4+rng()*1.2:.45+rng()*.55;
    grain.set([size,big?.45+rng()*.3:.7+rng()*.6,rng()*6.283],i*3);
    sink[i]=(big?.016:.006)+rng()*.008;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('grain',new THREE.BufferAttribute(grain,3));
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{pixelRatio:{value:1},reefTime:waterTime,reefCaustics:causticMap,...shadow},
    vertexShader:`uniform float pixelRatio;uniform float reefTime;attribute vec3 grain;varying vec3 glow;varying float disc,opacity;
      #include <packing>
      ${extinctionGLSL}${shadowGLSL}${inscatterGLSL}
      void main(){
        // Eddies too small for the circulation field: each fleck wanders a few millimetres.
        vec3 p=position+.035*vec3(sin(reefTime*.41+grain.z),sin(reefTime*.33+grain.z*1.7),cos(reefTime*.37+grain.z*2.3));
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
        // A fleck close to the lens is a soft disc the size of the lens's blur circle, not a
        // sharper point; its opacity spreads with it so it never reads as a bright blob.
        disc=clamp(22.*grain.x/(-mv.z),1.5,16.);gl_PointSize=disc*pixelRatio;
        opacity=min(1.,4./disc)*.85;
        // A fleck is large beside a wavelength, so it scatters the lamp's light without the
        // water's own blue cast: brightness from the water around it, colour from its own
        // dun detritus, blue only from the water between it and the glass.
        vec3 light=reefAmbientLight(p)+reefBeamLight(p,reefTime,reefLit(p));
        vec3 path=reefTransmittance(reefWaterPath(p,cameraPosition));
        glow=grain.y*${MOTE_GAIN.toFixed(1)}*dot(light,vec3(.3,.4,.3))*vec3(.92,.90,.82)*path;
        // Far flecks dissolve into the water rather than stay as specks on top of it.
        opacity*=dot(path,vec3(.2,.4,.4));
      }`,
    fragmentShader:`varying vec3 glow;varying float disc,opacity;
      void main(){vec2 c=gl_PointCoord-.5;float a=exp(-dot(c,c)*12.)*opacity;if(a<.004)discard;gl_FragColor=vec4(glow,a);}`});
  const points=new THREE.Points(g,mat);points.frustumCulled=false;scene.add(points);
  const foodGeo=new THREE.SphereGeometry(1,7,5),foodMat=new THREE.MeshStandardMaterial({color:'#b49366',roughness:.9});
  const pellets=new THREE.InstancedMesh(foodGeo,foodMat,simulation.food.length);pellets.frustumCulled=false;scene.add(pellets);const dummy=new THREE.Object3D();
  return {update(dt){
    for(let i=0;i<N;i++){
      point.fromArray(pos,i*3);currentAt(point,simulation.time,vel);point.addScaledVector(vel,dt);point.y-=dt*sink[i];
      if(point.x>11)point.x=-11;if(point.x<-11)point.x=11;if(point.y<-.4)point.y=8;if(point.z>6)point.z=-4;if(point.z<-4)point.z=6;point.toArray(pos,i*3);
    }
    g.attributes.position.needsUpdate=true;
    simulation.food.forEach((p,i)=>{dummy.position.copy(p.position);dummy.scale.setScalar(p.active?p.size*(1-Math.pow(p.age/36,4)):0);dummy.updateMatrix();pellets.setMatrixAt(i,dummy.matrix);});
    pellets.instanceMatrix.needsUpdate=true;
  },setPixelRatio(r){mat.uniforms.pixelRatio.value=r;}};
}
