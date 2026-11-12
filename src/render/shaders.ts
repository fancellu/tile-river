import { CELL, INNER, PAD } from '../paint/tilePainter.ts';

export const ATLAS_COLS = 10;
export const ATLAS_ROWS = 6;
export const ATLAS_W = ATLAS_COLS * CELL;
export const ATLAS_H = ATLAS_ROWS * CELL;

const common = /* glsl */ `
precision highp float;
uniform vec3 uWin;       // centre of the window in the room
uniform vec2 uWinSize;
uniform float uWinGain;
uniform float uTime;
uniform vec2 uRes;
uniform float uExpo;
uniform vec4 uSun;       // patch of sunlight on the wall: centre xy, half size xy

float hash11(float n){ return fract(sin(n*127.1)*43758.5453); }
vec2 hash21(float n){ return fract(sin(vec2(n*127.1, n*269.5+3.1))*43758.5453); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }
float sdBox(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }

// low sun through a second window: a slanted patch with the shadow of the
// glazing bars and of leaves that stir outside
float sunPatch(vec2 w){
  vec2 q = (w - uSun.xy) / uSun.zw;
  q.x -= q.y * 0.42;
  vec2 a = abs(q);
  float box = smoothstep(1.0, 0.86, a.x) * smoothstep(1.0, 0.9, a.y);
  float bars = smoothstep(0.03, 0.1, a.x) * smoothstep(0.02, 0.07, abs(a.y - 0.36));
  float leaves = smoothstep(0.3, 0.62, vnoise(q*2.6 + vec2(uTime*0.05, sin(uTime*0.21)*0.12))
                                     + 0.35*vnoise(q*6.1 - vec2(uTime*0.08, 0.)));
  return box * bars * mix(0.25, 1., leaves);
}
// daylight from the window: warm key that falls off across the wall, cool fill
vec3 keyLight(vec3 wp, vec3 N){
  vec3 Lv = uWin - wp; float d = length(Lv); vec3 L = Lv/d;
  float fall = clamp(pow(15.0/max(d,1.), 1.1), 0.45, 1.5);
  vec3 k = vec3(1.0,0.95,0.86) * max(dot(N,L),0.) * fall * 1.08;
  k += vec3(1.0,0.9,0.72) * sunPatch(wp.xy) * 0.55 * max(dot(N, normalize(vec3(0.5,0.35,0.8))), 0.);
  return k;
}
vec3 ambient(vec3 N){ return mix(vec3(0.30,0.32,0.37), vec3(0.40,0.41,0.43), N.y*.5+.5); }

// the camera: film curve, lens falloff, grain
vec3 finish(vec3 c){
  c *= uExpo;
  c = 1. - exp(-c*1.02);
  c = mix(c, c*c*(3.-2.*c), 0.22);
  vec2 uv = gl_FragCoord.xy/uRes;
  float d = length((uv-0.5)*vec2(uRes.x/uRes.y,1.));
  c *= 1. - 0.34*smoothstep(0.3,1.05,d);
  c = pow(clamp(c,0.,1.), vec3(1./2.2));
  c += (hash12(gl_FragCoord.xy + fract(uTime*7.31)*91.7)-0.5)*0.026;
  return c;
}
`;

export const tileVert = /* glsl */ `
attribute vec2 aCell;
attribute float aSeed;
attribute vec4 aFx;
attribute float aSide;
varying vec2 vLocal; varying vec3 vWorld; varying vec3 vT; varying vec3 vB; varying vec3 vN;
varying vec2 vCell; varying float vSeed; varying vec4 vFx; varying float vSide; varying float vZ;
void main(){
  vLocal = position.xy; vSide = aSide; vZ = position.z;
  vCell = aCell; vSeed = aSeed; vFx = aFx;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.);
  vWorld = w.xyz;
  mat3 r = mat3(m);
  vT = normalize(r[0] + vec3(1e-9,0.,0.)); vB = normalize(r[1] + vec3(0.,1e-9,0.)); vN = normalize(r * normal + vec3(0.,0.,1e-9));
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const tileFrag = /* glsl */ `
${common}
uniform sampler2D uAtlas;
uniform sampler2D uLive;
uniform sampler2D uSurf;
uniform vec4 uLiveRect;   // left, top, 1/width, 1/height (world units)
varying vec2 vLocal; varying vec3 vWorld; varying vec3 vT; varying vec3 vB; varying vec3 vN;
varying vec2 vCell; varying float vSeed; varying vec4 vFx; varying float vSide; varying float vZ;

