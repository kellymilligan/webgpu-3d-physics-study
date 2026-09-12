# Sphere Lab

A standalone WebAssembly + WebGPU sphere dynamics experiment. This is a new app with its own dependencies, entry point, shaders and development server; it does not import anything from Blur Study.

## Run

```sh
npm install
npm run dev
```

Open http://localhost:5180. WebGPU requires a supported browser, hardware acceleration, and a secure context (localhost or HTTPS). The app reports initialization or device errors inside the GUI. There is no CPU physics fallback.

```sh
npm run build       # rebuild WASM, then produce dist/
npm run preview     # serve the production build on localhost:5180
npm test            # WASM layout / radius / mass checks
npm run test:gpu    # real browser physics and scale checks; start the server first
npm run test:culling # direct GPU image comparisons and visibility benchmarks
npm run test:lighting # lighting toggles, shadow geometry, quality and 1m/2m checks
```

`test:gpu` uses Playwright's installed Chromium or Google Chrome on macOS. Set `CHROME_PATH` for another executable, and `TEST_URL` to test a different server. Results and screenshots go into ignored `test-results/`.

## Controls

- Left drag (or touch): spawn and move the orange kinematic cursor sphere. Its translucent surface remains visible through the pile. Release to remove it.
- Right drag or Alt + drag: orbit the camera.
- Wheel: zoom. Shift + wheel: move the stirring plane through the enclosure; the Cursor depth slider does the same.
- Space, with the canvas focused: pause/resume. Escape: release the cursor.
- Sphere count: 10k, 100k, 200k, 500k, 1m and 2m. Count changes reset the simulation and choose a radius that fits.
- Radius variation: 0 is uniform; 1 samples radii uniformly from the base radius through 5× that radius. Changing variation chooses a base radius that fits the maximum possible sphere size. Mass scales with radius cubed, using Base mass for the smallest sphere.
- Container width, height and depth rebuild the six invisible walls. They resize the radius only if the current non-overlapping seed layout would not fit. Invalid manual radius changes retain the last valid simulation and report the issue in the GUI.
- Gravity, restitution, Coulomb friction, base mass and air damping update live. Substeps and contact passes trade speed for stack stability. Fit radius chooses a conservative lattice that occupies roughly the upper 55% of the box before falling.
- Cull hidden (under Solver & rendering) enables conservative GPU frustum/occlusion culling. It is on by default and can be toggled live for comparison.
- Lighting controls the directional light's azimuth, elevation, intensity, ambient fill and exposure. Shadows controls enablement, softness and 1024/2048/4096 map resolution.
- Contact occlusion controls GTAO enablement, world-space radius, strength and sampling quality. Material controls sphere roughness and metallic response, with Lit / Occlusion only / Shadows only / Normals inspection views. These changes apply live without resetting physics.
- Performance reports total bodies, bodies in the final shaded draw, physics time, render-plus-culling time, completed display frames, total GPU time and primary buffer memory. Counts and GPU timings are sampled asynchronously when timestamp queries are available. Paused GPU times measure rendering only.

## Implementation

`wasm/seed.wat` is a small, reproducible WebAssembly module. It creates deterministic positions, randomized radii, inverse masses and initial velocities in linear memory. `wabt` compiles it to `public/seed.wasm`; the compiled asset is included so running the dev server does not require a compiler. A Worker runs initialization, then uploads the state once. WASM does **not** run the per-frame contact solver.

`src/shaders/physics.wgsl` implements GPU integration and a spatial grid. Each particle is one solid sphere with position, radius, linear velocity, inverse mass and angular velocity. The grid uses atomic linked lists with a separate build dispatch before contact resolution. All 27 neighboring cells are searched; the cell diameter is at least the maximum sphere diameter. Cell lists have no fixed capacity or silently truncated contacts. Dense cells and a wide radius distribution increase work.

Contacts use an iterative Jacobi impulse solver with positional stabilization, restitution, tangential Coulomb friction and solid-sphere inertia. The enclosure clamps all six boundaries each pass. Rotation affects contact velocities and friction; orientation is unnecessary for isotropic, uniformly colored spheres. The cursor is an infinite-mass kinematic obstacle. Uniformly scaling all sphere masses should not change gravity or sphere/sphere motion; relative masses matter when sizes differ.

