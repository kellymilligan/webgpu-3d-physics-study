# Box3D Body Lab

An in-browser 3D rigid-body composition tool. Physics runs in Erin Catto's Box3D compiled to WebAssembly; rendering, culling, lighting and path-traced stills run in WebGPU.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5180` in a WebGPU-enabled browser. Cross-origin-isolated threads are not required; the Box3D build is single-threaded WASM with SIMD.

```bash
npm run build
npm test
npm run test:shapes
npm run test:review
npm run test:collisions
```

`npm run build:box3d` rebuilds the checked-in WASM asset and requires Emscripten. Normal app builds use the included `public/box3d.wasm`.

## Bodies and controls

The **Bodies** panel offers 100, 250, 500, 1,000, 2,000 and 5,000 bodies. The body-type checkboxes can be combined freely; deterministic initialization chooses uniformly from every enabled type:

- Sphere
- Cube
- Sphube: the smooth Lp ball `|x/r|^p + |y/r|^p + |z/r|^p = 1`, with `p = 3.43184`, following [John D. Cook's sphube](https://www.johndcook.com/blog/2019/04/04/higher-dimensional-squircles/)
- Capsule
- Cylinder: an exact circular side and flat caps in rendering; a 32-sided collision hull in Box3D
- Tetrahedron
- Octahedron
- Box: a rectangular body with a randomized 2×–10× long axis

At least one type must remain enabled. **Base size** is the smallest generated size. **Size range** is a multiplier from 1× (uniform size) to 100×. For a random value `u` in `[0,1)`, size is:

`baseSize × (1 + (range - 1) × u^bias)`

A bias of 1 is uniform. Larger values produce mostly small bodies with progressively rarer large ones; values below 1 favor large bodies. Bodies are capped only when necessary to fit inside the current container, and elongated boxes preserve their 2×–10× aspect ratio. **Fit base size** chooses a conservative starting point for the current count, world and range.

Changing count, base size, variation, bias, container dimensions or body selection rebuilds the deterministic Box3D world. Gravity, density, friction, restitution and damping update the live Box3D bodies. Box3D substeps trade speed for stack stability. The six collision walls remain invisible. Left drag moves a kinematic cursor sphere through the pile; right/Alt drag orbits and the wheel zooms.

Bodies are placed largest-first using Box3D overlap queries. A layout that cannot be placed without overlap reports a capacity message instead of starting with embedded bodies. Reduce size/count or enlarge the container in that case. The cursor is disabled when released, appears directly at the drag start, and has bounded movement speed.

**Sprinkles** is the default theme. All editable GUI values, export options and the orbit camera are saved in localStorage for this browser/origin. Changing body settings preserves the camera. **Reset settings** restores all values and the camera to defaults and rebuilds the scene. **Reset camera** changes only the camera. Corrupt or unavailable storage falls back safely to defaults. Physics positions are not saved.

## Box3D integration

The pinned upstream source is vendored under `vendor/box3d` at the revision recorded in `vendor/box3d/REVISION`, with its MIT license. `vendor/box3d/web_bridge.c` creates the world, static enclosure, selected convex shapes and cursor. It exposes a compact C ABI to JavaScript and publishes each body's position, quaternion, bounding radius, shape parameters and velocity in a 64-byte record.

`src/box3d.js` owns the WASM module. Box3D advances at a fixed 60 Hz and supplies transforms to one WebGPU storage buffer each frame. This replaces the earlier sphere-only GPU collision grid and Jacobi solver. The reduced body presets reflect the more expensive general convex collision and rotational dynamics.

The sphube is rendered as a continuous Lp surface with analytic gradient normals. Its collision approximation uses 218 surface vertices across six convex sectors on one rigid body, respecting Box3D's hull limits. The measured support error is below 2% of base size in the regression's 2,000 sampled directions; slight contact differences remain possible. Cylinders render as truly circular surfaces with smooth radial normals and flat end caps, shared by the live view, shadows and path tracer. Their centered 32-sided Box3D hull differs by at most 0.482% of the radius.

## WebGPU rendering

All body types render as quaternion-oriented surfaces inside conservative instanced billboards. Spheres, capsules and cylinders use analytic intersections, polyhedra use convex plane clipping, and sphubes use a bracketed root solve on their convex Lp surface. These routines solve both entry and exit intersections without approximate surface-hit bands. Frustum/Hi-Z culling uses each body's conservative bounding sphere; hidden bodies remain in Box3D and in shadow/path-tracing data. Shadows share the same geometry routines.

The deferred lighting pass provides GGX materials, GTAO, a shadowed key and four rectangular studio strips. The live view approximates glass transmission and secondary strip visibility to stay responsive. **Single softbox** restores the earlier one-light setup.

Material themes are assigned by stable body ID. Forest Glow, Frost & Glow and the earlier palettes apply consistently across every selected shape.

## Still rendering

The **Render still** panel freezes a Box3D snapshot without advancing physics. A Worker builds a Morton-ordered BVH from conservative body bounds. The WebGPU path tracer shares the live view's exact surface intersections, then performs multiple-bounce GGX/glass transport against the four finite studio strips and environment. World-scale secondary-ray offsets prevent self-intersection while preserving thin bodies.

**5K Studio Display** exports exactly 5120 × 2880. **Custom print** supports up to 24,000 pixels on the long edge; 40 inches at 300 DPI is 12,000 pixels. Output is a streamed 16-bit RGB PNG with sRGB and DPI metadata. High-frost glass piles need substantially more samples and bounces than opaque scenes.

The path tracer uses RGB transport and has no denoiser, spectral dispersion or specialized caustic solver. Live and exported geometry match; smooth sphubes and cylinders retain the documented collision approximations. Noise in complex glass paths still requires more samples.

## Verification

`test:shapes` runs the real Box3D WASM and WebGPU shaders. It checks all eight types in one world, quaternion rotation, finite state, single-type selection, a measured near-100× size span, bias behavior, frozen physics during export and a mixed-shape path-traced PNG. Unit tests cover the BVH and print output geometry.

`test:review` exercises real GUI persistence, reload/reset, GPU entry/exit/reflection/transmission rays across all shapes at varied sizes and rotations, and a smooth-sphube still. `test:collisions` requires a C compiler and tests cylinder centering, sphube approximation error, settled floor contacts for all shapes, cursor activation/speed/release and default placement. Unit tests also cover preference validation and storage failures.