float windowLight(vec3 wp, vec3 R){
  if (R.z < 0.02) return 0.;
  float tt = (uWin.z - wp.z)/R.z;
  vec2 h = wp.xy + R.xy*tt - uWin.xy;
  vec2 hs = uWinSize*0.5;
  vec2 dd = abs(h) - hs;
  float rect = smoothstep(0.75, -0.75, max(dd.x, dd.y));
  vec2 c = (h + hs)/uWinSize;
  float bars = smoothstep(0.1, 0.42, abs(c.x-0.5)*uWinSize.x);
  bars *= smoothstep(0.08, 0.36, min(abs(c.y-0.333), abs(c.y-0.667))*uWinSize.y);
  // the garden outside: brighter sky above, a soft dark mass of leaves below
  float sky = mix(0.55, 1.15, smoothstep(0.1, 0.9, c.y));
  sky *= 0.8 + 0.2*vnoise(h*0.9 + 3.);
  return rect * mix(0.12, 1., bars) * sky;
}

void main(){
  vec2 p = vLocal;
  float s1 = hash11(vSeed), s2 = hash11(vSeed+1.7), s3 = hash11(vSeed+4.3), s4 = hash11(vSeed+9.1);
  vec3 V = normalize(cameraPosition - vWorld);

  if (vSide > 0.5) {
    // the fired clay body, seen at the edge of a lifted tile
    vec3 clay = vec3(0.60,0.42,0.28)*(0.75+0.5*fbm(vec2(p.x+p.y, vZ)*46.+vSeed));
    clay = mix(clay, vec3(0.86,0.87,0.85), smoothstep(-0.016, -0.004, vZ));
    vec3 N = normalize(vN);
    gl_FragColor = vec4(finish(clay*(keyLight(vWorld,N)*0.8+ambient(N))), 1.);
    return;
  }

  // hand-cut outline: not quite square, not quite straight
  float wob = (fbm(p*4.+vSeed*3.)-.5)*0.014 + (vnoise(p*1.3+vSeed)-.5)*0.012;
  float sd = sdBox(p, vec2(0.492), 0.02) + wob;
  if (sd > 0.) discard;
  float e = -sd;

  // chipped corner and nibbled edges, down to the clay
  float chip = 0.;
  if (s1 < 0.22) {
    vec2 c = vec2(s2 < .5 ? -.5 : .5, s3 < .5 ? -.5 : .5);
    float cr = 0.05 + 0.11*s4;
    float dc = length((p - c)*vec2(1., 0.65+0.7*s3)) + (fbm(p*17.+vSeed)-.5)*0.06;
    chip = smoothstep(cr, cr-0.007, dc);
  }
  float nk = fbm(p*10. + vSeed*7.);
  chip = max(chip, smoothstep(0.004, 0.0, e - max(nk-0.63, 0.)*0.11));
  float glazed = 1. - chip;

  // glaze surface: relief, craze, pinholes
  float ang = s2*6.283;
  mat2 R2 = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec4 sf = texture2D(uSurf, R2*p*0.37 + hash21(vSeed+2.)*7.);

  // paint: density of cobalt in the four layers and the live layer
  vec2 uv = vec2(p.x+.5, .5-p.y);
  vec2 auv = (vCell*${CELL.toFixed(1)} + ${PAD.toFixed(1)} + uv*${INNER.toFixed(1)}) / vec2(${ATLAS_W.toFixed(1)}, ${ATLAS_H.toFixed(1)});
  vec4 a0 = texture2D(uAtlas, auv);
  vec4 a1 = textureLod(uAtlas, auv, 3.2);
  vec4 wts = vec4(1., vFx.y, vFx.x, vFx.z);
  float D0 = dot(a0, wts);
  float D1 = dot(a1, wts);
  if (vFx.w > 0.5) {
    vec2 luv = vec2(vWorld.x - uLiveRect.x, uLiveRect.y - vWorld.y) * uLiveRect.zw;
    float inside = step(0.,luv.x)*step(luv.x,1.)*step(0.,luv.y)*step(luv.y,1.);
    D0 += texture2D(uLive, luv).a * inside;
    D1 += textureLod(uLive, luv, 2.4).a * inside;
  }
  // pigment pools at the rim of a stroke and bleeds a little into the glaze
  float D = D0 + 1.25*max(D0-D1, 0.) + 0.3*max(D1-D0, 0.);
  // granulation of the pigment, uneven firing across the tile, wear at the edge
  D *= 0.78 + 0.44*vnoise(p*74.+vSeed*11.);
  D *= 0.9 + 0.2*vnoise(p*19.+vSeed*3.);
  D *= 0.78 + 0.44*vnoise(p*2.7+vSeed*5.);
  D *= 0.86 + 0.28*s3;
  D *= 0.55 + 0.45*smoothstep(0., 0.022, e);
  D *= glazed;

  vec3 tone = vec3(0.87,0.865,0.835) + (s4-0.5)*vec3(0.075,0.05,0.0) + (s1-.5)*0.07;
  tone *= 0.94 + 0.12*fbm(p*3.6+vSeed);
  tone *= mix(0.9, 1., smoothstep(0., 0.13, e));
  float thin = smoothstep(0.045, 0.0, e);
  tone = mix(tone, vec3(0.74,0.65,0.52), thin*0.7);
  vec3 alb = tone * (exp(-vec3(2.25, 1.5, 0.6) * D * 1.75) * 0.97 + vec3(0.01,0.014,0.03));

  float crz = sf.b * (0.2 + 0.8*smoothstep(0.38,0.62, fbm(p*1.9+vSeed*1.3))) * (0.35+0.95*s2);
  alb *= 1. - crz*0.38;
  alb = mix(alb, alb*vec3(0.84,0.76,0.62), crz*0.6);
  alb = mix(alb, vec3(0.26,0.22,0.18), sf.a*0.75);
  // old dirt gathers along the edges
  float grime = smoothstep(0.07, 0., e)*fbm(p*8.+vSeed*2.);
  alb *= 1. - grime*0.34;
  alb = mix(alb, alb*vec3(0.93,0.88,0.8), smoothstep(0.55,0.8,fbm(p*1.3+vSeed*9.))*0.35);

  // a few tiles were replaced long ago with a creamier batch
  if (s3 > 0.93) alb *= vec3(0.985,0.95,0.87);
  // a hairline crack runs through some tiles; the two halves sit at slightly different angles
  float crackSide = 0.;
  if (s4 < 0.085) {
    float ca = s1*40.;
    vec2 cn = vec2(cos(ca), sin(ca));
    float cd = dot(p - (hash21(vSeed+7.)-0.5)*0.4, cn) + (fbm(p*6.+vSeed)-.5)*0.07;
    float crack = smoothstep(0.0045, 0.001, abs(cd));
    alb *= 1. - 0.62*crack;
    crackSide = sign(cd);
  }
  vec3 clay = vec3(0.64,0.47,0.33)*(0.7+0.6*fbm(p*44.+vSeed));
  alb = mix(alb, clay, chip);
  alb = mix(alb, vec3(0.9), chip*(1.-chip)*2.2);

  // normal
  vec2 nxy = (sf.rg-0.5)*0.26;
  nxy += (vec2(vnoise(p*2.2+vSeed*3.7), vnoise(p*2.2+vSeed*3.7+31.))-0.5)*0.085;
  nxy += (hash21(vSeed+5.)-0.5)*0.05;
  nxy += crackSide * vec2(0.02, -0.014);
  vec2 q = abs(p) - vec2(0.472);
  vec2 gdir = (q.x > 0. && q.y > 0.) ? normalize(q)*sign(p) : (q.x > q.y ? vec2(sign(p.x),0.) : vec2(0.,sign(p.y)));
  nxy += gdir * smoothstep(0.05, 0.0, e)*0.6;
  nxy -= sf.a * 0.25;
  nxy = mix(nxy, (vec2(fbm(p*31.+vSeed), fbm(p*31.+vSeed+9.))-.5)*1.5, chip);
  vec3 N = normalize(vT*nxy.x + vB*nxy.y + normalize(vN));

  vec3 col = alb * (keyLight(vWorld, N) + ambient(N));

  // the glaze is glass: it mirrors the window and a little of the room
  vec3 Rr = reflect(-V, N);
  float F = 0.045 + 0.955*pow(1.-max(dot(N,V),0.), 5.);
  vec3 spec = vec3(1.0,0.975,0.93) * windowLight(vWorld, Rr) * uWinGain;
  // and, dimly, the room: pale ceiling above, soft shapes of furniture and wall
  float room = smoothstep(-0.35, 0.55, Rr.y) * (0.45 + 0.9*vnoise(Rr.xy*3.1 + 5.)) + 0.25*vnoise(Rr.xy*7.3);
  spec += vec3(0.86,0.9,1.0) * room * 2.6;
  col += spec * F * glazed * (1. - crz*0.5);

  col *= mix(0.5, 1., smoothstep(0., 0.016, e));
  gl_FragColor = vec4(finish(col), 1.);
}
`;

export const groutVert = /* glsl */ `
varying vec3 vWorld;
void main(){ vec4 w = modelMatrix * vec4(position,1.); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

export const groutFrag = /* glsl */ `
${common}
varying vec3 vWorld;
void main(){
  vec2 w = vWorld.xy;
  vec2 f = fract(w + 0.5);
  float sand = fbm(w*36.)*0.55 + hash12(floor(w*240.))*0.45;
  vec3 g = mix(vec3(0.50,0.47,0.42), vec3(0.72,0.69,0.63), sand);
  g *= 0.8 + 0.4*fbm(w*1.1);
  // signed distance to the joint line on each axis
  float sx = f.x < 0.5 ? f.x : f.x - 1.;
  float sy = f.y < 0.5 ? f.y : f.y - 1.;
  vec2 L = normalize(uWin.xy - w + vec2(1e-4));
  // each tile throws a small shadow into the joint on the side away from the window
  float shx = smoothstep(-0.006, 0.014, sx * -sign(L.x));
  float shy = smoothstep(-0.006, 0.014, sy * -sign(L.y));
  float inX = 1. - smoothstep(0.02, 0.03, abs(sx));
  float inY = 1. - smoothstep(0.02, 0.03, abs(sy));
  float sh = mix(1., shx, inX) * mix(1., shy, inY);
  g *= 0.3 + 0.5*sh;
  // the mortar bed under a tile that is out of the wall
  float bed = (1.-inX)*(1.-inY);
  g *= mix(1., 0.62*(0.85+0.3*sin(w.y*120.+fbm(w*5.)*8.)), bed);
  vec3 N = vec3(0.,0.,1.);
  gl_FragColor = vec4(finish(g*(keyLight(vWorld,N)+ambient(N))), 1.);
}
`;

export const shadowVert = /* glsl */ `
attribute vec2 aSh;
varying vec2 vP; varying vec2 vSh;
void main(){ vP = position.xy; vSh = aSh; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.); }
`;

export const shadowFrag = /* glsl */ `
precision highp float;
varying vec2 vP; varying vec2 vSh;
float sdBox(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
void main(){
  float sd = sdBox(vP, vec2(0.49), 0.03);
  float a = (1. - smoothstep(-vSh.x, vSh.x, sd)) * vSh.y;
  gl_FragColor = vec4(0.03,0.035,0.06, a);
}
`;
