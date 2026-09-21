import * as THREE from "three";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import {
  CSS2DRenderer,
  CSS2DObject
} from "three/addons/renderers/CSS2DRenderer.js";


const $ = (id) => document.getElementById(id);


const clamp = (value, min, max) => {
  return Math.min(max, Math.max(min, value));
};


const numberValue = (id) => {
  const value = Number($(id).value);

  return Number.isFinite(value) ? value : 0;
};


const degreesToRadians = (degrees) => {
  return degrees * Math.PI / 180;
};


const formatNumber = (value, decimals = 2) => {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};


const formatInteger = (value) => {
  return Math.round(Number(value)).toLocaleString("en-US");
};


const formatVolume = (volumeM3) => {
  return `${formatNumber(volumeM3, 2)} m³ / ${formatInteger(volumeM3 * 1000)} L`;
};


const NEIGHBOURS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1]
];


let scene;
let camera;
let renderer;
let labelRenderer;
let controls;

let world;
let terrainMesh;
let waterGroup;
let waterMesh;
let labelGroup;

let terrainState = null;
let rawTriangles = null;

let currentTerrainName = "GENERATED ALPINE BASIN";
let currentResult = null;

let storedDesigns = [];

let targetRainfall = numberValue("rainfallPerM2");
let displayedRainfall = targetRainfall;

let rainfallAnimation = {
  playing: false,
  startTime: 0,
  startRainfall: 0,
  targetRainfall: 0,
  duration: 5000,
  lastCalculation: 0
};


class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    const array = this.items;

    array.push(item);

    let index = array.length - 1;

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);

      if (array[parent].level <= item.level) {
        break;
      }

      array[index] = array[parent];
      index = parent;
    }

    array[index] = item;
  }

  pop() {
    const array = this.items;

    if (array.length === 0) {
      return null;
    }

    const first = array[0];
    const last = array.pop();

    if (array.length === 0) {
      return first;
    }

    let index = 0;

    while (true) {
      const left = index * 2 + 1;

      if (left >= array.length) {
        break;
      }

      const right = left + 1;

      let child = left;

      if (
        right < array.length &&
        array[right].level < array[left].level
      ) {
        child = right;
      }

      if (array[child].level >= last.level) {
        break;
      }

      array[index] = array[child];
      index = child;
    }

    array[index] = last;

    return first;
  }
}


function initializeScene() {
  scene = new THREE.Scene();

  scene.background = new THREE.Color(0x0b0d0e);

  scene.fog = new THREE.Fog(
    0x0b0d0e,
    1800,
    5000
  );

  camera = new THREE.PerspectiveCamera(
    45,
    1,
    0.1,
    10000
  );

  camera.position.set(
    850,
    650,
    850
  );

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true
  });

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 2)
  );

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  renderer.domElement.setAttribute(
    "aria-label",
    "Rainwater retention terrain viewer"
  );

  $("viewer").appendChild(renderer.domElement);


  labelRenderer = new CSS2DRenderer();

  labelRenderer.setSize(
    $("viewer").clientWidth,
    $("viewer").clientHeight
  );

  labelRenderer.domElement.className = "labels-layer";

  $("viewer").appendChild(
    labelRenderer.domElement
  );


  controls = new OrbitControls(
    camera,
    renderer.domElement
  );

  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 5;
  controls.maxDistance = 10000;
  controls.target.set(0, 0, 0);


  const ambientLight = new THREE.HemisphereLight(
    0xbfd8ff,
    0x161616,
    2.3
  );

  scene.add(ambientLight);


  const directionalLight = new THREE.DirectionalLight(
    0xffffff,
    3.4
  );

  directionalLight.position.set(
    -500,
    900,
    500
  );

  scene.add(directionalLight);


  const fillLight = new THREE.DirectionalLight(
    0x6591bf,
    1.15
  );

  fillLight.position.set(
    700,
    300,
    -500
  );

  scene.add(fillLight);


  world = new THREE.Group();

  scene.add(world);


  waterGroup = new THREE.Group();
  waterGroup.name = "retained-water";

  world.add(waterGroup);


  labelGroup = new THREE.Group();
  labelGroup.name = "basin-labels";

  world.add(labelGroup);


  window.addEventListener(
    "resize",
    resizeRenderer
  );

  resizeRenderer();
}


function resizeRenderer() {
  if (!renderer || !camera || !labelRenderer) {
    return;
  }

  const width = $("viewer").clientWidth;
  const height = $("viewer").clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(
    width,
    height,
    false
  );

  labelRenderer.setSize(
    width,
    height
  );
}


function bindPair(
  rangeId,
  numberId,
  callback,
  eventName = "change"
) {
  const range = $(rangeId);
  const number = $(numberId);

  const update = (rawValue) => {
    let value = Number(rawValue);

    if (!Number.isFinite(value)) {
      value = Number(range.value);
    }

    value = clamp(
      value,
      Number(range.min),
      Number(range.max)
    );

    range.value = String(value);
    number.value = String(value);

    callback(value);
  };

  range.addEventListener(
    eventName,
    () => {
      update(range.value);
    }
  );

  number.addEventListener(
    "change",
    () => {
      update(number.value);
    }
  );

  number.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        update(number.value);
        number.blur();
      }
    }
  );
}


function setPairValue(
  rangeId,
  numberId,
  value
) {
  $(rangeId).value = String(value);
  $(numberId).value = String(value);
}