The simulation takes fixed 1/60-second steps subdivided by the Substeps control. Rendering can run faster. Catch-up is limited to two fixed steps per rendered frame (one when measured GPU time exceeds 16.7 ms), and the app waits for submitted GPU work before submitting another frame. Under heavy load, simulation time slows instead of building an unbounded command queue. Travel is limited to 0.8 radii per substep as a discrete collision safeguard. This is an approximate rigid-sphere solver, not an exact engine or a continuous collision detector: finite contact passes allow some stack compression, and fast cursor motion can cause temporary penetration. More substeps/contact passes improve this at additional cost.

`src/shaders/render.wgsl` draws six vertices per sphere, intersects view rays with each analytic sphere, and writes the curved surface depth. Rendering reads the same GPU buffers as physics; there is no per-frame CPU particle download. The floor is visible; the five other walls are invisible. Three.js supplies camera/ray mathematics only; WebGPU rendering and compute are direct. Tweakpane supplies the GUI.

At 2 million spheres, the two 48-byte state buffers use about 183 MiB combined, plus grid/link buffers, about 15.3 MiB for two visibility lists, indirect draw arguments and render/depth-pyramid targets. Each individual state buffer remains under WebGPU's standard 128 MiB storage binding limit. Allocation errors retain the previous simulation where possible; a lost device requires reload. Million-sphere presets are intended as GPU experiments, with no guaranteed frame rate across devices.

