// Kestrel Yard: an original dusk rail yard, 52 x 38 m. Two bomb sites — A "Silos" west,
// B "Depot" east — joined by a mid lane and two side lanes, with containers, crates and
// silos for cover. The world owns the colliders, the line-of-sight test, the shared
// box mover (player and bots use the same collision), the waypoint graph the bots
// navigate, and the spawn points.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createSky } from './sky.js';
import { createGroundTexture, createSiteLetter } from './ground.js';

const WALL_H = 5.2;

export const createWorld = (scene) => {
  const group = new THREE.Group();
  scene.add(group);

  const materials = Object.fromEntries(
    Object.entries(PALETTE).map(([name, color]) => [
      name,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.94,
        metalness: name === 'hairline' || name === 'surface' ? 0.18 : 0.03,
      }),
    ]),
  );
  // Warm rust containers and cool teal containers, so the two lanes read apart.
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x9a4a28, roughness: 0.85, metalness: 0.25 });
  const tealMat = new THREE.MeshStandardMaterial({ color: 0x2e6f66, roughness: 0.85, metalness: 0.25 });
  const siloMat = new THREE.MeshStandardMaterial({ color: 0x6d7680, roughness: 0.6, metalness: 0.55 });
  // The yard floor is painted asphalt, not a flat slab: speckle, stains,
  // joints and cracks give the ground something for the eye to hold.
  materials.ground.map = createGroundTexture();
  materials.ground.needsUpdate = true;

  const colliders = [];
  const shootables = [];

  const box = (width, height, depth, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  };

  const cylinder = (radius, height, x, z, material, segments = 18) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
    mesh.position.set(x, height / 2, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
    // Colliders stay boxes: a silo's collider is its square footprint.
    colliders.push(new THREE.Box3(new THREE.Vector3(x - radius, 0, z - radius), new THREE.Vector3(x + radius, height, z + radius)));
    shootables.push(mesh);
    return mesh;
  };

  const flatRing = (x, z, radius, color) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.25, radius, 40),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    group.add(ring);
    return ring;
  };

  // Every solid in the yard, in build order (collider and shootable order follow it).
  // [kind, ...args] — box: w h d x y z material; cyl: radius height x z; ring: x z.
  const G = materials.ground;
  const S = materials.surface;
  const H = materials.hairline;
  const PLACEMENTS = [
    ['box', 52.4, 0.4, 38.4, 0, -0.2, 0, G],
    ['box', 0.4, WALL_H, 38.4, -26.2, WALL_H / 2, 0, S],
    ['box', 0.4, WALL_H, 38.4, 26.2, WALL_H / 2, 0, S],
    ['box', 52.4, WALL_H, 0.4, 0, WALL_H / 2, -19.2, S],
    ['box', 52.4, WALL_H, 0.4, 0, WALL_H / 2, 19.2, S],
    ['box', 0.3, 0.02, 30, 0, 0.01, 0, H],
    ['box', 30, 0.02, 0.3, 0, 0.01, 0, H],
    ['cyl', 2.4, 7.5, -21, -12],
    ['cyl', 2.4, 6.2, -16.5, -13.5],
    ['box', 3.4, 1.1, 1.4, -19.5, 0.55, -5.5, H],
    ['box', 1.4, 1.1, 3.2, -23, 0.55, -7, H],
    ['box', 2.2, 2.2, 2.2, -15.5, 1.1, -9.5, rustMat],
    ['ring', -19, -9.5],
    ['box', 6.2, 2.6, 2.6, 21.5, 1.3, -13.5, tealMat],
    ['box', 6.2, 2.6, 2.6, 21.5, 3.9, -13.5, rustMat],
    ['box', 2.2, 1.1, 2.2, 16.5, 0.55, -6, H],
    ['box', 1.4, 1.1, 3.4, 23.5, 0.55, -6.5, H],
    ['box', 3.0, 1.1, 1.4, 18.5, 0.55, -13, H],
    ['ring', 19, -9.5],
    ['box', 4.4, 2.6, 2.4, -3, 1.3, 1.5, rustMat],
    ['box', 4.4, 2.6, 2.4, 3.4, 1.3, -2.5, tealMat],
    ['box', 2.0, 0.9, 2.0, 0, 0.45, 6.5, H],
    ['box', 1.6, 0.9, 1.6, -7.5, 0.45, -2, H],
    ['box', 1.6, 0.9, 1.6, 7.5, 0.45, -2, H],
    ['box', 8, 0.3, 2.2, 0, 2.6, -7.5, S],
    ['box', 0.3, 2.6, 2.2, -4.1, 1.3, -7.5, S],
    ['box', 0.3, 2.6, 2.2, 4.1, 1.3, -7.5, S],
    ['box', 2.2, 0.3, 3.4, 0, 1.35, -7.5, H],
    ['box', 3.2, 1.1, 1.4, -10, 0.55, 12, H],
    ['box', 3.2, 1.1, 1.4, 10, 0.55, 12, H],
    ['box', 1.6, 1.1, 1.6, -14, 0.55, 5, rustMat],
    ['box', 1.6, 1.1, 1.6, 14, 0.55, 5, tealMat],
    ['box', 2.6, 2.4, 1.2, -7, 1.2, -13.5, H],
    ['box', 2.6, 2.4, 1.2, 7, 1.2, -13.5, H],
    ['box', 1.8, 0.9, 1.8, 0, 0.45, -14.5, H],
  ];
  PLACEMENTS.forEach((p) => {
    if (p[0] === 'box') box(p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
    else if (p[0] === 'cyl') cylinder(p[1], p[2], p[3], p[4], siloMat);
    else flatRing(p[1], p[2], 4.2, 0x3fb8a6);
  });

  // The sky over the yard: gradient dome, stars, low sun in the west.
  createSky(scene);

  // ---- Distant silhouettes outside the walls, for depth at dusk ----
  const ghost = new THREE.MeshStandardMaterial({ color: 0x1c2129, roughness: 1, metalness: 0 });
  const ghostBox = (w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ghost);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  ghostBox(1.2, 16, 1.2, -34, 8, -8);
  ghostBox(14, 1, 1, -28, 15, -8);
  [[34, -12, 3, 10], [36, 4, 2.4, 8], [-34, 10, 2.6, 9]].forEach(([x, z, r, h]) => {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), ghost);
    s.position.set(x, h / 2, z);
    group.add(s);
  });

  // ---- Light: low amber sun from the west, cool fill, dusk sky ----
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 78);
  const sky = new THREE.HemisphereLight(new THREE.Color(0x8a97a8), new THREE.Color(0x1a1512), 1.5);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(0xffb45e), 3.0);
  sun.position.set(-24, 16, 10);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 80 });
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x5f7ea6), 0.75);
  fill.position.set(14, 12, 14);
  scene.add(fill);

  // ---- Bomb sites, spawns, waypoints ----
  const sites = [['A', 'Silos', -19], ['B', 'Depot', 19]].map(([id, name, x]) => ({
    id, name, center: new THREE.Vector3(x, 0, -9.5), radius: 4.2,
  }));
  // Each site's letter, painted faded on the ground inside its ring.
  sites.forEach((site) => {
    const decal = createSiteLetter(site.id);
    decal.position.set(site.center.x, 0.04, site.center.z);
    group.add(decal);
  });
  const viperSpawns = [[-4, 16], [0, 17], [4, 16], [-8, 14], [8, 14]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const spawns = {
    vipers: viperSpawns,
    jackals: viperSpawns.map((v) => new THREE.Vector3(v.x, v.y, -v.z)),
  };

  // Waypoint graph: nodes in open ground, edges between neighbours a bot can walk.
  const NODE_LIST = [
    ['tSpawn', 0, 15], ['tWest', -12, 12], ['tEast', 12, 12],
    ['tMid', 0, 8], ['midWest', -8, 1], ['mid', 0, 0], ['midEast', 8, -1],
    ['midTop', 0, -8], ['aLane1', -18, 8], ['aLane2', -18, 0], ['aSite', -19, -9.5],
    ['aBack', -22.5, -14.5], ['aApproach', -10, -11], ['bLane1', 18, 8], ['bLane2', 18, 0],
    ['bSite', 19, -9.5], ['bBack', 22.5, -14.5], ['bApproach', 10, -11],
    ['ctSpawn', 0, -15], ['ctWest', -10, -15], ['ctEast', 10, -15], ['ctMid', -4, -13],
  ];
  const nodes = Object.fromEntries(NODE_LIST.map(([name, x, z]) => [name, new THREE.Vector3(x, 0, z)]));
  const EDGE_LIST = [
    ['tSpawn', ['tWest', 'tEast', 'tMid']], ['tWest', ['tSpawn', 'aLane1', 'tMid']],
    ['tEast', ['tSpawn', 'bLane1', 'tMid']], ['tMid', ['tSpawn', 'midWest', 'midEast', 'mid', 'tWest', 'tEast']],
    ['midWest', ['tMid', 'mid', 'aLane2']], ['mid', ['midWest', 'midEast', 'midTop', 'tMid']],
    ['midEast', ['mid', 'tMid', 'bLane2']], ['midTop', ['mid', 'aApproach', 'bApproach', 'ctMid']],
    ['aLane1', ['tWest', 'aLane2']], ['aLane2', ['aLane1', 'aSite', 'midWest']],
    ['aSite', ['aLane2', 'aBack', 'aApproach']], ['aBack', ['aSite', 'ctWest']],
    ['aApproach', ['aSite', 'midTop', 'ctWest']], ['bLane1', ['tEast', 'bLane2']],
    ['bLane2', ['bLane1', 'bSite', 'midEast']], ['bSite', ['bLane2', 'bBack', 'bApproach']],
    ['bBack', ['bSite', 'ctEast']], ['bApproach', ['bSite', 'midTop', 'ctEast']],
    ['ctSpawn', ['ctWest', 'ctEast', 'ctMid']], ['ctWest', ['ctSpawn', 'aBack', 'aApproach']],
    ['ctEast', ['ctSpawn', 'bBack', 'bApproach']], ['ctMid', ['ctSpawn', 'midTop', 'ctWest', 'ctEast']],
  ];
  const edges = Object.fromEntries(EDGE_LIST);

  const route = (fromNode, toNode) => {
    // Breadth-first search over the waypoint graph; returns node names from -> to.
    if (fromNode === toNode) return [fromNode];
    const prev = { [fromNode]: null };
    const queue = [fromNode];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      for (const next of edges[current] || []) {
        if (next in prev) continue;
        prev[next] = current;
        if (next === toNode) {
          const path = [next];
          let node = current;
          while (node) {
            path.push(node);
            node = prev[node];
          }
          path.reverse();
          return path;
        }
        queue.push(next);
      }
    }
    return [fromNode, toNode];
  };

  const nearestNode = (position) => {
    let best = 'tSpawn';
    let bestDist = Infinity;
    Object.keys(nodes).forEach((name) => {
      const node = nodes[name];
      const d = (node.x - position.x) * (node.x - position.x) + (node.z - position.z) * (node.z - position.z);
      if (d < bestDist) {
        bestDist = d;
        best = name;
      }
    });
    return best;
  };

  // ---- Collision: axis-separated box mover, shared by the player and the bots ----
  const probe = new THREE.Box3();
  const overlaps = (x, y, z, radius, height, lift) => {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    return colliders.find((c) => probe.intersectsBox(c)) ?? null;
  };

  // Moves a body (position Vector3, velocity Vector3) one step; resolves x, z then y.
  const moveBody = (position, velocity, dt, radius, height, gravity) => {
    const nextX = position.x + velocity.x * dt;
    if (overlaps(nextX, position.y, position.z, radius, height, 0.04)) velocity.x = 0;
    else position.x = nextX;
    const nextZ = position.z + velocity.z * dt;
    if (overlaps(position.x, position.y, nextZ, radius, height, 0.04)) velocity.z = 0;
    else position.z = nextZ;
    position.y += velocity.y * dt;
    let onGround = false;
    const hit = overlaps(position.x, position.y, position.z, radius, height, 0);
    if (hit !== null && velocity.y <= 0) {
      position.y = hit.max.y;
      velocity.y = 0;
      onGround = true;
    } else if (hit !== null) {
      position.y = hit.min.y - height;
      velocity.y = 0;
    }
    if (position.y < 0) {
      position.y = 0;
      velocity.y = 0;
      onGround = true;
    }
    if (gravity !== 0) velocity.y -= gravity * dt;
    return onGround;
  };

  // One slab of the segment-vs-AABB test: narrows [tmin, tmax], or null when rejected.
  const slab = (o, d, mn, mx, tmin, tmax) => {
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return null;
      return [tmin, tmax];
    }
    let t1 = (mn - o) / d;
    let t2 = (mx - o) / d;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    const lo = Math.max(tmin, t1);
    const hi = Math.min(tmax, t2);
    return lo > hi ? null : [lo, hi];
  };

  // Segment vs AABB slab test: true when the segment is blocked by any collider.
  const segmentBlocked = (ax, ay, az, bx, by, bz) => {
    const o = [ax, ay, az];
    const d = [bx - ax, by - ay, bz - az];
    return colliders.some((c) => {
      const mn = [c.min.x, c.min.y, c.min.z];
      const mx = [c.max.x, c.max.y, c.max.z];
      let span = [0, 1];
      for (let a = 0; a < 3; a += 1) {
        span = slab(o[a], d[a], mn[a], mx[a], span[0], span[1]);
        if (span === null) return false;
      }
      return true;
    });
  };

  return { colliders, shootables, group, sites, spawns, nodes, edges, route, nearestNode, moveBody, segmentBlocked, overlaps };
};