function bindControls() {
  bindPair(
    "rainfallPerM2",
    "rainfallPerM2Number",
    (value) => {
      targetRainfall = value;
      displayedRainfall = value;

      stopRainfallAnimation();

      if (terrainState) {
        renderResult(
          calculateRetentionForRainfall(
            displayedRainfall
          )
        );
      }

      updatePlayButton();
    },
    "input"
  );


  bindPair(
    "rainfallSpeed",
    "rainfallSpeedNumber",
    () => {},
    "input"
  );


  bindPair(
    "waterOpacity",
    "waterOpacityNumber",
    (value) => {
      if (waterMesh) {
        waterMesh.material.opacity = value;
        waterMesh.material.needsUpdate = true;
      }
    },
    "input"
  );


  bindPair(
    "terrainResolution",
    "terrainResolutionNumber",
    () => {
      if (rawTriangles && rawTriangles.length > 0) {
        buildUploadedTerrain();
      } else {
        buildProceduralTerrain();
      }
    },
    "change"
  );


  bindPair(
    "modelScale",
    "modelScaleNumber",
    () => {
      rebuildUploadedTerrainIfAvailable();
    },
    "change"
  );


  bindPair(
    "metersPerModelUnit",
    "metersPerModelUnitNumber",
    () => {
      rebuildUploadedTerrainIfAvailable();
    },
    "change"
  );


  bindPair(
    "depthScale",
    "depthScaleNumber",
    () => {
      rebuildUploadedTerrainIfAvailable();
    },
    "change"
  );


  bindPair(
    "rotationX",
    "rotationXNumber",
    () => {
      rebuildUploadedTerrainIfAvailable();
    },
    "change"
  );


  bindPair(
    "rotationY",
    "rotationYNumber",
    () => {
      rebuildUploadedTerrainIfAvailable();
    },
    "change"
  );


  bindPair(
    "rotationZ",
    "rotationZNumber",
    () => {
      rebuildUploadedTerrainIfAvailable();
    },
    "change"
  );


  bindPair(
    "verticalExaggeration",
    "verticalExaggerationNumber",
    (value) => {
      if (world) {
        world.scale.y = value;
      }

      if (terrainState) {
        updateCameraTarget();
      }
    },
    "input"
  );


  $("showWaterLabels").addEventListener(
    "change",
    () => {
      if (currentResult) {
        updateBasinLabels(currentResult);
      }
    }
  );


  $("playButton").addEventListener(
    "click",
    toggleRainfallAnimation
  );


  $("emptyWaterButton").addEventListener(
    "click",
    emptyWater
  );


  $("resetViewButton").addEventListener(
    "click",
    frameCamera
  );


  $("newTerrainButton").addEventListener(
    "click",
    () => {
      rawTriangles = null;
      currentTerrainName = "GENERATED ALPINE BASIN";

      buildProceduralTerrain();
    }
  );


  $("resetModelOrientationButton").addEventListener(
    "click",
    () => {
      setPairValue("rotationX", "rotationXNumber", 0);
      setPairValue("rotationY", "rotationYNumber", 0);
      setPairValue("rotationZ", "rotationZNumber", 0);

      rebuildUploadedTerrainIfAvailable();
    }
  );


  $("storeDesignButton").addEventListener(
    "click",
    storeCurrentDesign
  );


  $("clearDesignsButton").addEventListener(
    "click",
    () => {
      storedDesigns = [];
      renderDesignComparison();
    }
  );


  $("downloadRetentionButton").addEventListener(
    "click",
    downloadRetentionCsv
  );


  $("chooseModelButton").addEventListener(
    "click",
    () => {
      $("modelFileInput").click();
    }
  );


  $("dropZone").addEventListener(
    "click",
    () => {
      $("modelFileInput").click();
    }
  );


  $("modelFileInput").addEventListener(
    "change",
    async (event) => {
      const file = event.target.files[0];

      if (file) {
        await loadModelFile(file);
      }

      event.target.value = "";
    }
  );


  $("dropZone").addEventListener(
    "dragover",
    (event) => {
      event.preventDefault();
      $("dropZone").classList.add("drag-over");
    }
  );


  $("dropZone").addEventListener(
    "dragleave",
    () => {
      $("dropZone").classList.remove("drag-over");
    }
  );


  $("dropZone").addEventListener(
    "drop",
    async (event) => {
      event.preventDefault();

      $("dropZone").classList.remove("drag-over");

      const file = event.dataTransfer.files[0];

      if (file) {
        await loadModelFile(file);
      }
    }
  );
}


function buildProceduralTerrain() {
  const resolution = Math.round(
    numberValue("terrainResolution")
  );

  const terrain = generateProceduralHeightfield(
    resolution
  );

  applyTerrainData(
    terrain,
    "GENERATED ALPINE BASIN"
  );
}


function generateProceduralHeightfield(
  resolution
) {
  const widthM = 1200;
  const depthM = 920;

  const heights = new Float32Array(
    resolution * resolution
  );

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const normalizedX =
        (x + 0.5) / resolution * 2 - 1;

      const normalizedZ =
        (z + 0.5) / resolution * 2 - 1;

      const localX =
        normalizedX * widthM / 2;

      const localZ =
        normalizedZ * depthM / 2;

      let height = 55;

      height +=
        0.045 *
        (localZ + depthM / 2);

      height +=
        170 *
        Math.pow(
          Math.abs(normalizedX),
          1.75
        );

      height +=
        42 *
        Math.pow(
          Math.abs(normalizedZ),
          2.25
        );

      height +=
        18 *
        Math.sin(
          normalizedX * 7 +
          normalizedZ * 2
        );

      height +=
        12 *
        Math.cos(
          normalizedZ * 10 -
          normalizedX * 3
        );


      const basinDistance =
        Math.pow(
          (localX + 210) / 180,
          2
        ) +
        Math.pow(
          (localZ - 20) / 145,
          2
        );

      height -=
        125 *
        Math.exp(
          -0.5 * basinDistance
        );


      const basinRingDistance =
        Math.sqrt(
          Math.pow(
            (localX + 210) / 250,
            2
          ) +
          Math.pow(
            (localZ - 20) / 205,
            2
          )
        );

      height +=
        34 *
        Math.exp(
          -Math.pow(
            (basinRingDistance - 1) / 0.12,
            2
          )
        );


      const damDistance =
        Math.abs(localZ - 215);

      const damWidth =
        Math.max(
          0,
          1 -
          Math.pow(
            Math.abs(localX) / 420,
            4
          )
        );

      height +=
        48 *
        Math.exp(
          -Math.pow(
            damDistance / 19,
            2
          )
        ) *
        damWidth;


      heights[
        z * resolution + x
      ] = height;
    }
  }

  let minimumHeight = Infinity;

  for (let i = 0; i < heights.length; i++) {
    minimumHeight = Math.min(
      minimumHeight,
      heights[i]
    );
  }

  for (let i = 0; i < heights.length; i++) {
    heights[i] -= minimumHeight;
  }

  return {
    heights,
    resolution,
    widthM,
    depthM
  };
}


