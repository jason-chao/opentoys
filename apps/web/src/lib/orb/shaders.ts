// The living orb's fragment shader. It draws the whole orb in 2D on a single full-canvas triangle: a
// noise-displaced disc shaded as a sphere, a halo, and e-stim as thin bright filaments in three sets (the
// ring's e-stim, Coyote channel A, Coyote channel B), each with its own colour, brightness and shimmer.
// Kept cheap for mid-range phones: value noise, 4-octave fbm at most, no loops over lights.

export const vertex = /* glsl */ `
attribute vec2 position;
void main() {
	gl_Position = vec4(position, 0.0, 1.0);
}
`;

const common = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform float uVib;
uniform vec3 uThreads;
uniform vec3 uPhase;
uniform float uKick;
uniform float uBreath;
uniform float uRadius;
uniform vec2 uCenter;
uniform float uLight;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uFil;
uniform vec3 uFilA;
uniform vec3 uFilB;
uniform vec3 uRings;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
// Gradient noise (smooth, no grid-aligned blocks), roughly 0..1.
vec2 grad(vec2 i) {
	return vec2(hash(i), hash(i + 17.31)) * 2.0 - 1.0;
}
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	float a = dot(grad(i), f);
	float b = dot(grad(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
	float c = dot(grad(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
	float d = dot(grad(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
	return 0.5 + 0.9 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
	p = mat2(0.94, 0.34, -0.34, 0.94) * p;
	for (int i = 0; i < 4; i++) {
		v += a * noise(p);
		p = r * p * 2.03;
		a *= 0.5;
	}
	return v;
}
float fbm3(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
	p = mat2(0.94, 0.34, -0.34, 0.94) * p;
	for (int i = 0; i < 3; i++) {
		v += a * noise(p);
		p = r * p * 2.03;
		a *= 0.5;
	}
	return v;
}
// Halos fade out towards the canvas edges, so they never end in a visible rectangle.
float edgeFade() {
	vec2 uv = gl_FragCoord.xy / uRes;
	float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
	return smoothstep(0.0, 0.22, e);
}
vec4 finish(vec3 premul, float alpha) {
	// A touch of grain against banding in the long, soft gradients.
	float g = (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) / 128.0;
	alpha = clamp(alpha, 0.0, 1.0);
	return vec4(clamp(premul + g * alpha, 0.0, 1.0), alpha);
}
`;

/** A molten ember: vibration swells and quickens it, e-stim shows as threads of light. */
export const ember = /* glsl */ `${common}
void main() {
	float s = min(uRes.x, uRes.y);
	vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / s - uCenter;
	float t = uTime;
	float r = length(p);
	vec2 dir = p / max(r, 1e-4);
	float wob = fbm3(dir * 1.25 + vec2(t * 0.06, -t * 0.045)) - 0.5;
	float R = uRadius * (1.0 + 0.07 * uBreath + 0.09 * uVib + 0.03 * uKick + wob * (0.1 + 0.18 * uVib));
	float d = r - R;
	float aa = 1.6 / s;
	float inside = 1.0 - smoothstep(-aa, aa, d);
	vec2 q = p / R;
	float rr = min(dot(q, q), 1.0);
	float z = sqrt(1.0 - rr);

	float flow = t * (0.05 + 0.1 * uVib);
	vec2 w = vec2(fbm3(q * 1.3 + vec2(flow, 0.0)), fbm3(q * 1.3 + vec2(3.1, -flow)));
	float f = fbm(q * 1.8 + w * 1.5 + vec2(0.0, -flow * 1.6));
	float ripple = 0.5 + 0.5 * sin(sqrt(rr) * 12.0 - t * (1.6 + 7.0 * uVib));
	// Heat gathers in the core and rises with the output; molten veins move through it.
	float core = pow(z, 1.6);
	float heat = core * (0.55 + 0.35 * uVib + 0.2 * uBreath) + (f - 0.45) * 0.7 + ripple * uVib * 0.16 + 0.12;
	vec3 col = mix(uC0, uC1, smoothstep(0.0, 0.42, heat));
	col = mix(col, uC2, smoothstep(0.38, 0.78, heat));
	col = mix(col, uC3, smoothstep(0.72, 1.15, heat) * 0.9);
	col *= 0.7 + 0.3 * z;
	col += uC2 * pow(1.0 - z, 4.0) * (0.45 + 0.5 * uVib);
	col += uC3 * pow(z, 6.0) * (0.12 + 0.3 * uVib);

	float od = max(d, 0.0) / uRadius;
	float glow = exp(-od * (3.0 - 1.2 * uVib)) * (0.3 + 0.45 * uVib + 0.2 * uBreath);
	glow *= (1.0 - inside) * edgeFade();
	vec3 halo = mix(uC1, uC2, 0.45 + 0.35 * uVib);

	// E-stim: a few fine threads that come and go, not a full net. One field gives all three sets their paths
	// (each takes other contour lines of it), so three sets cost little more than one.
	float fil = fbm3(q * 1.7 + w * 0.9 + vec2(t * 0.35, -t * 0.22));
	float mask = smoothstep(1.4, 0.7, length(q));
	vec3 at = fract(fil * 4.0 + vec3(0.0, 0.333, 0.667));
	// Fine on a large orb, and still a pixel or two wide on a small one (Control on a phone).
	float lw = 0.026 + 6.0 / (uRadius * s);
	vec3 line = smoothstep(vec3(lw), vec3(0.0), abs(at - 0.5));
	vec2 sp = q * 2.2 + vec2(-t * 0.6, t * 0.4);
	vec3 segs = smoothstep(
		vec3(0.5, 0.4, 0.4),
		vec3(0.72, 0.62, 0.62),
		vec3(noise(sp), noise(sp + vec2(7.3, 1.9)), noise(sp + vec2(-4.1, 9.7)))
	);
	// The ring's set keeps its restless glint. The Coyote's sets shimmer at a speed that follows the pulse
	// rate (slow enough for anyone to look at: the page never asks for more than 3 cycles a second).
	vec3 shimmer = vec3(
		0.55 + 0.45 * noise(vec2(t * 10.0, fil * 23.0)),
		0.72 + 0.28 * sin(uPhase.y),
		0.72 + 0.28 * sin(uPhase.z)
	);
	vec3 th = line * segs * mask * shimmer * uThreads * 2.2;
	float threads = th.x + th.y + th.z;

	// The ring's set glows (added, as it always was). The Coyote's two sets are laid over the body in their own
	// colour, so they stay told apart on a bright orb in the light colour modes too.
	vec3 premul = col * inside + halo * glow + uFil * th.x;
	premul = mix(premul, uFilA, clamp(th.y * 1.8, 0.0, 1.0));
	premul = mix(premul, uFilB, clamp(th.z * 1.8, 0.0, 1.0));
	float alpha = inside + glow + threads * 0.8;
	gl_FragColor = finish(premul, alpha);
}
`;

export const fragments = { ember } as const;
export type OrbVariant = keyof typeof fragments;