WebGPU/WGSL reference: [GPUWeb specifications](https://gpuweb.github.io/gpuweb/) and [WGSL atomics and memory semantics](https://gpuweb.github.io/gpuweb/wgsl/).

## Earlier physics benchmark (before the lighting upgrade)

Chrome, Apple GPU / Metal 3, 1440 × 1000, pixel ratio 1, two substeps and two contact passes per substep. Dense lattice lowered to the floor, then advanced for 240 fixed steps before timing 30 more. These are wall-clock times per rendered fixed step, not a promise of the same interactive frame rate.

| Spheres | Dense frame | Simulation buffers |
| --- | ---: | ---: |
| 1,000,000 | 38.8 ms | 102.8 MiB |
| 2,000,000 | 116.2 ms | 205.9 MiB |

Both dense runs had zero escaped spheres, non-finite values or reported GPU errors. Large stacks retain some residual motion/compression with the default contact-pass budget. The separate 10k settling test reached mean linear speed 0.039 units/s after eight simulated seconds. `scripts/benchmark-dense.mjs` reproduces the dense workload.

## GPU visibility culling

The default rendering path uses `src/culling.js` and the culling/depth-pyramid shaders. Each frame:

1. Rasterize the previous visible IDs into a depth-only target using **current** particle positions and the **current** camera. No previous-frame depth is reused.
2. Build a maximum-depth mip pyramid. Clear pixels remain at far depth, so gaps never become solid occluders. Odd viewport sizes are padded with far depth, and every reduction includes all source samples.
3. Test each sphere's conservative billboard rectangle and nearest possible depth. Keep uncertain/near-plane cases. Compact surviving original IDs into a GPU buffer and write the instance count into an indirect draw command.
4. Shade only the surviving IDs. The cursor remains a separate translucent overlay.

The visibility lists ping-pong independently of physics. Reset starts with no occluders, which retains all in-frustum spheres for the first frame. Camera changes and moving bodies cannot make old depth hide newly visible objects because occluder depth is rebuilt from current transforms. The method retains some hidden spheres to avoid holes; it does not promise the minimum visible set. All bodies still participate in collision detection and solving, and original IDs preserve colors. Visibility changes do not touch the physics buffers.

`test:culling` reads the actual GPU color texture for on/off image comparisons, tests camera movement, zoom, stirring, odd-sized portrait rendering and radius variation, and benchmarks dense 1m/2m layouts. The direct readback is a diagnostics-only path. Culling does not require CPU visibility readback; only small timing/count statistics are sampled asynchronously.

**Earlier unshadowed baseline**, before the lighting upgrade: render-only results on the same local Apple / Metal 3 adapter, 1440 × 1000, using a frozen dense lattice, eight warmup frames and 30 timed frames:

| Bodies | Culling off | Culling on, including depth/cull work | Final shaded draw |
| --- | ---: | ---: | ---: |
| 1,000,000 | 6.58 ms | 1.65 ms | 87,630 |
| 2,000,000 | 12.00 ms | 2.02 ms | 128,772 |

These are rendering savings, not whole-simulation speedups. The collision solver still processes every sphere. Depth precision and equal-depth ties can change an isolated pixel when compaction changes draw order; the first complete 2m comparison differed at one pixel out of 1.44 million. Smaller comparisons were pixel-identical. Culling overhead can outweigh its savings in sparse scenes, so the GUI toggle is useful for measurement.

A separate moving, dense-stack comparison (`scripts/benchmark-culling-physics.mjs`) starts both modes from the same saved physics state after 160 settling steps, then times 24 steps per mode:

| Bodies | Full GPU frame, off | Full GPU frame, on | Physics, on |
| --- | ---: | ---: | ---: |
| 1,000,000 | 48.34 ms | 42.85 ms | 40.95 ms |
| 2,000,000 | 124.89 ms | 114.62 ms | 111.72 ms |

That is roughly 11% and 8% less GPU time for the complete frame. The larger render-only gains do not eliminate the collision bottleneck. Measurements vary with layout, GPU load and solver settings; the earlier baseline and this test use different settling durations.

Count changes also cancel superseded initialization workers and serialize GPU buffer replacements. Programmatic GUI refreshes do not trigger new resets. `node scripts/test-reset-race.mjs` checks overlapping reset requests and rapid count selection.


## Physical lighting

The renderer writes analytic sphere surface depth, linear albedo and view normals into a G-buffer, then shades visible pixels once in a fullscreen pass. `src/lighting.js` owns the lighting resources and passes. The remaining translucent orange cursor is an interaction overlay; it does not cast shadows.

- **Directional shadows:** all bodies render analytic sphere depth from the light's view into one orthographic shadow map fitted to the enclosure. Camera culling never removes shadow casters. A 16-tap PCF filter softens the result; each tap compares against the analytic sphere receiver (or floor plane), avoiding false self-shadowing from the curvature within the filter. The camera's near/far range follows the enclosure to retain enough depth precision for world-position reconstruction. This is filtered directional shadowing, not physically exact area-light penumbrae. Finite map resolution and filtering can lose detail around subpixel spheres.
- **Ground-truth ambient occlusion (GTAO):** a half-resolution compute pass searches depth horizons around each visible surface. A bilateral compute filter and depth/normal-aware upsampling preserve contact edges. Quality changes direction/step counts. Occlusion darkens ambient illumination only; direct light is controlled by geometric shading and the shadow map. This implementation uses spatial filtering, without temporal history. As a screen-space approximation, it cannot see hidden or offscreen occluders and can change as the camera moves.
- **Material response:** GGX specular distribution, correlated Smith visibility, Schlick Fresnel and diffuse energy splitting provide a roughness/metallic workflow. A broad analytic studio environment supplies ambient fill and approximate reflections, followed by exposure, a fitted ACES tone curve and sRGB output. This is physically based direct shading with approximate ambient light; it does not simulate local color bounce or reflections of neighboring spheres.

The full shadow pass currently processes every body, so it is the main added cost at million-body counts. AO and the lighting resolve mostly scale with viewport resolution. Disabling either effect skips its pass. At 1440 × 1000, the albedo, normals, main depth and two half-resolution AO targets occupy approximately 25 MiB, plus 16 MiB for a 2048² shadow map (64 MiB at 4096²), beyond particle/culling resources.

`test:lighting` checks effect toggles against GPU texture readback, verifies that material/lighting changes leave physics buffers identical, exercises odd-size viewport and shadow-map reallocations, and compares camera-culling on/off images with shadows enabled. The isolated-sphere test checks for self-shadow artifacts and confirms that the floor shadow follows light direction at every map resolution.

With all lighting enabled at defaults, frozen dense-lattice render-only measurements on the local Apple / Metal adapter at 1440 × 1000 were approximately **6.9 ms for 1m** and **10.8 ms for 2m** spheres (six warmup frames, twelve samples). These include camera culling, all-body shadow rendering, G-buffer, GTAO and lighting. They exclude the collision solver; moving dense stacks can be much slower. Hardware, layout and viewport materially affect performance.

The Performance folder reports total GPU frame time and render/cull time, plus individual shadow, AO and lighting **spans**. On GPUs that overlap stages of separate passes, those per-pass timestamp spans overlap too and must not be summed. Total render time is measured across the complete rendering interval instead.

References: [GTAO derivation and filtering](https://www.activision.com/cdn/research/PracticalRealtimeStrategiesTRfinal.pdf), [Filament's physically based shading equations](https://google.github.io/filament/main/filament.html), and [percentage-closer shadow filtering](https://developer.nvidia.com/gpugems/gpugems/part-ii-lighting-and-shadows/chapter-11-shadow-map-antialiasing).