function rebuildUploadedTerrainIfAvailable() {
  if (!rawTriangles || rawTriangles.length === 0) {
    return;
  }

  buildUploadedTerrain();
}


function buildUploadedTerrain() {
  try {
    setStatus("SAMPLING MODEL");

    const transformedTriangles =
      transformRawTriangles(rawTriangles);

    const resolution = Math.round(
      numberValue("terrainResolution")
    );

    const terrain =
      rasterizeTrianglesToHeightfield(
        transformedTriangles,
        resolution
      );

    applyTerrainData(
      terrain,
      currentTerrainName
    );
  } catch (error) {
    console.error(error);

    setStatus("MODEL ERROR");

    alert(
      `Could not convert this model into a terrain heightfield.\n\n${error.message}`
    );
  }
}


function transformRawTriangles(
  triangles
) {
  const modelScale =
    numberValue("modelScale");

  const metersPerModelUnit =
    numberValue("metersPerModelUnit");

  const depthScale =
    numberValue("depthScale");

  const rotation = new THREE.Euler(
    degreesToRadians(
      numberValue("rotationX")
    ),
    degreesToRadians(
      numberValue("rotationY")
    ),
    degreesToRadians(
      numberValue("rotationZ")
    ),
    "XYZ"
  );

  const scale =
    modelScale *
    metersPerModelUnit;

  const transformed = [];

  for (const triangle of triangles) {
    const outputTriangle = [];

    for (const point of triangle) {
      const vector = new THREE.Vector3(
        point[0] * scale,
        point[1] * scale,
        point[2] * scale
      );

      vector.applyEuler(rotation);

      vector.z *= depthScale;

      outputTriangle.push([
        vector.x,
        vector.y,
        vector.z
      ]);
    }

    transformed.push(outputTriangle);
  }

  return transformed;
}


function rasterizeTrianglesToHeightfield(
  triangles,
  resolution
) {
  if (!triangles || triangles.length === 0) {
    throw new Error("The model contains no triangles.");
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const triangle of triangles) {
    for (const point of triangle) {
      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);

      minZ = Math.min(minZ, point[2]);
      maxZ = Math.max(maxZ, point[2]);
    }
  }

  const widthM = maxX - minX;
  const depthM = maxZ - minZ;

  if (
    !Number.isFinite(widthM) ||
    !Number.isFinite(depthM) ||
    widthM <= 0 ||
    depthM <= 0
  ) {
    throw new Error(
      "The model does not have a usable horizontal extent."
    );
  }

  const heights = new Float32Array(
    resolution * resolution
  );

  heights.fill(Infinity);


  for (const triangle of triangles) {
    const p0 = triangle[0];
    const p1 = triangle[1];
    const p2 = triangle[2];

    const u0 =
      (p0[0] - minX) / widthM *
      resolution - 0.5;

    const v0 =
      (p0[2] - minZ) / depthM *
      resolution - 0.5;

    const u1 =
      (p1[0] - minX) / widthM *
      resolution - 0.5;

    const v1 =
      (p1[2] - minZ) / depthM *
      resolution - 0.5;

    const u2 =
      (p2[0] - minX) / widthM *
      resolution - 0.5;

    const v2 =
      (p2[2] - minZ) / depthM *
      resolution - 0.5;

    const denominator =
      (v1 - v2) * (u0 - u2) +
      (u2 - u1) * (v0 - v2);

    if (Math.abs(denominator) < 1e-8) {
      continue;
    }

    const minU = Math.max(
      0,
      Math.floor(
        Math.min(u0, u1, u2) - 1
      )
    );

    const maxU = Math.min(
      resolution - 1,
      Math.ceil(
        Math.max(u0, u1, u2) + 1
      )
    );

    const minV = Math.max(
      0,
      Math.floor(
        Math.min(v0, v1, v2) - 1
      )
    );

    const maxV = Math.min(
      resolution - 1,
      Math.ceil(
        Math.max(v0, v1, v2) + 1
      )
    );

    for (let z = minV; z <= maxV; z++) {
      for (let x = minU; x <= maxU; x++) {
        const sampleU = x + 0.5;
        const sampleV = z + 0.5;

        const a =
          ((v1 - v2) *
            (sampleU - u2) +
            (u2 - u1) *
            (sampleV - v2)) /
          denominator;

        const b =
          ((v2 - v0) *
            (sampleU - u2) +
            (u0 - u2) *
            (sampleV - v2)) /
          denominator;

        const c =
          1 - a - b;

        if (
          a < -0.0001 ||
          b < -0.0001 ||
          c < -0.0001
        ) {
          continue;
        }

        const height =
          a * p0[1] +
          b * p1[1] +
          c * p2[1];

        const index =
          z * resolution + x;

        heights[index] = Math.min(
          heights[index],
          height
        );
      }
    }
  }


  fillMissingHeightCells(
    heights,
    resolution
  );

  let minimumHeight = Infinity;

  for (let i = 0; i < heights.length; i++) {
    if (!Number.isFinite(heights[i])) {
      throw new Error(
        "The model could not be converted into a continuous heightfield."
      );
    }

    minimumHeight = Math.min(
      minimumHeight,
      heights[i]
    );
  }

  for (let i = 0; i < heights.length; i++) {
    heights[i] -= minimumHeight;
  }

  return {
    heights,
    resolution,
    widthM,
    depthM
  };
}


function fillMissingHeightCells(
  heights,
  resolution
) {
  const queue = new Int32Array(
    heights.length
  );

  let head = 0;
  let tail = 0;

  for (let i = 0; i < heights.length; i++) {
    if (Number.isFinite(heights[i])) {
      queue[tail++] = i;
    }
  }

  if (tail === 0) {
    return;
  }

  while (head < tail) {
    const index = queue[head++];

    const x = index % resolution;
    const z = Math.floor(index / resolution);

    for (const [dx, dz] of NEIGHBOURS) {
      const nextX = x + dx;
      const nextZ = z + dz;

      if (
        nextX < 0 ||
        nextX >= resolution ||
        nextZ < 0 ||
        nextZ >= resolution
      ) {
        continue;
      }

      const nextIndex =
        nextZ * resolution + nextX;

      if (Number.isFinite(heights[nextIndex])) {
        continue;
      }

      heights[nextIndex] = heights[index];
      queue[tail++] = nextIndex;
    }
  }
}


function applyTerrainData(
  data,
  terrainName
) {
  setStatus("CALCULATING TERRAIN");

  const spillLevels =
    computeSpillLevels(
      data.heights,
      data.resolution
    );

  let minimumHeight = Infinity;
  let maximumHeight = -Infinity;
  let maximumSpill = -Infinity;

  for (let i = 0; i < data.heights.length; i++) {
    minimumHeight = Math.min(
      minimumHeight,
      data.heights[i]
    );

    maximumHeight = Math.max(
      maximumHeight,
      data.heights[i]
    );

    maximumSpill = Math.max(
      maximumSpill,
      spillLevels[i]
    );
  }

  terrainState = {
    ...data,
    spillLevels,
    minimumHeight,
    maximumHeight,
    maximumSpill
  };

  currentTerrainName = terrainName;

  stopRainfallAnimation();

  rebuildTerrainMesh();
  ensureWaterMesh();

  updateTerrainName();
  updateVerticalDisplayScale();
  frameCamera();

  targetRainfall = numberValue(
    "rainfallPerM2"
  );

  displayedRainfall = targetRainfall;

  renderResult(
    calculateRetentionForRainfall(
      displayedRainfall
    )
  );

  setStatus("READY");
}


function computeSpillLevels(
  heights,
  resolution
) {
  const count = heights.length;

  const spillLevels = new Float32Array(
    count
  );

  spillLevels.fill(Infinity);

  const visited = new Uint8Array(
    count
  );

  const heap = new MinHeap();

  const seedBoundaryCell = (index) => {
    if (visited[index]) {
      return;
    }

    visited[index] = 1;
    spillLevels[index] = heights[index];

    heap.push({
      index,
      level: heights[index]
    });
  };


  for (let x = 0; x < resolution; x++) {
    seedBoundaryCell(x);

    seedBoundaryCell(
      (resolution - 1) *
      resolution +
      x
    );
  }


  for (let z = 1; z < resolution - 1; z++) {
    seedBoundaryCell(
      z * resolution
    );

    seedBoundaryCell(
      z * resolution +
      resolution -
      1
    );
  }


  while (heap.size > 0) {
    const current = heap.pop();

    const x =
      current.index % resolution;

    const z =
      Math.floor(
        current.index / resolution
      );

    for (const [dx, dz] of NEIGHBOURS) {
      const nextX = x + dx;
      const nextZ = z + dz;

      if (
        nextX < 0 ||
        nextX >= resolution ||
        nextZ < 0 ||
        nextZ >= resolution
      ) {
        continue;
      }

      const nextIndex =
        nextZ * resolution + nextX;

      if (visited[nextIndex]) {
        continue;
      }

      visited[nextIndex] = 1;

      const nextLevel = Math.max(
        current.level,
        heights[nextIndex]
      );

      spillLevels[nextIndex] = nextLevel;

      heap.push({
        index: nextIndex,
        level: nextLevel
      });
    }
  }

  return spillLevels;
}


function volumeAtWaterLevel(
  state,
  waterLevel
) {
  const {
    heights,
    spillLevels,
    cellAreaM2
  } = state;

  let volumeM3 = 0;

  for (let i = 0; i < heights.length; i++) {
    const cappedLevel = Math.min(
      waterLevel,
      spillLevels[i]
    );

    const depthM = Math.max(
      0,
      cappedLevel - heights[i]
    );

    volumeM3 +=
      depthM * cellAreaM2;
  }

  return volumeM3;
}


function calculateRetentionForRainfall(
  rainfallLPerM2
) {
  const state = terrainState;

  if (!state) {
    return null;
  }

  const {
    heights,
    spillLevels,
    resolution,
    widthM,
    depthM
  } = state;

  const cellWidthM =
    widthM / resolution;

  const cellDepthM =
    depthM / resolution;

  const cellAreaM2 =
    cellWidthM * cellDepthM;

  const terrainAreaM2 =
    widthM * depthM;

  const rainfallDepthM =
    Math.max(0, rainfallLPerM2) / 1000;

  const totalRainfallM3 =
    rainfallDepthM * terrainAreaM2;

  const capacityM3 =
    volumeAtWaterLevel(
      {
        ...state,
        cellAreaM2
      },
      state.maximumSpill
    );


  let waterLevel = state.minimumHeight;
  let retainedVolumeM3 = 0;


  if (
    totalRainfallM3 > 0 &&
    capacityM3 > 0 &&
    state.maximumSpill > state.minimumHeight
  ) {
    if (totalRainfallM3 >= capacityM3) {
      waterLevel = state.maximumSpill;
      retainedVolumeM3 = capacityM3;
    } else {
      let low = state.minimumHeight;
      let high = state.maximumSpill;

      for (let iteration = 0; iteration < 38; iteration++) {
        const middle =
          (low + high) / 2;

        const middleVolume =
          volumeAtWaterLevel(
            {
              ...state,
              cellAreaM2
            },
            middle
          );

        if (middleVolume < totalRainfallM3) {
          low = middle;
        } else {
          high = middle;
        }
      }

      waterLevel =
        (low + high) / 2;

      retainedVolumeM3 =
        volumeAtWaterLevel(
          {
            ...state,
            cellAreaM2
          },
          waterLevel
        );
    }
  }


  const waterDepth = new Float32Array(
    heights.length
  );

  let wetAreaM2 = 0;
  let maximumWaterDepthM = 0;

  for (let i = 0; i < heights.length; i++) {
    const cappedLevel = Math.min(
      waterLevel,
      spillLevels[i]
    );

    const depthM = Math.max(
      0,
      cappedLevel - heights[i]
    );

    waterDepth[i] = depthM;

    if (depthM > 0.0001) {
      wetAreaM2 += cellAreaM2;
    }

    maximumWaterDepthM = Math.max(
      maximumWaterDepthM,
      depthM
    );
  }


  const runoffVolumeM3 = Math.max(
    0,
    totalRainfallM3 -
    retainedVolumeM3
  );

  const retentionPercent =
    totalRainfallM3 > 0
      ? retainedVolumeM3 /
        totalRainfallM3 *
        100
      : 0;


  const result = {
    terrainName: currentTerrainName,

    heights,
    spillLevels,
    waterDepth,

    resolution,
    widthM,
    depthM,

    cellWidthM,
    cellDepthM,
    cellAreaM2,
    terrainAreaM2,

    rainfallLPerM2,
    rainfallDepthM,

    totalRainfallM3,
    totalRainfallL:
      totalRainfallM3 * 1000,

    retainedVolumeM3,
    retainedVolumeL:
      retainedVolumeM3 * 1000,

    runoffVolumeM3,
    runoffVolumeL:
      runoffVolumeM3 * 1000,

    retentionPercent,

    waterLevel,
    maximumWaterDepthM,
    wetAreaM2,

    capacityM3
  };

  result.basins =
    findWaterBasins(result);

  return result;
}


function findWaterBasins(result) {
  const {
    heights,
    waterDepth,
    resolution,
    cellAreaM2,
    cellWidthM,
    cellDepthM,
    widthM,
    depthM
  } = result;

  const visited = new Uint8Array(
    waterDepth.length
  );

  const basins = [];

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const startIndex =
        z * resolution + x;

      if (
        visited[startIndex] ||
        waterDepth[startIndex] <= 0.0001
      ) {
        continue;
      }

      const queue = [startIndex];

      visited[startIndex] = 1;

      let volumeM3 = 0;
      let areaM2 = 0;
      let maximumDepthM = 0;

      let weightedX = 0;
      let weightedY = 0;
      let weightedZ = 0;

      while (queue.length > 0) {
        const index = queue.pop();

        const cellX =
          index % resolution;

        const cellZ =
          Math.floor(
            index / resolution
          );

        const localDepthM =
          waterDepth[index];

        const cellVolumeM3 =
          localDepthM * cellAreaM2;

        const localX =
          (cellX + 0.5) *
          cellWidthM -
          widthM / 2;

        const localZ =
          (cellZ + 0.5) *
          cellDepthM -
          depthM / 2;

        const localY =
          heights[index] +
          localDepthM / 2;

        volumeM3 += cellVolumeM3;
        areaM2 += cellAreaM2;

        maximumDepthM = Math.max(
          maximumDepthM,
          localDepthM
        );

        weightedX +=
          localX * cellVolumeM3;

        weightedY +=
          localY * cellVolumeM3;

        weightedZ +=
          localZ * cellVolumeM3;


        for (const [dx, dz] of NEIGHBOURS) {
          const nextX = cellX + dx;
          const nextZ = cellZ + dz;

          if (
            nextX < 0 ||
            nextX >= resolution ||
            nextZ < 0 ||
            nextZ >= resolution
          ) {
            continue;
          }

          const nextIndex =
            nextZ * resolution +
            nextX;

          if (
            visited[nextIndex] ||
            waterDepth[nextIndex] <= 0.0001
          ) {
            continue;
          }

          visited[nextIndex] = 1;
          queue.push(nextIndex);
        }
      }

      if (volumeM3 <= 0) {
        continue;
      }

      basins.push({
        volumeM3,
        volumeL:
          volumeM3 * 1000,

        areaM2,
        maximumDepthM,

        x: weightedX / volumeM3,
        y: weightedY / volumeM3,
        z: weightedZ / volumeM3
      });
    }
  }

  basins.sort(
    (a, b) => b.volumeM3 - a.volumeM3
  );

  return basins;
}


function rebuildTerrainMesh() {
  if (terrainMesh) {
    world.remove(terrainMesh);

    terrainMesh.geometry.dispose();

    if (Array.isArray(terrainMesh.material)) {
      terrainMesh.material.forEach(
        (material) => material.dispose()
      );
    } else {
      terrainMesh.material.dispose();
    }

    terrainMesh = null;
  }

  const {
    heights,
    resolution,
    widthM,
    depthM
  } = terrainState;

  const positions = [];
  const indices = [];

  const cellWidthM =
    widthM / resolution;

  const cellDepthM =
    depthM / resolution;


  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const index =
        z * resolution + x;

      const localX =
        (x + 0.5) *
        cellWidthM -
        widthM / 2;

      const localZ =
        (z + 0.5) *
        cellDepthM -
        depthM / 2;

      positions.push(
        localX,
        heights[index],
        localZ
      );
    }
  }


  for (let z = 0; z < resolution - 1; z++) {
    for (let x = 0; x < resolution - 1; x++) {
      const a =
        z * resolution + x;

      const b =
        a + 1;

      const c =
        a + resolution;

      const d =
        c + 1;

      indices.push(
        a, c, b,
        b, c, d
      );
    }
  }


  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      positions,
      3
    )
  );

  geometry.setIndex(indices);
  geometry.computeVertexNormals();


  const material =
    new THREE.MeshStandardMaterial({
      color: 0x51595c,
      roughness: 0.95,
      metalness: 0.02,
      flatShading: false
    });


  terrainMesh =
    new THREE.Mesh(
      geometry,
      material
    );

  terrainMesh.name = "terrain";
  terrainMesh.receiveShadow = true;

  world.add(terrainMesh);
}


function ensureWaterMesh() {
  const requiredCount =
    terrainState.heights.length;

  if (
    waterMesh &&
    waterMesh.userData.capacity === requiredCount
  ) {
    return;
  }

  disposeWaterMesh();

  const geometry =
    new THREE.BoxGeometry(
      1,
      1,
      1
    );

  const material =
    new THREE.MeshStandardMaterial({
      color: 0x4d9cff,
      transparent: true,
      opacity: numberValue("waterOpacity"),
      roughness: 0.12,
      metalness: 0.05,
      depthWrite: false,
      vertexColors: true
    });

  waterMesh =
    new THREE.InstancedMesh(
      geometry,
      material,
      requiredCount
    );

  waterMesh.name = "water-volumes";
  waterMesh.userData.capacity = requiredCount;
  waterMesh.frustumCulled = false;
  waterMesh.renderOrder = 5;

  waterMesh.instanceMatrix.setUsage(
    THREE.DynamicDrawUsage
  );

  waterGroup.add(waterMesh);
}


function disposeWaterMesh() {
  if (!waterMesh) {
    return;
  }

  waterGroup.remove(waterMesh);

  waterMesh.geometry.dispose();
  waterMesh.material.dispose();

  waterMesh = null;
}


function updateWaterVisualization(result) {
  if (!waterMesh) {
    return;
  }

  const matrix =
    new THREE.Matrix4();

  const position =
    new THREE.Vector3();

  const scale =
    new THREE.Vector3();

  const quaternion =
    new THREE.Quaternion();

  const color =
    new THREE.Color();

  const verticalScale =
    numberValue("verticalExaggeration");

  let instanceIndex = 0;

  for (let z = 0; z < result.resolution; z++) {
    for (let x = 0; x < result.resolution; x++) {
      const index =
        z * result.resolution + x;

      const depthM =
        result.waterDepth[index];

      if (depthM <= 0.0001) {
        continue;
      }

      const localX =
        (x + 0.5) *
        result.cellWidthM -
        result.widthM / 2;

      const localZ =
        (z + 0.5) *
        result.cellDepthM -
        result.depthM / 2;

      const terrainHeight =
        result.heights[index];

      const visualDepthM =
        depthM * verticalScale;

      position.set(
        localX,
        (
          terrainHeight +
          depthM / 2
        ) * verticalScale,
        localZ
      );

      scale.set(
        result.cellWidthM,
        Math.max(
          visualDepthM,
          0.001
        ),
        result.cellDepthM
      );

      matrix.compose(
        position,
        quaternion,
        scale
      );

      waterMesh.setMatrixAt(
        instanceIndex,
        matrix
      );


      const normalizedDepth =
        clamp(
          depthM /
          Math.max(
            result.maximumWaterDepthM,
            0.001
          ),
          0,
          1
        );

      color.setHSL(
        0.58 -
        normalizedDepth * 0.04,
        0.78,
        0.42 +
        normalizedDepth * 0.16
      );

      waterMesh.setColorAt(
        instanceIndex,
        color
      );

      instanceIndex++;
    }
  }

  waterMesh.count = instanceIndex;
  waterMesh.instanceMatrix.needsUpdate = true;

  if (waterMesh.instanceColor) {
    waterMesh.instanceColor.needsUpdate = true;
  }

  waterMesh.material.opacity =
    numberValue("waterOpacity");

  waterMesh.material.needsUpdate = true;
}


function clearBasinLabels() {
  while (labelGroup.children.length > 0) {
    const child =
      labelGroup.children[
        labelGroup.children.length - 1
      ];

    labelGroup.remove(child);
  }
}


function updateBasinLabels(result) {
  clearBasinLabels();

  const showLabels =
    $("showWaterLabels").checked;

  labelGroup.visible = showLabels;

  if (!showLabels || !result) {
    return;
  }

  const basins =
    result.basins.slice(0, 12);

  basins.forEach((basin, index) => {
    const element =
      document.createElement("div");

    element.className = "basin-label";

    element.innerHTML = `
      <span class="label-title">
        BASIN ${String(index + 1).padStart(2, "0")}
      </span>

      <span class="label-volume">
        ${formatVolume(basin.volumeM3)}
      </span>
    `;

    const label =
      new CSS2DObject(element);

    label.position.set(
      basin.x,
      basin.y + 0.5,
      basin.z
    );

    labelGroup.add(label);
  });
}


function updateReadouts(result) {
  if (!result) {
    return;
  }

  $("terrainAreaReadout").textContent =
    `${formatNumber(result.terrainAreaM2, 0)} m²`;

  $("effectiveRainfallReadout").textContent =
    `${formatNumber(result.rainfallLPerM2, 1)} L/m²`;

  $("rainfallVolumeReadout").textContent =
    formatVolume(result.totalRainfallM3);

  $("retainedVolumeReadout").textContent =
    formatVolume(result.retainedVolumeM3);

  $("runoffVolumeReadout").textContent =
    formatVolume(result.runoffVolumeM3);

  $("retentionPercentReadout").textContent =
    `${formatNumber(result.retentionPercent, 1)} %`;

  $("waterLevelReadout").textContent =
    `${formatNumber(result.waterLevel, 2)} m`;

  $("wetAreaReadout").textContent =
    `${formatNumber(result.wetAreaM2, 0)} m²`;


  const basinReadout =
    $("basinReadout");

  basinReadout.innerHTML = "";

  if (result.basins.length === 0) {
    basinReadout.textContent =
      "No retained water.";

    return;
  }

  result.basins
    .slice(0, 20)
    .forEach((basin, index) => {
      const row =
        document.createElement("div");

      row.className = "basin-row";

      const title =
        document.createElement("span");

      title.textContent =
        `BASIN ${String(index + 1).padStart(2, "0")}`;

      const value =
        document.createElement("strong");

      value.textContent =
        formatVolume(basin.volumeM3);

      row.appendChild(title);
      row.appendChild(value);

      basinReadout.appendChild(row);
    });
}


function updateTerrainName() {
  const name =
    currentTerrainName || "UNNAMED TERRAIN";

  $("terrainNameReadout").textContent =
    name.toUpperCase();

  $("terrainStatus").textContent =
    name.toUpperCase();
}


function updateVerticalDisplayScale() {
  if (world) {
    world.scale.y =
      numberValue("verticalExaggeration");
  }
}


function updateCameraTarget() {
  if (!terrainState || !controls) {
    return;
  }

  const verticalScale =
    numberValue("verticalExaggeration");

  const targetY =
    terrainState.maximumHeight *
    verticalScale *
    0.22;

  controls.target.set(
    0,
    targetY,
    0
  );

  controls.update();
}


function frameCamera() {
  if (!terrainState || !camera || !controls) {
    return;
  }

  const horizontalSize =
    Math.max(
      terrainState.widthM,
      terrainState.depthM
    );

  const verticalScale =
    numberValue("verticalExaggeration");

  const visualHeight =
    terrainState.maximumHeight *
    verticalScale;

  camera.position.set(
    horizontalSize * 0.9,
    Math.max(
      horizontalSize * 0.65,
      visualHeight * 1.35
    ),
    horizontalSize * 0.9
  );

  controls.target.set(
    0,
    visualHeight * 0.22,
    0
  );

  controls.maxDistance =
    horizontalSize * 8;

  controls.update();
}


function renderResult(result) {
  if (!result) {
    return;
  }

  currentResult = result;

  updateWaterVisualization(result);
  updateBasinLabels(result);
  updateReadouts(result);
  updateTerrainName();

  setStatus(
    rainfallAnimation.playing
      ? "RAINFALL FALLING"
      : "READY"
  );
}


function setStatus(message) {
  $("status").textContent =
    message.toUpperCase();
}


function updatePlayButton() {
  const button =
    $("playButton");

  if (rainfallAnimation.playing) {
    button.textContent =
      "PAUSE RAINFALL";

    return;
  }

  if (
    displayedRainfall > 0 &&
    displayedRainfall < targetRainfall
  ) {
    button.textContent =
      "RESUME RAINFALL";

    return;
  }

  if (
    targetRainfall > 0 &&
    displayedRainfall >= targetRainfall
  ) {
    button.textContent =
      "REPLAY RAINFALL";

    return;
  }

  button.textContent =
    "PLAY RAINFALL";
}


function toggleRainfallAnimation() {
  if (!terrainState) {
    return;
  }

  if (rainfallAnimation.playing) {
    rainfallAnimation.playing = false;

    updatePlayButton();
    setStatus("PAUSED");

    return;
  }

  if (
    displayedRainfall >= targetRainfall ||
    targetRainfall <= 0
  ) {
    displayedRainfall = 0;
  }

  const speed =
    Math.max(
      0.25,
      numberValue("rainfallSpeed")
    );

  rainfallAnimation = {
    playing: true,
    startTime: performance.now(),
    startRainfall: displayedRainfall,
    targetRainfall,
    duration: 5000 / speed,
    lastCalculation: 0
  };

  updatePlayButton();
  setStatus("RAINFALL FALLING");
}


function stopRainfallAnimation() {
  rainfallAnimation.playing = false;

  updatePlayButton();
}


function emptyWater() {
  stopRainfallAnimation();

  displayedRainfall = 0;

  if (terrainState) {
    renderResult(
      calculateRetentionForRainfall(0)
    );
  }

  updatePlayButton();
}


function animate(now) {
  requestAnimationFrame(animate);

  if (
    rainfallAnimation.playing &&
    terrainState
  ) {
    const elapsed =
      now -
      rainfallAnimation.startTime;

    const progress =
      clamp(
        elapsed /
        rainfallAnimation.duration,
        0,
        1
      );

    displayedRainfall =
      rainfallAnimation.startRainfall +
      (
        rainfallAnimation.targetRainfall -
        rainfallAnimation.startRainfall
      ) *
      progress;


    const shouldCalculate =
      now -
      rainfallAnimation.lastCalculation >
      70 ||
      progress >= 1;

    if (shouldCalculate) {
      rainfallAnimation.lastCalculation = now;

      renderResult(
        calculateRetentionForRainfall(
          displayedRainfall
        )
      );
    }


    if (progress >= 1) {
      rainfallAnimation.playing = false;
      displayedRainfall = targetRainfall;

      renderResult(
        calculateRetentionForRainfall(
          displayedRainfall
        )
      );

      updatePlayButton();
      setStatus("READY");
    }
  }

  controls.update();

  renderer.render(
    scene,
    camera
  );

  labelRenderer.render(
    scene,
    camera
  );
}


function collectTrianglesFromObject(
  root
) {
  const triangles = [];

  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if (
      !child.isMesh ||
      !child.geometry ||
      !child.geometry.attributes ||
      !child.geometry.attributes.position
    ) {
      return;
    }

    const geometry = child.geometry;
    const position =
      geometry.attributes.position;

    const index =
      geometry.index;

    const matrixWorld =
      child.matrixWorld;

    const readVertex = (vertexIndex) => {
      const vector =
        new THREE.Vector3();

      vector.fromBufferAttribute(
        position,
        vertexIndex
      );

      vector.applyMatrix4(matrixWorld);

      return [
        vector.x,
        vector.y,
        vector.z
      ];
    };


    if (index) {
      for (
        let i = 0;
        i < index.count;
        i += 3
      ) {
        const a =
          index.getX(i);

        const b =
          index.getX(i + 1);

        const c =
          index.getX(i + 2);

        triangles.push([
          readVertex(a),
          readVertex(b),
          readVertex(c)
        ]);
      }
    } else {
      for (
        let i = 0;
        i < position.count;
        i += 3
      ) {
        triangles.push([
          readVertex(i),
          readVertex(i + 1),
          readVertex(i + 2)
        ]);
      }
    }
  });

  return triangles;
}


async function loadModelFile(file) {
  const filename =
    file.name.toLowerCase();

  const extension =
    filename.split(".").pop();

  if (
    !["ply", "stl", "obj"].includes(extension)
  ) {
    alert(
      "Please upload a PLY, STL or OBJ file."
    );

    return;
  }

  try {
    setStatus("LOADING MODEL");

    let object;

    if (extension === "obj") {
      const text =
        await file.text();

      const loader =
        new OBJLoader();

      object =
        loader.parse(text);
    } else {
      const buffer =
        await file.arrayBuffer();

      let geometry;

      if (extension === "ply") {
        const loader =
          new PLYLoader();

        geometry =
          loader.parse(buffer);
      } else {
        const loader =
          new STLLoader();

        geometry =
          loader.parse(buffer);
      }

      if (
        !geometry.attributes.normal
      ) {
        geometry.computeVertexNormals();
      }

      object =
        new THREE.Mesh(
          geometry
        );
    }

    const triangles =
      collectTrianglesFromObject(object);

    if (
      !triangles ||
      triangles.length === 0
    ) {
      throw new Error(
        "No triangles were found in this file."
      );
    }

    rawTriangles = triangles;
    currentTerrainName =
      file.name.replace(
        /\.[^/.]+$/,
        ""
      );

    $("designName").value =
      currentTerrainName;

    if (object) {
      object.traverse((child) => {
        if (
          child.isMesh &&
          child.geometry
        ) {
          child.geometry.dispose();
        }
      });
    }

    buildUploadedTerrain();

    setStatus("READY");
  } catch (error) {
    console.error(error);

    setStatus("MODEL ERROR");

    alert(
      `Could not load the model.\n\n${error.message}`
    );
  }
}


function makeDesignSnapshot(
  name,
  result
) {
  return {
    name,
    terrainName: result.terrainName,
    rainfallLPerM2: result.rainfallLPerM2,
    terrainAreaM2: result.terrainAreaM2,
    totalRainfallM3: result.totalRainfallM3,
    totalRainfallL: result.totalRainfallL,
    retainedVolumeM3: result.retainedVolumeM3,
    retainedVolumeL: result.retainedVolumeL,
    runoffVolumeM3: result.runoffVolumeM3,
    runoffVolumeL: result.runoffVolumeL,
    retentionPercent: result.retentionPercent,
    basins: result.basins.map((basin) => ({
      ...basin
    }))
  };
}


function storeCurrentDesign() {
  if (!terrainState) {
    return;
  }

  const designName =
    $("designName").value.trim() ||
    `Design ${String(
      storedDesigns.length + 1
    ).padStart(2, "0")}`;

  const result =
    calculateRetentionForRainfall(
      targetRainfall
    );

  storedDesigns.push(
    makeDesignSnapshot(
      designName,
      result
    )
  );

  renderDesignComparison();

  setStatus("DESIGN STORED");
}


function renderDesignComparison() {
  const container =
    $("designComparisonTable");

  container.innerHTML = "";

  if (storedDesigns.length === 0) {
    const empty =
      document.createElement("div");

    empty.className =
      "empty-comparison";

    empty.textContent =
      "No designs stored.";

    container.appendChild(empty);

    return;
  }

  const table =
    document.createElement("table");

  table.className =
    "comparison-table";

  const thead =
    document.createElement("thead");

  thead.innerHTML = `
    <tr>
      <th>DESIGN</th>
      <th>RETAINED</th>
      <th>RETENTION</th>
    </tr>
  `;

  table.appendChild(thead);

  const tbody =
    document.createElement("tbody");

  storedDesigns.forEach((design) => {
    const row =
      document.createElement("tr");

    const name =
      document.createElement("td");

    name.innerHTML = `
      <strong>${escapeHtml(design.name)}</strong><br>
      ${escapeHtml(design.terrainName)}
    `;

    const volume =
      document.createElement("td");

    volume.textContent =
      formatVolume(
        design.retainedVolumeM3
      );

    const percentage =
      document.createElement("td");

    percentage.textContent =
      `${formatNumber(
        design.retentionPercent,
        1
      )} %`;

    row.appendChild(name);
    row.appendChild(volume);
    row.appendChild(percentage);

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}


function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function csvEscape(value) {
  const stringValue =
    value === null ||
    value === undefined
      ? ""
      : String(value);

  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replaceAll(
      '"',
      '""'
    )}"`;
  }

  return stringValue;
}


function downloadRetentionCsv() {
  if (!terrainState) {
    return;
  }

  const currentResult =
    calculateRetentionForRainfall(
      targetRainfall
    );

  const currentName =
    $("designName").value.trim() ||
    "CURRENT DESIGN";

  const designs = [
    ...storedDesigns,
    makeDesignSnapshot(
      currentName,
      currentResult
    )
  ];

  const rows = [];

  rows.push([
    "record_type",
    "design",
    "topography",
    "rainfall_L_per_m2",
    "projected_area_m2",
    "total_rainfall_m3",
    "total_rainfall_l",
    "retained_volume_m3",
    "retained_volume_l",
    "runoff_or_spill_m3",
    "runoff_or_spill_l",
    "retention_percent",
    "basin_index",
    "basin_area_m2",
    "basin_max_depth_m",
    "basin_volume_m3",
    "basin_volume_l",
    "centroid_x_m",
    "centroid_y_m",
    "centroid_z_m"
  ]);


  for (const design of designs) {
    rows.push([
      "summary",
      design.name,
      design.terrainName,
      design.rainfallLPerM2,
      design.terrainAreaM2,
      design.totalRainfallM3,
      design.totalRainfallL,
      design.retainedVolumeM3,
      design.retainedVolumeL,
      design.runoffVolumeM3,
      design.runoffVolumeL,
      design.retentionPercent,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      ""
    ]);


    design.basins.forEach((basin, index) => {
      rows.push([
        "basin",
        design.name,
        design.terrainName,
        design.rainfallLPerM2,
        design.terrainAreaM2,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        index + 1,
        basin.areaM2,
        basin.maximumDepthM,
        basin.volumeM3,
        basin.volumeL,
        basin.x,
        basin.y,
        basin.z
      ]);
    });
  }


  const csv =
    rows
      .map((row) => {
        return row
          .map(csvEscape)
          .join(",");
      })
      .join("\n");


  const blob =
    new Blob(
      [csv],
      {
        type: "text/csv;charset=utf-8"
      }
    );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  const filename =
    currentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") ||
    "rainwater-retention";

  link.href = url;
  link.download =
    `${filename}-retention.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  setStatus("CSV DOWNLOADED");
}


initializeScene();
bindControls();
buildProceduralTerrain();
renderDesignComparison();
requestAnimationFrame(animate);
