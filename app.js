import * as THREE from "three";

import {
  OrbitControls
} from "three/addons/controls/OrbitControls.js";

import {
  PLYLoader
} from "three/addons/loaders/PLYLoader.js";

import {
  STLLoader
} from "three/addons/loaders/STLLoader.js";

import {
  OBJLoader
} from "three/addons/loaders/OBJLoader.js";

import {
  CSS2DRenderer,
  CSS2DObject
} from "three/addons/renderers/CSS2DRenderer.js";

import {
  Line2
} from "three/addons/lines/Line2.js";

import {
  LineGeometry
} from "three/addons/lines/LineGeometry.js";

import {
  LineMaterial
} from "three/addons/lines/LineMaterial.js";

import {
  fromArrayBuffer as fromGeoTiffArrayBuffer
} from "geotiff";


/* =========================================================
   HELPERS
========================================================= */

const $ = (id) => {
  return document.getElementById(id);
};


const clamp = (
  value,
  minimum,
  maximum
) => {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
};


const numberValue = (id) => {
  const element =
    $(id);

  if (!element) {
    return 0;
  }

  const value =
    Number(element.value);

  return Number.isFinite(value)
    ? value
    : 0;
};


const degreesToRadians = (
  degrees
) => {
  return degrees *
    Math.PI /
    180;
};


const formatNumber = (
  value,
  decimals = 2
) => {
  return Number(value).toLocaleString(
    "en-US",
    {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }
  );
};


const formatVolume = (
  volumeM3
) => {
  if (!Number.isFinite(volumeM3)) {
    return "0 L";
  }

  if (volumeM3 < 1) {
    return `${Math.round(
      volumeM3 * 1000
    ).toLocaleString(
      "en-US"
    )} L`;
  }

  return `${formatNumber(
    volumeM3,
    2
  )} m³`;
};


function setStatus(message) {
  const element =
    $("status");

  if (!element) {
    return;
  }

  element.textContent =
    String(message).toUpperCase();
}


function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function csvEscape(value) {
  const text =
    value === null ||
    value === undefined
      ? ""
      : String(value);

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replace(
      /"/g,
      '""'
    )}"`;
  }

  return text;
}


function mulberry32(seed) {
  let value =
    seed >>> 0;

  return function random() {
    value += 0x6D2B79F5;

    let result =
      value;

    result =
      Math.imul(
        result ^ result >>> 15,
        result | 1
      );

    result ^=
      result +
      Math.imul(
        result ^ result >>> 7,
        result | 61
      );

    return (
      (
        result ^
        result >>> 14
      ) >>> 0
    ) / 4294967296;
  };
}


function newRandomSeed() {
  if (
    window.crypto &&
    window.crypto.getRandomValues
  ) {
    const values =
      new Uint32Array(1);

    window.crypto.getRandomValues(
      values
    );

    return values[0];
  }

  return (
    (
      Date.now() ^
      Math.floor(
        Math.random() *
        0xffffffff
      )
    ) >>> 0
  );
}


function onClick(
  id,
  callback
) {
  const element =
    $(id);

  if (element) {
    element.addEventListener(
      "click",
      callback
    );
  }
}


function onChange(
  id,
  callback
) {
  const element =
    $(id);

  if (element) {
    element.addEventListener(
      "change",
      callback
    );
  }
}


function disposeObjectResources(
  object
) {
  object.traverse(
    (child) => {
      if (child.geometry) {
        child.geometry.dispose();
      }

      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(
            (material) => {
              lineMaterials.delete(
                material
              );

              material.dispose();
            }
          );
        } else {
          lineMaterials.delete(
            child.material
          );

          child.material.dispose();
        }
      }
    }
  );
}


function clearGroup(
  group
) {
  if (!group) {
    return;
  }

  while (
    group.children.length > 0
  ) {
    const child =
      group.children[
        group.children.length - 1
      ];

    group.remove(
      child
    );

    disposeObjectResources(
      child
    );
  }
}


/* =========================================================
   CONSTANTS
========================================================= */

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

const SLOPE_NEIGHBOURS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1]
];

const MAX_PROCEDURAL_SLOPE_DEGREES =
  45;

const MAX_PROCEDURAL_SLOPE_RATIO =
  Math.tan(
    degreesToRadians(
      MAX_PROCEDURAL_SLOPE_DEGREES
    )
  );

const BASIN_SIGNIFICANCE_RATIO =
  0.05;

const MAX_IMPORTED_RASTER_SIZE =
  512;


/* =========================================================
   MINIMUM HEAP
========================================================= */

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    const array =
      this.items;

    array.push(item);

    let index =
      array.length - 1;

    while (index > 0) {
      const parent =
        Math.floor(
          (index - 1) / 2
        );

      if (
        array[parent].level <=
        item.level
      ) {
        break;
      }

      array[index] =
        array[parent];

      index =
        parent;
    }

    array[index] =
      item;
  }

  pop() {
    const array =
      this.items;

    if (array.length === 0) {
      return null;
    }

    const first =
      array[0];

    const last =
      array.pop();

    if (array.length === 0) {
      return first;
    }

    let index =
      0;

    while (true) {
      const left =
        index * 2 + 1;

      if (left >= array.length) {
        break;
      }

      const right =
        left + 1;

      let child =
        left;

      if (
        right < array.length &&
        array[right].level <
          array[left].level
      ) {
        child =
          right;
      }

      if (
        array[child].level >=
        last.level
      ) {
        break;
      }

      array[index] =
        array[child];

      index =
        child;
    }

    array[index] =
      last;

    return first;
  }
}


/* =========================================================
   GLOBAL STATE
========================================================= */

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
let flowGroup;

let analysisGroup;
let orientationGroup;
let steepnessGroup;
let watershedGroup;

let terrainState =
  null;

let rawTriangles =
  null;

let rawRasterTerrain =
  null;

let currentResult =
  null;

let currentTerrainName =
  "GENERATED ALPINE BASIN";

let proceduralSeed =
  null;

let displayedRainfall =
  numberValue(
    "rainfallPerM2"
  );

let storedDesigns =
  [];

let flowSeed =
  1;

let flowExportPaths =
  [];

let steepnessLegendElement =
  null;

const lineMaterials =
  new Set();


/* =========================================================
   SCENE INITIALISATION
========================================================= */

function initializeScene() {
  scene =
    new THREE.Scene();

  scene.background =
    new THREE.Color(
      0x0b0d0e
    );

  scene.fog =
    new THREE.Fog(
      0x0b0d0e,
      1800,
      6000
    );


  camera =
    new THREE.PerspectiveCamera(
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


  renderer =
    new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true
    });

  renderer.setPixelRatio(
    Math.min(
      window.devicePixelRatio,
      2
    )
  );

  renderer.outputColorSpace =
    THREE.SRGBColorSpace;

  renderer.toneMapping =
    THREE.ACESFilmicToneMapping;

  renderer.toneMappingExposure =
    1.2;

  $("viewer").appendChild(
    renderer.domElement
  );


  labelRenderer =
    new CSS2DRenderer();

  labelRenderer.domElement.className =
    "labels-layer";

  $("viewer").appendChild(
    labelRenderer.domElement
  );


  controls =
    new OrbitControls(
      camera,
      renderer.domElement
    );

  controls.enableDamping =
    true;

  controls.dampingFactor =
    0.07;

  controls.minDistance =
    5;

  controls.maxDistance =
    10000;

  controls.target.set(
    0,
    0,
    0
  );


  scene.add(
    new THREE.HemisphereLight(
      0xc2dcf0,
      0x161616,
      2.3
    )
  );


  const directionalLight =
    new THREE.DirectionalLight(
      0xffffff,
      3.4
    );

  directionalLight.position.set(
    -500,
    900,
    500
  );

  scene.add(
    directionalLight
  );


  const fillLight =
    new THREE.DirectionalLight(
      0x6591bf,
      1.15
    );

  fillLight.position.set(
    700,
    300,
    -500
  );

  scene.add(
    fillLight
  );


  world =
    new THREE.Group();

  scene.add(
    world
  );


  waterGroup =
    new THREE.Group();

  world.add(
    waterGroup
  );


  labelGroup =
    new THREE.Group();

  world.add(
    labelGroup
  );


  flowGroup =
    new THREE.Group();

  world.add(
    flowGroup
  );


  analysisGroup =
    new THREE.Group();

  world.add(
    analysisGroup
  );


  orientationGroup =
    new THREE.Group();

  analysisGroup.add(
    orientationGroup
  );


  steepnessGroup =
    new THREE.Group();

  analysisGroup.add(
    steepnessGroup
  );


  watershedGroup =
    new THREE.Group();

  analysisGroup.add(
    watershedGroup
  );


  createSteepnessLegend();

  resizeRenderer();

  window.addEventListener(
    "resize",
    resizeRenderer
  );
}


function resizeRenderer() {
  if (
    !renderer ||
    !camera ||
    !labelRenderer
  ) {
    return;
  }

  const viewer =
    $("viewer");

  const width =
    Math.max(
      1,
      viewer.clientWidth
    );

  const height =
    Math.max(
      1,
      viewer.clientHeight
    );

  camera.aspect =
    width / height;

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

  lineMaterials.forEach(
    (material) => {
      material.resolution.set(
        width,
        height
      );
    }
  );
}


function createWideLine(
  points,
  color,
  linewidth,
  opacity,
  closed,
  renderOrder
) {
  if (
    !points ||
    points.length < 2
  ) {
    return null;
  }

  const linePoints =
    points.map(
      (point) =>
        point.clone()
    );

  if (closed) {
    linePoints.push(
      linePoints[0].clone()
    );
  }

  const positions =
    [];

  linePoints.forEach(
    (point) => {
      positions.push(
        point.x,
        point.y,
        point.z
      );
    }
  );

  const geometry =
    new LineGeometry();

  geometry.setPositions(
    positions
  );

  const material =
    new LineMaterial({
      color,
      linewidth,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false
    });

  material.resolution.set(
    Math.max(
      1,
      $("viewer").clientWidth
    ),
    Math.max(
      1,
      $("viewer").clientHeight
    )
  );

  lineMaterials.add(
    material
  );

  const line =
    new Line2(
      geometry,
      material
    );

  line.computeLineDistances();

  line.renderOrder =
    renderOrder;

  line.frustumCulled =
    false;

  return line;
}


/* =========================================================
   CONTROL BINDING
========================================================= */

function bindPair(
  rangeId,
  numberId,
  callback,
  rangeEvent = "change"
) {
  const range =
    $(rangeId);

  const number =
    $(numberId);

  if (!range || !number) {
    return;
  }

  const update =
    (rawValue) => {
      let value =
        Number(rawValue);

      if (!Number.isFinite(value)) {
        value =
          Number(range.value);
      }

      value =
        clamp(
          value,
          Number(range.min),
          Number(range.max)
        );

      range.value =
        String(value);

      number.value =
        String(value);

      callback(value);
    };


  range.addEventListener(
    rangeEvent,
    () => {
      update(
        range.value
      );
    }
  );


  number.addEventListener(
    "change",
    () => {
      update(
        number.value
      );
    }
  );


  number.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        update(
          number.value
        );

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
  const range =
    $(rangeId);

  const number =
    $(numberId);

  if (range) {
    range.value =
      String(value);
  }

  if (number) {
    number.value =
      String(value);
  }
}


function bindControls() {
  bindPair(
    "rainfallPerM2",
    "rainfallPerM2Number",
    (value) => {
      displayedRainfall =
        value;

      if (terrainState) {
        renderResult(
          calculateRetentionForRainfall(
            displayedRainfall
          )
        );
      }
    },
    "input"
  );


  bindPair(
    "waterOpacity",
    "waterOpacityNumber",
    updateWaterOpacity,
    "input"
  );


  bindPair(
    "terrainResolution",
    "terrainResolutionNumber",
    () => {
      if (
        rawTriangles &&
        rawTriangles.length > 0
      ) {
        buildUploadedTerrain();
      } else if (
        rawRasterTerrain
      ) {
        buildImportedRasterTerrain();
      } else {
        buildProceduralTerrain(
          false
        );
      }
    },
    "change"
  );


  bindPair(
    "modelScale",
    "modelScaleNumber",
    rebuildUploadedTerrainIfAvailable,
    "change"
  );


  bindPair(
    "metersPerModelUnit",
    "metersPerModelUnitNumber",
    rebuildUploadedTerrainIfAvailable,
    "change"
  );


  bindPair(
    "depthScale",
    "depthScaleNumber",
    rebuildUploadedTerrainIfAvailable,
    "change"
  );


  bindPair(
    "verticalExaggeration",
    "verticalExaggerationNumber",
    () => {
      updateVerticalDisplayScale();
      updateCameraTarget();
    },
    "input"
  );


  bindPair(
    "rotationX",
    "rotationXNumber",
    rebuildUploadedTerrainIfAvailable,
    "change"
  );


  bindPair(
    "rotationY",
    "rotationYNumber",
    rebuildUploadedTerrainIfAvailable,
    "change"
  );


  bindPair(
    "rotationZ",
    "rotationZNumber",
    rebuildUploadedTerrainIfAvailable,
    "change"
  );


  onChange(
    "showFlow",
    updateFlowVisibility
  );


  onChange(
    "showWaterLabels",
    () => {
      if (currentResult) {
        updateBasinLabels(
          currentResult
        );
      }
    }
  );


  onChange(
    "showSlopeOrientation",
    updateAnalysisVisibility
  );


  onChange(
    "showSlopeSteepness",
    updateAnalysisVisibility
  );


  onChange(
    "showWatersheds",
    updateAnalysisVisibility
  );


  const clearWaterButton =
    $("clearWaterButton") ||
    $("emptyWaterButton");

  if (clearWaterButton) {
    clearWaterButton.addEventListener(
      "click",
      () => {
        displayedRainfall =
          0;

        setPairValue(
          "rainfallPerM2",
          "rainfallPerM2Number",
          0
        );

        renderResult(
          calculateRetentionForRainfall(
            0
          )
        );
      }
    );
  }


  onClick(
    "resetViewButton",
    frameCamera
  );


  onClick(
    "newTerrainButton",
    () => {
      rawTriangles =
        null;

      rawRasterTerrain =
        null;

      buildProceduralTerrain(
        true
      );
    }
  );


  onClick(
    "resetModelOrientationButton",
    () => {
      setPairValue(
        "rotationX",
        "rotationXNumber",
        0
      );

      setPairValue(
        "rotationY",
        "rotationYNumber",
        0
      );

      setPairValue(
        "rotationZ",
        "rotationZNumber",
        0
      );

      rebuildUploadedTerrainIfAvailable();
    }
  );


  onClick(
    "storeDesignButton",
    storeCurrentDesign
  );


  onClick(
    "clearDesignsButton",
    () => {
      storedDesigns =
        [];

      renderDesignComparison();
    }
  );


  onClick(
    "downloadRetentionButton",
    downloadRetentionCsv
  );


  onClick(
    "downloadWaterPlyButton",
    () => {
      downloadWaterVolume(
        "ply"
      );
    }
  );


  onClick(
    "downloadWaterStlButton",
    () => {
      downloadWaterVolume(
        "stl"
      );
    }
  );


  onClick(
    "downloadFlowObjButton",
    downloadFlowLinesObj
  );


  onClick(
    "downloadSlopeOrientationButton",
    downloadSlopeOrientation
  );


  onClick(
    "downloadSlopeSteepnessButton",
    downloadSlopeSteepness
  );


  onClick(
    "downloadWatershedsButton",
    downloadWatersheds
  );


  onClick(
    "downloadViewerPngButton",
    downloadViewerPng
  );


  onClick(
    "chooseModelButton",
    () => {
      const input =
        $("modelFileInput");

      if (input) {
        input.click();
      }
    }
  );


  const dropZone =
    $("dropZone");

  if (dropZone) {
    dropZone.addEventListener(
      "click",
      () => {
        const input =
          $("modelFileInput");

        if (input) {
          input.click();
        }
      }
    );


    dropZone.addEventListener(
      "dragover",
      (event) => {
        event.preventDefault();

        dropZone.classList.add(
          "drag-over"
        );
      }
    );


    dropZone.addEventListener(
      "dragleave",
      () => {
        dropZone.classList.remove(
          "drag-over"
        );
      }
    );


    dropZone.addEventListener(
      "drop",
      async (event) => {
        event.preventDefault();

        dropZone.classList.remove(
          "drag-over"
        );

        const files =
          Array.from(
            event.dataTransfer.files
          );

        if (files.length > 0) {
          await loadTerrainFiles(
            files
          );
        }
      }
    );
  }


  const modelInput =
    $("modelFileInput");

  if (modelInput) {
    modelInput.addEventListener(
      "change",
      async (event) => {
        const files =
          Array.from(
            event.target.files
          );

        if (files.length > 0) {
          await loadTerrainFiles(
            files
          );
        }

        event.target.value =
          "";
      }
    );
  }
}


/* =========================================================
   STEEPNESS LEGEND
========================================================= */

function createSteepnessLegend() {
  const viewer =
    $("viewer");

  if (
    !viewer ||
    steepnessLegendElement
  ) {
    return;
  }

  const legend =
    document.createElement(
      "div"
    );

  legend.id =
    "steepnessLegend";

  legend.style.display =
    "none";

  legend.innerHTML =
    `
      <div
        style="
          margin-bottom: 7px;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.12em;
        "
      >
        SLOPE STEEPNESS
      </div>

      <div
        style="
          height: 11px;
          border: 1px solid rgba(255,255,255,0.28);
          background:
            linear-gradient(
              to right,
              hsl(230, 72%, 50%),
              hsl(180, 72%, 50%),
              hsl(120, 72%, 50%),
              hsl(60, 72%, 50%),
              hsl(0, 72%, 50%)
            );
        "
      ></div>

      <div
        style="
          display: flex;
          justify-content: space-between;
          margin-top: 5px;
          color: #bfc7ca;
          font-size: 8px;
          letter-spacing: 0.04em;
        "
      >
        <span>0°</span>
        <span>15°</span>
        <span>30°</span>
        <span>45°+</span>
      </div>
    `;

  viewer.appendChild(
    legend
  );

  steepnessLegendElement =
    legend;
}


function updateSteepnessLegend() {
  if (!steepnessLegendElement) {
    return;
  }

  const checkbox =
    $("showSlopeSteepness");

  steepnessLegendElement.style.display =
    checkbox &&
    checkbox.checked
      ? "block"
      : "none";
}


/* =========================================================
   PROCEDURAL TERRAIN
========================================================= */

function buildProceduralTerrain(
  forceNewSeed = false
) {
  const resolution =
    Math.round(
      numberValue(
        "terrainResolution"
      )
    );

  if (
    forceNewSeed ||
    proceduralSeed === null
  ) {
    proceduralSeed =
      newRandomSeed();
  }

  setStatus(
    "GENERATING ALPINE TERRAIN"
  );

  const terrain =
    generateProceduralHeightfield(
      resolution,
      proceduralSeed
    );

  const terrainName =
    `GENERATED ALPINE ${
      proceduralSeed
        .toString(16)
        .padStart(
          8,
          "0"
        )
        .toUpperCase()
    }`;

  applyTerrainData(
    terrain,
    terrainName
  );
}


function gaussian2D(
  x,
  z,
  radiusX,
  radiusZ
) {
  return Math.exp(
    -0.5 *
    (
      Math.pow(
        x / radiusX,
        2
      ) +
      Math.pow(
        z / radiusZ,
        2
      )
    )
  );
}


function ridgeNoise(value) {
  return 1 -
    Math.abs(
      Math.sin(value)
    );
}


function generateProceduralHeightfield(
  resolution,
  seed
) {
  const random =
    mulberry32(
      seed
    );

  const widthM =
    1250 +
    random() * 300;

  const depthM =
    950 +
    random() * 260;

  const heights =
    new Float32Array(
      resolution *
      resolution
    );

  const valleyAngle =
    random() *
    Math.PI *
    2;

  const phaseA =
    random() *
    Math.PI *
    2;

  const phaseB =
    random() *
    Math.PI *
    2;

  const phaseC =
    random() *
    Math.PI *
    2;


  const basins = [
    {
      x:
        -widthM * 0.08 +
        random() * widthM * 0.16,

      z:
        -depthM * 0.08 +
        random() * depthM * 0.12,

      radiusX:
        105 +
        random() * 55,

      radiusZ:
        115 +
        random() * 60,

      depth:
        45 +
        random() * 45,

      rim:
        22 +
        random() * 18
    },

    {
      x:
        widthM * 0.18 +
        random() * widthM * 0.08,

      z:
        depthM * 0.08 +
        random() * depthM * 0.12,

      radiusX:
        95 +
        random() * 60,

      radiusZ:
        100 +
        random() * 65,

      depth:
        35 +
        random() * 38,

      rim:
        16 +
        random() * 18
    }
  ];


  const cosine =
    Math.cos(
      valleyAngle
    );

  const sine =
    Math.sin(
      valleyAngle
    );


  for (
    let z = 0;
    z < resolution;
    z++
  ) {
    for (
      let x = 0;
      x < resolution;
      x++
    ) {
      const nx =
        (
          x + 0.5
        ) /
        resolution *
        2 -
        1;

      const nz =
        (
          z + 0.5
        ) /
        resolution *
        2 -
        1;

      const localX =
        nx *
        widthM /
        2;

      const localZ =
        nz *
        depthM /
        2;

      const valleyX =
        localX * cosine +
        localZ * sine;

      const valleyZ =
        -localX * sine +
        localZ * cosine;

      const normalizedX =
        valleyX /
        (widthM * 0.5);

      const normalizedZ =
        valleyZ /
        (depthM * 0.5);


      let height =
        62;

      height +=
        72 *
        (
          normalizedZ + 1
        ) /
        2;

      height +=
        120 *
        Math.pow(
          Math.abs(
            normalizedX
          ),
          1.72
        );

      height +=
        30 *
        Math.pow(
          Math.abs(
            normalizedX
          ),
          4
        );


      const sideWeight =
        Math.min(
          1,
          Math.abs(
            normalizedX
          ) * 1.65
        );

      height +=
        sideWeight *
        (
          18 *
          ridgeNoise(
            normalizedZ * 7.2 +
            normalizedX * 3.1 +
            phaseA
          ) +

          13 *
          ridgeNoise(
            normalizedZ * 12.7 -
            normalizedX * 4.4 +
            phaseB
          )
        );


      height +=
        14 *
        Math.sin(
          normalizedZ * 6.2 +
          normalizedX * 2.4 +
          phaseA
        );

      height +=
        10 *
        Math.cos(
          normalizedZ * 11.5 -
          normalizedX * 4.7 +
          phaseB
        );

      height +=
        6 *
        Math.sin(
          normalizedZ * 22 +
          normalizedX * 9 +
          phaseC
        );


      basins.forEach(
        (basin) => {
          const distance =
            Math.sqrt(
              Math.pow(
                (
                  valleyX -
                  basin.x
                ) /
                basin.radiusX,
                2
              ) +
              Math.pow(
                (
                  valleyZ -
                  basin.z
                ) /
                basin.radiusZ,
                2
              )
            );

          height -=
            basin.depth *
            Math.exp(
              -0.5 *
              distance *
              distance
            );

          height +=
            basin.rim *
            Math.exp(
              -Math.pow(
                (
                  distance -
                  1
                ) /
                0.16,
                2
              )
            );
        }
      );


      const moraineDistance =
        Math.abs(
          valleyZ +
          depthM * 0.12
        );

      const moraineExtent =
        Math.max(
          0,
          1 -
          Math.pow(
            Math.abs(
              valleyX
            ) / 430,
            4
          )
        );

      height +=
        55 *
        Math.exp(
          -Math.pow(
            moraineDistance / 24,
            2
          )
        ) *
        moraineExtent;


      heights[
        z *
        resolution +
        x
      ] =
        height;
    }
  }


  enforceMaximumSlope(
    heights,
    resolution,
    widthM,
    depthM,
    MAX_PROCEDURAL_SLOPE_RATIO
  );


  let minimumHeight =
    Infinity;

  heights.forEach(
    (height) => {
      minimumHeight =
        Math.min(
          minimumHeight,
          height
        );
    }
  );

  for (
    let index = 0;
    index < heights.length;
    index++
  ) {
    heights[index] -=
      minimumHeight;
  }


  return {
    heights,
    resolution,
    widthM,
    depthM
  };
}


function enforceMaximumSlope(
  heights,
  resolution,
  widthM,
  depthM,
  maximumSlopeRatio
) {
  const cellWidthM =
    widthM /
    resolution;

  const cellDepthM =
    depthM /
    resolution;


  for (
    let pass = 0;
    pass < 18;
    pass++
  ) {
    let changed =
      false;

    for (
      let z = 0;
      z < resolution;
      z++
    ) {
      for (
        let x = 0;
        x < resolution;
        x++
      ) {
        const index =
          z *
          resolution +
          x;

        SLOPE_NEIGHBOURS.forEach(
          ([dx, dz]) => {
            const nextX =
              x + dx;

            const nextZ =
              z + dz;

            if (
              nextX < 0 ||
              nextX >= resolution ||
              nextZ < 0 ||
              nextZ >= resolution
            ) {
              return;
            }

            const nextIndex =
              nextZ *
              resolution +
              nextX;

            const horizontalDistance =
              Math.hypot(
                dx * cellWidthM,
                dz * cellDepthM
              );

            const maximumDifference =
              horizontalDistance *
              maximumSlopeRatio;

            const difference =
              heights[index] -
              heights[nextIndex];

            if (
              Math.abs(difference) <=
              maximumDifference
            ) {
              return;
            }

            const adjustment =
              (
                Math.abs(difference) -
                maximumDifference
              ) * 0.5;

            if (difference > 0) {
              heights[index] -=
                adjustment;

              heights[nextIndex] +=
                adjustment;
            } else {
              heights[index] +=
                adjustment;

              heights[nextIndex] -=
                adjustment;
            }

            changed =
              true;
          }
        );
      }
    }

    if (!changed) {
      break;
    }
  }
}


/* =========================================================
   RASTER TERRAIN IMPORT
========================================================= */

function rasterValueIsValid(
  value,
  nodata
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return false;
  }

  if (
    Number.isFinite(
      nodata
    ) &&
    Math.abs(
      value - nodata
    ) <
      0.000001
  ) {
    return false;
  }

  return true;
}


function fillMissingRasterValues(
  values,
  width,
  height
) {
  const queue =
    new Int32Array(
      values.length
    );

  let head =
    0;

  let tail =
    0;


  for (
    let index = 0;
    index < values.length;
    index++
  ) {
    if (
      Number.isFinite(
        values[index]
      )
    ) {
      queue[tail++] =
        index;
    }
  }


  if (
    tail === 0
  ) {
    throw new Error(
      "The raster contains no valid elevation values."
    );
  }


  while (
    head < tail
  ) {
    const index =
      queue[head++];

    const x =
      index %
      width;

    const z =
      Math.floor(
        index /
        width
      );

    const neighbours = [
      [x - 1, z],
      [x + 1, z],
      [x, z - 1],
      [x, z + 1]
    ];

    neighbours.forEach(
      ([nextX, nextZ]) => {
        if (
          nextX < 0 ||
          nextX >= width ||
          nextZ < 0 ||
          nextZ >= height
        ) {
          return;
        }

        const nextIndex =
          nextZ *
          width +
          nextX;

        if (
          Number.isFinite(
            values[nextIndex]
          )
        ) {
          return;
        }

        values[nextIndex] =
          values[index];

        queue[tail++] =
          nextIndex;
      }
    );
  }
}


function makeRasterSource({
  values,
  gridWidth,
  gridHeight,
  minX,
  minZ,
  widthM,
  depthM,
  nodata = null,
  reverseRows = false,
  reverseColumns = false
}) {
  if (
    gridWidth < 2 ||
    gridHeight < 2
  ) {
    throw new Error(
      "The raster must contain at least two rows and two columns."
    );
  }

  const orientedValues =
    new Float32Array(
      gridWidth *
      gridHeight
    );

  orientedValues.fill(
    NaN
  );


  for (
    let row = 0;
    row < gridHeight;
    row++
  ) {
    for (
      let column = 0;
      column < gridWidth;
      column++
    ) {
      const sourceIndex =
        row *
        gridWidth +
        column;

      const value =
        Number(
          values[sourceIndex]
        );

      const destinationColumn =
        reverseColumns
          ? gridWidth - 1 - column
          : column;

      const destinationRow =
        reverseRows
          ? gridHeight - 1 - row
          : row;

      const destinationIndex =
        destinationRow *
        gridWidth +
        destinationColumn;

      orientedValues[destinationIndex] =
        rasterValueIsValid(
          value,
          nodata
        )
          ? value
          : NaN;
    }
  }


  fillMissingRasterValues(
    orientedValues,
    gridWidth,
    gridHeight
  );


  return {
    values:
      orientedValues,

    gridWidth,

    gridHeight,

    minX,

    minZ,

    widthM:
      Math.abs(
        widthM
      ),

    depthM:
      Math.abs(
        depthM
      )
  };
}


function sampleRasterGrid(
  source,
  gridX,
  gridZ
) {
  const safeX =
    clamp(
      gridX,
      0,
      source.gridWidth - 1
    );

  const safeZ =
    clamp(
      gridZ,
      0,
      source.gridHeight - 1
    );

  const x0 =
    Math.floor(
      safeX
    );

  const z0 =
    Math.floor(
      safeZ
    );

  const x1 =
    Math.min(
      x0 + 1,
      source.gridWidth - 1
    );

  const z1 =
    Math.min(
      z0 + 1,
      source.gridHeight - 1
    );

  const fx =
    safeX - x0;

  const fz =
    safeZ - z0;

  const values = [
    {
      value:
        source.values[
          z0 *
          source.gridWidth +
          x0
        ],

      weight:
        (1 - fx) *
        (1 - fz)
    },

    {
      value:
        source.values[
          z0 *
          source.gridWidth +
          x1
        ],

      weight:
        fx *
        (1 - fz)
    },

    {
      value:
        source.values[
          z1 *
          source.gridWidth +
          x0
        ],

      weight:
        (1 - fx) *
        fz
    },

    {
      value:
        source.values[
          z1 *
          source.gridWidth +
          x1
        ],

      weight:
        fx *
        fz
    }
  ];

  let weighted =
    0;

  let totalWeight =
    0;

  values.forEach(
    (entry) => {
      if (
        !Number.isFinite(
          entry.value
        )
      ) {
        return;
      }

      weighted +=
        entry.value *
        entry.weight;

      totalWeight +=
        entry.weight;
    }
  );

  if (
    totalWeight <=
    0.000001
  ) {
    return 0;
  }

  return weighted /
    totalWeight;
}


function resampleRasterTerrain(
  source,
  resolution
) {
  const heights =
    new Float32Array(
      resolution *
      resolution
    );


  for (
    let z = 0;
    z < resolution;
    z++
  ) {
    for (
      let x = 0;
      x < resolution;
      x++
    ) {
      const sourceX =
        (
          (
            x + 0.5
          ) /
          resolution
        ) *
        source.gridWidth -
        0.5;

      const sourceZ =
        (
          (
            z + 0.5
          ) /
          resolution
        ) *
        source.gridHeight -
        0.5;

      heights[
        z *
        resolution +
        x
      ] =
        sampleRasterGrid(
          source,
          sourceX,
          sourceZ
        );
    }
  }


  let minimumHeight =
    Infinity;

  for (
    let index = 0;
    index < heights.length;
    index++
  ) {
    minimumHeight =
      Math.min(
        minimumHeight,
        heights[index]
      );
  }

  if (
    !Number.isFinite(
      minimumHeight
    )
  ) {
    throw new Error(
      "The raster contains no usable elevation data."
    );
  }

  for (
    let index = 0;
    index < heights.length;
    index++
  ) {
    heights[index] -=
      minimumHeight;
  }


  return {
    heights,
    resolution,
    widthM:
      source.widthM,
    depthM:
      source.depthM
  };
}


function forEachXYZRecord(
  text,
  callback
) {
  const linePattern =
    /[^\r\n]+/g;

  let match;

  while (
    (
      match =
        linePattern.exec(
          text
        )
    ) !== null
  ) {
    const line =
      match[0]
        .trim();

    if (
      line.length === 0 ||
      line.startsWith("#")
    ) {
      continue;
    }

    const parts =
      line
        .replace(
          /[,;]+/g,
          " "
        )
        .trim()
        .split(
          /\s+/
        );

    if (
      parts.length < 3
    ) {
      continue;
    }

    const x =
      Number(
        parts[0]
      );

    const y =
      Number(
        parts[1]
      );

    const z =
      Number(
        parts[2]
      );

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      continue;
    }

    callback(
      x,
      y,
      z
    );
  }
}


function parseXYZRaster(
  text
) {
  let minimumX =
    Infinity;

  let maximumX =
    -Infinity;

  let minimumY =
    Infinity;

  let maximumY =
    -Infinity;

  let recordCount =
    0;


  forEachXYZRecord(
    text,
    (x, y) => {
      minimumX =
        Math.min(
          minimumX,
          x
        );

      maximumX =
        Math.max(
          maximumX,
          x
        );

      minimumY =
        Math.min(
          minimumY,
          y
        );

      maximumY =
        Math.max(
          maximumY,
          y
        );

      recordCount++;
    }
  );


  if (
    recordCount === 0 ||
    !Number.isFinite(minimumX) ||
    !Number.isFinite(maximumX) ||
    !Number.isFinite(minimumY) ||
    !Number.isFinite(maximumY)
  ) {
    throw new Error(
      "No valid X Y Z records were found."
    );
  }


  const widthM =
    maximumX -
    minimumX;

  const depthM =
    maximumY -
    minimumY;

  if (
    widthM <= 0 ||
    depthM <= 0
  ) {
    throw new Error(
      "The XYZ data does not have a usable horizontal extent."
    );
  }


  const requestedResolution =
    clamp(
      Math.round(
        numberValue(
          "terrainResolution"
        )
      ) || 180,
      64,
      MAX_IMPORTED_RASTER_SIZE
    );

  const aspect =
    widthM /
    depthM;

  const gridWidth =
    clamp(
      Math.round(
        requestedResolution *
        Math.sqrt(
          aspect
        )
      ),
      64,
      MAX_IMPORTED_RASTER_SIZE
    );

  const gridHeight =
    clamp(
      Math.round(
        requestedResolution /
        Math.sqrt(
          aspect
        )
      ),
      64,
      MAX_IMPORTED_RASTER_SIZE
    );

  const sums =
    new Float64Array(
      gridWidth *
      gridHeight
    );

  const counts =
    new Uint32Array(
      gridWidth *
      gridHeight
    );


  forEachXYZRecord(
    text,
    (x, y, z) => {
      const gridX =
        clamp(
          Math.floor(
            (
              x -
              minimumX
            ) /
            widthM *
            gridWidth
          ),
          0,
          gridWidth - 1
        );

      const gridZ =
        clamp(
          Math.floor(
            (
              y -
              minimumY
            ) /
            depthM *
            gridHeight
          ),
          0,
          gridHeight - 1
        );

      const index =
        gridZ *
        gridWidth +
        gridX;

      sums[index] +=
        z;

      counts[index]++;
    }
  );


  const values =
    new Float32Array(
      gridWidth *
      gridHeight
    );

  values.fill(
    NaN
  );


  for (
    let index = 0;
    index < values.length;
    index++
  ) {
    if (
      counts[index] > 0
    ) {
      values[index] =
        sums[index] /
        counts[index];
    }
  }


  return makeRasterSource({
    values,
    gridWidth,
    gridHeight,
    minX: minimumX,
    minZ: minimumY,
    widthM,
    depthM,
    reverseRows: false,
    reverseColumns: false
  });
}


function parseEsriAsciiGrid(
  text
) {
  const lines =
    text.split(
      /\r?\n/
    );

  const header =
    {};

  let dataStart =
    0;

  for (
    let index = 0;
    index < Math.min(12, lines.length);
    index++
  ) {
    const parts =
      lines[index]
        .trim()
        .split(
          /\s+/
        );

    if (
      parts.length < 2
    ) {
      continue;
    }

    const key =
      parts[0]
        .toLowerCase();

    const value =
      Number(
        parts[1]
      );

    if (
      [
        "ncols",
        "nrows",
        "xllcorner",
        "yllcorner",
        "xllcenter",
        "yllcenter",
        "cellsize",
        "nodata_value"
      ].includes(
        key
      )
    ) {
      header[key] =
        value;

      dataStart =
        index + 1;
    }
  }


  const columns =
    Math.round(
      header.ncols
    );

  const rows =
    Math.round(
      header.nrows
    );

  const cellSize =
    Number(
      header.cellsize
    );

  if (
    !Number.isFinite(columns) ||
    !Number.isFinite(rows) ||
    columns < 2 ||
    rows < 2 ||
    !Number.isFinite(cellSize) ||
    cellSize <= 0
  ) {
    throw new Error(
      "The ESRI ASCII Grid header is incomplete or invalid."
    );
  }


  const xll =
    Number.isFinite(
      header.xllcorner
    )
      ? header.xllcorner
      : header.xllcenter -
        cellSize / 2;

  const yll =
    Number.isFinite(
      header.yllcorner
    )
      ? header.yllcorner
      : header.yllcenter -
        cellSize / 2;

  const nodata =
    Number.isFinite(
      header.nodata_value
    )
      ? header.nodata_value
      : null;

  const values =
    new Float32Array(
      columns *
      rows
    );

  values.fill(
    NaN
  );

  let valueIndex =
    0;


  for (
    let lineIndex = dataStart;
    lineIndex < lines.length;
    lineIndex++
  ) {
    const parts =
      lines[lineIndex]
        .trim()
        .split(
          /\s+/
        );

    for (
      let partIndex = 0;
      partIndex < parts.length;
      partIndex++
    ) {
      if (
        valueIndex >= values.length
      ) {
        break;
      }

      const value =
        Number(
          parts[partIndex]
        );

      values[valueIndex++] =
        rasterValueIsValid(
          value,
          nodata
        )
          ? value
          : NaN;
    }
  }


  return makeRasterSource({
    values,
    gridWidth: columns,
    gridHeight: rows,
    minX: xll,
    minZ: yll,
    widthM:
      columns *
      cellSize,
    depthM:
      rows *
      cellSize,
    nodata,
    reverseRows: true,
    reverseColumns: false
  });
}


function parseWorldFile(
  text,
  width,
  height
) {
  const values =
    text
      .trim()
      .split(
        /\s+/
      )
      .map(
        Number
      );

  if (
    values.length < 6 ||
    values.some(
      (value) =>
        !Number.isFinite(value)
    )
  ) {
    throw new Error(
      "The world file is invalid."
    );
  }

  const [
    pixelSizeX,
    rotationY,
    rotationX,
    pixelSizeY,
    originX,
    originY
  ] =
    values;

  if (
    Math.abs(rotationX) > 0.000001 ||
    Math.abs(rotationY) > 0.000001
  ) {
    throw new Error(
      "Rotated world files are not supported. Use a north-up TIFF."
    );
  }

  const absolutePixelWidth =
    Math.abs(
      pixelSizeX
    );

  const absolutePixelHeight =
    Math.abs(
      pixelSizeY
    );

  const firstCenterX =
    originX;

  const firstCenterY =
    originY;

  const lastCenterX =
    originX +
    pixelSizeX *
    (
      width - 1
    );

  const lastCenterY =
    originY +
    pixelSizeY *
    (
      height - 1
    );

  const minimumCenterX =
    Math.min(
      firstCenterX,
      lastCenterX
    );

  const maximumCenterX =
    Math.max(
      firstCenterX,
      lastCenterX
    );

  const minimumCenterY =
    Math.min(
      firstCenterY,
      lastCenterY
    );

  const maximumCenterY =
    Math.max(
      firstCenterY,
      lastCenterY
    );

  return {
    minX:
      minimumCenterX -
      absolutePixelWidth / 2,

    minZ:
      minimumCenterY -
      absolutePixelHeight / 2,

    widthM:
      maximumCenterX -
      minimumCenterX +
      absolutePixelWidth,

    depthM:
      maximumCenterY -
      minimumCenterY +
      absolutePixelHeight,

    reverseRows:
      pixelSizeY < 0,

    reverseColumns:
      pixelSizeX < 0
  };
}


function getGeoTiffNoData(
  image
) {
  let value =
    null;

  if (
    typeof image.getGDALNoData ===
    "function"
  ) {
    value =
      image.getGDALNoData();
  }

  if (
    value === null ||
    value === undefined
  ) {
    const rawValue =
      image.fileDirectory &&
      image.fileDirectory.GDAL_NODATA;

    value =
      rawValue;
  }

  const numericValue =
    Number(
      value
    );

  return Number.isFinite(
    numericValue
  )
    ? numericValue
    : null;
}


function getGeoTiffRasterInfo(
  image,
  width,
  height
) {
  const fileDirectory =
    image.fileDirectory ||
    {};

  const scale =
    fileDirectory.ModelPixelScale;

  const tiepoint =
    fileDirectory.ModelTiepoint;

  const transformation =
    fileDirectory.ModelTransformation;

  let boundingBox =
    null;

  if (
    typeof image.getBoundingBox ===
    "function"
  ) {
    try {
      const candidate =
        image.getBoundingBox();

      if (
        candidate &&
        candidate.length >= 4 &&
        candidate.every(
          (value) =>
            Number.isFinite(
              Number(value)
            )
        )
      ) {
        boundingBox =
          candidate.map(
            Number
          );
      }
    } catch (error) {
      console.warn(
        "Could not read GeoTIFF bounding box.",
        error
      );
    }
  }


  if (
    scale &&
    tiepoint &&
    scale.length >= 2 &&
    tiepoint.length >= 6
  ) {
    const pixelWidth =
      Number(
        scale[0]
      );

    const pixelHeight =
      Number(
        scale[1]
      );

    const originX =
      Number(
        tiepoint[3]
      );

    const originY =
      Number(
        tiepoint[4]
      );

    const fallbackWidth =
      Math.abs(
        pixelWidth
      ) *
      width;

    const fallbackDepth =
      Math.abs(
        pixelHeight
      ) *
      height;

    return {
      minX:
        boundingBox
          ? boundingBox[0]
          : Math.min(
              originX,
              originX +
              pixelWidth *
              width
            ),

      minZ:
        boundingBox
          ? boundingBox[1]
          : Math.min(
              originY,
              originY -
              Math.abs(
                pixelHeight
              ) *
              height
            ),

      widthM:
        boundingBox
          ? boundingBox[2] -
            boundingBox[0]
          : fallbackWidth,

      depthM:
        boundingBox
          ? boundingBox[3] -
            boundingBox[1]
          : fallbackDepth,

      reverseRows:
        pixelHeight >= 0,

      reverseColumns:
        pixelWidth < 0,

      hasGeoreferencing:
        true
    };
  }


  if (
    transformation &&
    transformation.length >= 16
  ) {
    const pixelWidth =
      Number(
        transformation[0]
      );

    const pixelHeight =
      Number(
        transformation[5]
      );

    const originX =
      Number(
        transformation[3]
      );

    const originY =
      Number(
        transformation[7]
      );

    return {
      minX:
        boundingBox
          ? boundingBox[0]
          : Math.min(
              originX,
              originX +
              pixelWidth *
              width
            ),

      minZ:
        boundingBox
          ? boundingBox[1]
          : Math.min(
              originY,
              originY +
              pixelHeight *
              height
            ),

      widthM:
        boundingBox
          ? boundingBox[2] -
            boundingBox[0]
          : Math.abs(
              pixelWidth
            ) *
            width,

      depthM:
        boundingBox
          ? boundingBox[3] -
            boundingBox[1]
          : Math.abs(
              pixelHeight
            ) *
            height,

      reverseRows:
        pixelHeight < 0,

      reverseColumns:
        pixelWidth < 0,

      hasGeoreferencing:
        true
    };
  }


  return {
    minX: 0,
    minZ: 0,
    widthM: width,
    depthM: height,
    reverseRows: true,
    reverseColumns: false,
    hasGeoreferencing: false
  };
}


async function loadGeoTiffRaster(
  file,
  worldFile
) {
  const buffer =
    await file.arrayBuffer();

  const tiff =
    await fromGeoTiffArrayBuffer(
      buffer
    );

  const image =
    await tiff.getImage();

  const originalWidth =
    image.getWidth();

  const originalHeight =
    image.getHeight();

  const readWidth =
    Math.max(
      2,
      Math.min(
        originalWidth,
        MAX_IMPORTED_RASTER_SIZE
      )
    );

  const readHeight =
    Math.max(
      2,
      Math.min(
        originalHeight,
        MAX_IMPORTED_RASTER_SIZE
      )
    );

  const rasterResult =
    await image.readRasters({
      samples: [0],
      interleave: false,
      width: readWidth,
      height: readHeight,
      resampleMethod: "bilinear"
    });

  const values =
    Array.isArray(
      rasterResult
    )
      ? rasterResult[0]
      : rasterResult;

  let info =
    getGeoTiffRasterInfo(
      image,
      originalWidth,
      originalHeight
    );

  if (
    !info.hasGeoreferencing &&
    worldFile
  ) {
    const worldInfo =
      parseWorldFile(
        await worldFile.text(),
        originalWidth,
        originalHeight
      );

    info = {
      ...worldInfo,
      hasGeoreferencing: true
    };
  }


  return makeRasterSource({
    values,
    gridWidth: readWidth,
    gridHeight: readHeight,
    minX: info.minX,
    minZ: info.minZ,
    widthM: info.widthM,
    depthM: info.depthM,
    nodata:
      getGeoTiffNoData(
        image
      ),
    reverseRows:
      info.reverseRows,
    reverseColumns:
      info.reverseColumns
  });
}


function buildImportedRasterTerrain() {
  if (
    !rawRasterTerrain
  ) {
    return;
  }

  try {
    setStatus(
      "SAMPLING RASTER TERRAIN"
    );

    const resolution =
      Math.round(
        numberValue(
          "terrainResolution"
        )
      );

    const terrain =
      resampleRasterTerrain(
        rawRasterTerrain,
        resolution
      );

    applyTerrainData(
      terrain,
      currentTerrainName
    );
  } catch (error) {
    console.error(error);

    setStatus(
      "RASTER ERROR"
    );

    alert(
      `Could not convert this raster into a terrain heightfield.\n\n${error.message}`
    );
  }
}


/* =========================================================
   MODEL IMPORT
========================================================= */

function rebuildUploadedTerrainIfAvailable() {
  if (
    rawTriangles &&
    rawTriangles.length > 0
  ) {
    buildUploadedTerrain();
  } else if (
    rawRasterTerrain
  ) {
    buildImportedRasterTerrain();
  }
}


function transformRawTriangles(
  triangles
) {
  const scale =
    numberValue(
      "modelScale"
    ) *
    numberValue(
      "metersPerModelUnit"
    );

  const depthScale =
    numberValue(
      "depthScale"
    );

  const rotation =
    new THREE.Euler(
      degreesToRadians(
        numberValue(
          "rotationX"
        )
      ),
      degreesToRadians(
        numberValue(
          "rotationY"
        )
      ),
      degreesToRadians(
        numberValue(
          "rotationZ"
        )
      ),
      "XYZ"
    );


  return triangles.map(
    (triangle) =>
      triangle.map(
        (point) => {
          const vector =
            new THREE.Vector3(
              point[0] * scale,
              point[1] * scale,
              point[2] * scale
            );

          vector.applyEuler(
            rotation
          );

          vector.z *=
            depthScale;

          return [
            vector.x,
            vector.y,
            vector.z
          ];
        }
      )
  );
}


function buildUploadedTerrain() {
  try {
    setStatus(
      "SAMPLING MODEL"
    );

    const triangles =
      transformRawTriangles(
        rawTriangles
      );

    const resolution =
      Math.round(
        numberValue(
          "terrainResolution"
        )
      );

    const terrain =
      rasterizeTrianglesToHeightfield(
        triangles,
        resolution
      );

    applyTerrainData(
      terrain,
      currentTerrainName
    );
  } catch (error) {
    console.error(error);

    setStatus(
      "MODEL ERROR"
    );

    alert(
      `Could not convert this model into a terrain heightfield.\n\n${error.message}`
    );
  }
}


function rasterizeTrianglesToHeightfield(
  triangles,
  resolution
) {
  let minX =
    Infinity;

  let maxX =
    -Infinity;

  let minZ =
    Infinity;

  let maxZ =
    -Infinity;


  triangles.forEach(
    (triangle) => {
      triangle.forEach(
        (point) => {
          minX =
            Math.min(
              minX,
              point[0]
            );

          maxX =
            Math.max(
              maxX,
              point[0]
            );

          minZ =
            Math.min(
              minZ,
              point[2]
            );

          maxZ =
            Math.max(
              maxZ,
              point[2]
            );
        }
      );
    }
  );


  const widthM =
    maxX -
    minX;

  const depthM =
    maxZ -
    minZ;

  if (
    widthM <= 0 ||
    depthM <= 0
  ) {
    throw new Error(
      "The model does not have a usable horizontal extent."
    );
  }


  const heights =
    new Float32Array(
      resolution *
      resolution
    );

  heights.fill(
    -Infinity
  );


  triangles.forEach(
    (triangle) => {
      const p0 =
        triangle[0];

      const p1 =
        triangle[1];

      const p2 =
        triangle[2];


      const u0 =
        (
          p0[0] -
          minX
        ) /
        widthM *
        resolution -
        0.5;

      const v0 =
        (
          p0[2] -
          minZ
        ) /
        depthM *
        resolution -
        0.5;

      const u1 =
        (
          p1[0] -
          minX
        ) /
        widthM *
        resolution -
        0.5;

      const v1 =
        (
          p1[2] -
          minZ
        ) /
        depthM *
        resolution -
        0.5;

      const u2 =
        (
          p2[0] -
          minX
        ) /
        widthM *
        resolution -
        0.5;

      const v2 =
        (
          p2[2] -
          minZ
        ) /
        depthM *
        resolution -
        0.5;


      const denominator =
        (
          v1 -
          v2
        ) *
        (
          u0 -
          u2
        ) +
        (
          u2 -
          u1
        ) *
        (
          v0 -
          v2
        );

      if (
        Math.abs(
          denominator
        ) < 1e-8
      ) {
        return;
      }


      const minU =
        Math.max(
          0,
          Math.floor(
            Math.min(
              u0,
              u1,
              u2
            ) - 1
          )
        );

      const maxU =
        Math.min(
          resolution - 1,
          Math.ceil(
            Math.max(
              u0,
              u1,
              u2
            ) + 1
          )
        );

      const minV =
        Math.max(
          0,
          Math.floor(
            Math.min(
              v0,
              v1,
              v2
            ) - 1
          )
        );

      const maxV =
        Math.min(
          resolution - 1,
          Math.ceil(
            Math.max(
              v0,
              v1,
              v2
            ) + 1
          )
        );


      for (
        let z = minV;
        z <= maxV;
        z++
      ) {
        for (
          let x = minU;
          x <= maxU;
          x++
        ) {
          const u =
            x + 0.5;

          const v =
            z + 0.5;


          const a =
            (
              (
                v1 -
                v2
              ) *
              (
                u -
                u2
              ) +
              (
                u2 -
                u1
              ) *
              (
                v -
                v2
              )
            ) /
            denominator;

          const b =
            (
              (
                v2 -
                v0
              ) *
              (
                u -
                u2
              ) +
              (
                u0 -
                u2
              ) *
              (
                v -
                v2
              )
            ) /
            denominator;

          const c =
            1 -
            a -
            b;

          if (
            a < -0.0001 ||
            b < -0.0001 ||
            c < -0.0001
          ) {
            continue;
          }

          const index =
            z *
            resolution +
            x;

          const height =
            a * p0[1] +
            b * p1[1] +
            c * p2[1];

          heights[index] =
            Math.max(
              heights[index],
              height
            );
        }
      }
    }
  );


  fillMissingHeightCells(
    heights,
    resolution
  );


  let minimumHeight =
    Infinity;

  heights.forEach(
    (height) => {
      minimumHeight =
        Math.min(
          minimumHeight,
          height
        );
    }
  );

  for (
    let index = 0;
    index < heights.length;
    index++
  ) {
    heights[index] -=
      minimumHeight;
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
  const queue =
    new Int32Array(
      heights.length
    );

  let head =
    0;

  let tail =
    0;


  heights.forEach(
    (height, index) => {
      if (
        Number.isFinite(
          height
        )
      ) {
        queue[tail++] =
          index;
      }
    }
  );


  while (
    head < tail
  ) {
    const index =
      queue[head++];

    const x =
      index %
      resolution;

    const z =
      Math.floor(
        index /
        resolution
      );


    NEIGHBOURS.forEach(
      ([dx, dz]) => {
        const nextX =
          x + dx;

        const nextZ =
          z + dz;

        if (
          nextX < 0 ||
          nextX >= resolution ||
          nextZ < 0 ||
          nextZ >= resolution
        ) {
          return;
        }

        const nextIndex =
          nextZ *
          resolution +
          nextX;

        if (
          Number.isFinite(
            heights[nextIndex]
          )
        ) {
          return;
        }

        heights[nextIndex] =
          heights[index];

        queue[tail++] =
          nextIndex;
      }
    );
  }
}


/* =========================================================
   HYDROLOGY
========================================================= */

function computeSpillLevels(
  heights,
  resolution
) {
  const spillLevels =
    new Float32Array(
      heights.length
    );

  spillLevels.fill(
    Infinity
  );

  const visited =
    new Uint8Array(
      heights.length
    );

  const heap =
    new MinHeap();


  const seedBoundary =
    (index) => {
      if (visited[index]) {
        return;
      }

      visited[index] =
        1;

      spillLevels[index] =
        heights[index];

      heap.push({
        index,
        level:
          heights[index]
      });
    };


  for (
    let x = 0;
    x < resolution;
    x++
  ) {
    seedBoundary(x);

    seedBoundary(
      (
        resolution - 1
      ) *
      resolution +
      x
    );
  }


  for (
    let z = 1;
    z < resolution - 1;
    z++
  ) {
    seedBoundary(
      z *
      resolution
    );

    seedBoundary(
      z *
      resolution +
      resolution -
      1
    );
  }


  while (
    heap.size > 0
  ) {
    const current =
      heap.pop();

    const x =
      current.index %
      resolution;

    const z =
      Math.floor(
        current.index /
        resolution
      );


    NEIGHBOURS.forEach(
      ([dx, dz]) => {
        const nextX =
          x + dx;

        const nextZ =
          z + dz;

        if (
          nextX < 0 ||
          nextX >= resolution ||
          nextZ < 0 ||
          nextZ >= resolution
        ) {
          return;
        }

        const nextIndex =
          nextZ *
          resolution +
          nextX;

        if (
          visited[nextIndex]
        ) {
          return;
        }

        visited[nextIndex] =
          1;

        const level =
          Math.max(
            current.level,
            heights[nextIndex]
          );

        spillLevels[nextIndex] =
          level;

        heap.push({
          index:
            nextIndex,
          level
        });
      }
    );
  }

  return spillLevels;
}


function computeFlowNetwork(
  heights,
  resolution
) {
  const targets =
    new Int32Array(
      heights.length
    );

  targets.fill(
    -1
  );

  const accumulation =
    new Float32Array(
      heights.length
    );

  accumulation.fill(
    1
  );


  for (
    let z = 0;
    z < resolution;
    z++
  ) {
    for (
      let x = 0;
      x < resolution;
      x++
    ) {
      const index =
        z *
        resolution +
        x;

      const boundary =
        x === 0 ||
        z === 0 ||
        x === resolution - 1 ||
        z === resolution - 1;

      if (boundary) {
        continue;
      }

      let target =
        -1;

      let bestSlope =
        0;


      NEIGHBOURS.forEach(
        ([dx, dz]) => {
          const nextX =
            x + dx;

          const nextZ =
            z + dz;

          const nextIndex =
            nextZ *
            resolution +
            nextX;

          const difference =
            heights[index] -
            heights[nextIndex];

          if (
            difference <=
            0.00001
          ) {
            return;
          }

          const slope =
            difference /
            Math.hypot(
              dx,
              dz
            );

          if (
            slope > bestSlope
          ) {
            bestSlope =
              slope;

            target =
              nextIndex;
          }
        }
      );

      targets[index] =
        target;
    }
  }


  const order =
    Array.from(
      {
        length:
          heights.length
      },
      (_, index) =>
        index
    );

  order.sort(
    (a, b) =>
      heights[b] -
      heights[a]
  );

  order.forEach(
    (index) => {
      const target =
        targets[index];

      if (target >= 0) {
        accumulation[target] +=
          accumulation[index];
      }
    }
  );

  return {
    targets,
    accumulation
  };
}


function computeFlowTerminals(
  targets,
  resolution
) {
  const terminals =
    new Int32Array(
      targets.length
    );

  terminals.fill(
    -2
  );


  for (
    let z = 0;
    z < resolution;
    z++
  ) {
    for (
      let x = 0;
      x < resolution;
      x++
    ) {
      if (
        x === 0 ||
        z === 0 ||
        x === resolution - 1 ||
        z === resolution - 1
      ) {
        terminals[
          z *
          resolution +
          x
        ] =
          -1;
      }
    }
  }


  for (
    let start = 0;
    start < targets.length;
    start++
  ) {
    if (
      terminals[start] !==
      -2
    ) {
      continue;
    }

    const path =
      [];

    const visited =
      new Set();

    let current =
      start;


    while (
      terminals[current] ===
        -2 &&
      !visited.has(
        current
      )
    ) {
      visited.add(
        current
      );

      path.push(
        current
      );

      const target =
        targets[current];

      if (target < 0) {
        const x =
          current %
          resolution;

        const z =
          Math.floor(
            current /
            resolution
          );

        const boundary =
          x === 0 ||
          z === 0 ||
          x === resolution - 1 ||
          z === resolution - 1;

        terminals[current] =
          boundary
            ? -1
            : current;

        break;
      }

      current =
        target;
    }


    let resolved =
      terminals[current];

    if (resolved === -2) {
      resolved =
        current;
    }

    path.forEach(
      (index) => {
        terminals[index] =
          resolved;
      }
    );
  }

  return terminals;
}


function buildBasinDefinitions(
  state
) {
  const groups =
    new Map();


  for (
    let index = 0;
    index < state.heights.length;
    index++
  ) {
    const terminal =
      state.flowTerminals[index];

    if (terminal < 0) {
      continue;
    }

    if (!groups.has(terminal)) {
      groups.set(
        terminal,
        []
      );
    }

    groups.get(
      terminal
    ).push(
      index
    );
  }


  const basins =
    [];


  groups.forEach(
    (catchmentCells, sinkIndex) => {
      const catchmentSet =
        new Set(
          catchmentCells
        );

      let outletCrest =
        Infinity;

      let outletFrom =
        -1;

      let outletTo =
        -1;

      let destinationTerminal =
        -1;


      catchmentCells.forEach(
        (index) => {
          const x =
            index %
            state.resolution;

          const z =
            Math.floor(
              index /
              state.resolution
            );


          NEIGHBOURS.forEach(
            ([dx, dz]) => {
              const nextX =
                x + dx;

              const nextZ =
                z + dz;

              if (
                nextX < 0 ||
                nextX >= state.resolution ||
                nextZ < 0 ||
                nextZ >= state.resolution
              ) {
                return;
              }

              const nextIndex =
                nextZ *
                state.resolution +
                nextX;

              if (
                catchmentSet.has(
                  nextIndex
                )
              ) {
                return;
              }

              const crest =
                Math.max(
                  state.heights[index],
                  state.heights[nextIndex]
                );

              if (
                crest < outletCrest
              ) {
                outletCrest =
                  crest;

                outletFrom =
                  index;

                outletTo =
                  nextIndex;

                destinationTerminal =
                  state.flowTerminals[
                    nextIndex
                  ];
              }
            }
          );
        }
      );


      if (
        !Number.isFinite(
          outletCrest
        )
      ) {
        outletCrest =
          state.spillLevels[
            sinkIndex
          ];
      }


      const cells =
        catchmentCells.filter(
          (index) =>
            state.heights[index] <=
            outletCrest +
            0.0001
        );

      if (
        cells.length ===
        0
      ) {
        cells.push(
          sinkIndex
        );
      }


      let minimumHeight =
        Infinity;

      let capacityM3 =
        0;

      cells.forEach(
        (index) => {
          minimumHeight =
            Math.min(
              minimumHeight,
              state.heights[index]
            );

          capacityM3 +=
            Math.max(
              0,
              outletCrest -
              state.heights[index]
            ) *
            state.cellAreaM2;
        }
      );


      basins.push({
        sinkIndex,
        catchmentCells,
        cells,
        minimumHeight,
        spillLevel:
          outletCrest,
        capacityM3,
        outletFrom,
        outletTo,
        destinationTerminal,
        destinationIndex:
          -1
      });
    }
  );

  return basins;
}


function selectSignificantBasins(
  rawBasins
) {
  if (
    rawBasins.length ===
    0
  ) {
    return [];
  }

  const metric =
    (basin) => {
      if (
        basin.capacityM3 > 0
      ) {
        return basin.capacityM3;
      }

      return basin.cells.length;
    };


  let largest =
    rawBasins[0];

  rawBasins.forEach(
    (basin) => {
      if (
        metric(basin) >
        metric(largest)
      ) {
        largest =
          basin;
      }
    }
  );


  const largestSize =
    metric(largest);

  const threshold =
    largestSize *
    BASIN_SIGNIFICANCE_RATIO;

  const selected =
    rawBasins.filter(
      (basin) =>
        metric(basin) >=
        threshold
    );


  const rawBySink =
    new Map();

  rawBasins.forEach(
    (basin) => {
      rawBySink.set(
        basin.sinkIndex,
        basin
      );
    }
  );


  const selectedBySink =
    new Map();

  selected.forEach(
    (basin, index) => {
      basin.significanceRatio =
        largestSize > 0
          ? metric(basin) /
            largestSize
          : 1;

      selectedBySink.set(
        basin.sinkIndex,
        index
      );
    }
  );


  selected.forEach(
    (basin, selectedIndex) => {
      const visited =
        new Set();

      let cursor =
        rawBySink.get(
          basin.destinationTerminal
        );

      let destinationIndex =
        -1;


      while (
        cursor &&
        !visited.has(
          cursor.sinkIndex
        )
      ) {
        visited.add(
          cursor.sinkIndex
        );

        if (
          selectedBySink.has(
            cursor.sinkIndex
          )
        ) {
          const index =
            selectedBySink.get(
              cursor.sinkIndex
            );

          if (
            index !==
            selectedIndex
          ) {
            destinationIndex =
              index;
          }

          break;
        }

        cursor =
          rawBySink.get(
            cursor.destinationTerminal
          );
      }

      basin.destinationIndex =
        destinationIndex;
    }
  );

  return selected;
}


function getBasinProcessingOrder(
  basins
) {
  const indegree =
    new Int32Array(
      basins.length
    );

  const outgoing =
    basins.map(
      () => []
    );


  basins.forEach(
    (basin, index) => {
      const destination =
        basin.destinationIndex;

      if (
        destination >= 0 &&
        destination !== index
      ) {
        outgoing[index].push(
          destination
        );

        indegree[destination]++;
      }
    }
  );


  const queue =
    [];

  indegree.forEach(
    (value, index) => {
      if (value === 0) {
        queue.push(
          index
        );
      }
    }
  );


  const order =
    [];

  while (
    queue.length > 0
  ) {
    const index =
      queue.shift();

    order.push(
      index
    );

    outgoing[index].forEach(
      (destination) => {
        indegree[destination]--;

        if (
          indegree[destination] ===
          0
        ) {
          queue.push(
            destination
          );
        }
      }
    );
  }


  basins.forEach(
    (_, index) => {
      if (
        !order.includes(
          index
        )
      ) {
        order.push(
          index
        );
      }
    }
  );

  return order;
}


function calculateBasinFillFromVolume(
  basin,
  inflowVolumeM3,
  state
) {
  const inflow =
    Math.max(
      0,
      inflowVolumeM3
    );

  if (
    inflow <= 0 ||
    basin.capacityM3 <= 0
  ) {
    return {
      waterLevel:
        basin.minimumHeight,

      inflowVolumeM3:
        inflow,

      retainedVolumeM3:
        0,

      spillVolumeM3:
        0
    };
  }


  if (
    inflow >=
    basin.capacityM3
  ) {
    return {
      waterLevel:
        basin.spillLevel,

      inflowVolumeM3:
        inflow,

      retainedVolumeM3:
        basin.capacityM3,

      spillVolumeM3:
        inflow -
        basin.capacityM3
    };
  }


  let low =
    basin.minimumHeight;

  let high =
    basin.spillLevel;


  for (
    let iteration = 0;
    iteration < 42;
    iteration++
  ) {
    const middle =
      (
        low +
        high
      ) / 2;

    let volumeM3 =
      0;

    basin.cells.forEach(
      (index) => {
        volumeM3 +=
          Math.max(
            0,
            middle -
            state.heights[index]
          ) *
          state.cellAreaM2;
      }
    );

    if (
      volumeM3 < inflow
    ) {
      low =
        middle;
    } else {
      high =
        middle;
    }
  }


  const waterLevel =
    (
      low +
      high
    ) / 2;

  let retainedVolumeM3 =
    0;

  basin.cells.forEach(
    (index) => {
      retainedVolumeM3 +=
        Math.max(
          0,
          waterLevel -
          state.heights[index]
        ) *
        state.cellAreaM2;
    }
  );


  return {
    waterLevel,

    inflowVolumeM3:
      inflow,

    retainedVolumeM3,

    spillVolumeM3:
      Math.max(
        0,
        inflow -
        retainedVolumeM3
      )
  };
}


function calculateRetentionForRainfall(
  rainfallLPerM2
) {
  if (!terrainState) {
    return null;
  }

  const state =
    terrainState;

  const rainfallDepthM =
    Math.max(
      0,
      rainfallLPerM2
    ) / 1000;

  const totalRainfallM3 =
    rainfallDepthM *
    state.terrainAreaM2;

  const waterDepth =
    new Float32Array(
      state.heights.length
    );

  const incoming =
    new Float64Array(
      state.basinDefinitions.length
    );

  let retainedVolumeM3 =
    0;

  let wetAreaM2 =
    0;

  let maximumWaterDepthM =
    0;

  let maximumWaterLevel =
    state.minimumHeight;


  state.basinDefinitions.forEach(
    (basin, index) => {
      incoming[index] =
        basin.catchmentCells.length *
        state.cellAreaM2 *
        rainfallDepthM;
    }
  );


  const resultBasins =
    [];


  state.basinProcessingOrder.forEach(
    (basinIndex) => {
      const basin =
        state.basinDefinitions[
          basinIndex
        ];

      const fill =
        calculateBasinFillFromVolume(
          basin,
          incoming[basinIndex],
          state
        );

      let areaM2 =
        0;

      let weightedX =
        0;

      let weightedY =
        0;

      let weightedZ =
        0;


      basin.cells.forEach(
        (index) => {
          const depthM =
            Math.max(
              0,
              fill.waterLevel -
              state.heights[index]
            );

          waterDepth[index] =
            depthM;

          if (
            depthM > 0.0001
          ) {
            areaM2 +=
              state.cellAreaM2;

            wetAreaM2 +=
              state.cellAreaM2;
          }

          maximumWaterDepthM =
            Math.max(
              maximumWaterDepthM,
              depthM
            );

          const x =
            index %
            state.resolution;

          const z =
            Math.floor(
              index /
              state.resolution
            );

          const localX =
            (
              x + 0.5
            ) *
            state.cellWidthM -
            state.widthM / 2;

          const localZ =
            (
              z + 0.5
            ) *
            state.cellDepthM -
            state.depthM / 2;

          const volumeM3 =
            depthM *
            state.cellAreaM2;

          weightedX +=
            localX *
            volumeM3;

          weightedY +=
            (
              state.heights[index] +
              depthM / 2
            ) *
            volumeM3;

          weightedZ +=
            localZ *
            volumeM3;
        }
      );


      const resultBasin = {
        basinIndex,

        cells:
          basin.cells,

        catchmentCells:
          basin.catchmentCells,

        minimumHeight:
          basin.minimumHeight,

        retainedVolumeM3:
          fill.retainedVolumeM3,

        retainedVolumeL:
          fill.retainedVolumeM3 *
          1000,

        inflowVolumeM3:
          fill.inflowVolumeM3,

        spillVolumeM3:
          fill.spillVolumeM3,

        spillVolumeL:
          fill.spillVolumeM3 *
          1000,

        waterLevel:
          fill.waterLevel,

        spillLevel:
          basin.spillLevel,

        areaM2,

        maximumDepthM:
          areaM2 > 0
            ? maximumWaterDepthM
            : 0,

        x:
          fill.retainedVolumeM3 > 0
            ? weightedX /
              fill.retainedVolumeM3
            : 0,

        y:
          fill.retainedVolumeM3 > 0
            ? weightedY /
              fill.retainedVolumeM3
            : 0,

        z:
          fill.retainedVolumeM3 > 0
            ? weightedZ /
              fill.retainedVolumeM3
            : 0,

        outletFrom:
          basin.outletFrom,

        outletTo:
          basin.outletTo,

        destinationIndex:
          basin.destinationIndex
      };

      resultBasins.push(
        resultBasin
      );

      retainedVolumeM3 +=
        fill.retainedVolumeM3;

      maximumWaterLevel =
        Math.max(
          maximumWaterLevel,
          fill.waterLevel
        );


      if (
        fill.spillVolumeM3 > 0
      ) {
        const destination =
          basin.destinationIndex;

        if (
          destination >= 0 &&
          destination < incoming.length
        ) {
          incoming[destination] +=
            fill.spillVolumeM3;
        }
      }
    }
  );


  const runoffVolumeM3 =
    Math.max(
      0,
      totalRainfallM3 -
      retainedVolumeM3
    );

  resultBasins.sort(
    (a, b) =>
      b.retainedVolumeM3 -
      a.retainedVolumeM3
  );


  return {
    terrainName:
      currentTerrainName,

    heights:
      state.heights,

    waterDepth,

    resolution:
      state.resolution,

    widthM:
      state.widthM,

    depthM:
      state.depthM,

    cellWidthM:
      state.cellWidthM,

    cellDepthM:
      state.cellDepthM,

    cellAreaM2:
      state.cellAreaM2,

    terrainAreaM2:
      state.terrainAreaM2,

    rainfallLPerM2,

    rainfallDepthM,

    totalRainfallM3,

    totalRainfallL:
      totalRainfallM3 *
      1000,

    retainedVolumeM3,

    retainedVolumeL:
      retainedVolumeM3 *
      1000,

    runoffVolumeM3,

    runoffVolumeL:
      runoffVolumeM3 *
      1000,

    retentionPercent:
      totalRainfallM3 > 0
        ? retainedVolumeM3 /
          totalRainfallM3 *
          100
        : 0,

    maximumWaterLevel,

    maximumWaterDepthM,

    wetAreaM2,

    basins:
      resultBasins
  };
}


/* =========================================================
   TERRAIN APPLICATION
========================================================= */

function applyTerrainData(
  data,
  terrainName
) {
  setStatus(
    "CALCULATING TERRAIN"
  );

  const cellWidthM =
    data.widthM /
    data.resolution;

  const cellDepthM =
    data.depthM /
    data.resolution;

  const cellAreaM2 =
    cellWidthM *
    cellDepthM;

  const spillLevels =
    computeSpillLevels(
      data.heights,
      data.resolution
    );

  const flow =
    computeFlowNetwork(
      data.heights,
      data.resolution
    );

  const flowTerminals =
    computeFlowTerminals(
      flow.targets,
      data.resolution
    );

  const state = {
    ...data,

    cellWidthM,
    cellDepthM,
    cellAreaM2,

    terrainAreaM2:
      data.widthM *
      data.depthM,

    spillLevels,

    flowTargets:
      flow.targets,

    flowAccumulation:
      flow.accumulation,

    flowTerminals
  };


  let minimumHeight =
    Infinity;

  let maximumHeight =
    -Infinity;

  let maximumSpill =
    -Infinity;


  for (
    let index = 0;
    index < data.heights.length;
    index++
  ) {
    minimumHeight =
      Math.min(
        minimumHeight,
        data.heights[index]
      );

    maximumHeight =
      Math.max(
        maximumHeight,
        data.heights[index]
      );

    maximumSpill =
      Math.max(
        maximumSpill,
        spillLevels[index]
      );
  }

  state.minimumHeight =
    minimumHeight;

  state.maximumHeight =
    maximumHeight;

  state.maximumSpill =
    maximumSpill;


  const rawBasins =
    buildBasinDefinitions(
      state
    );

  state.allBasinDefinitions =
    rawBasins;

  state.basinDefinitions =
    selectSignificantBasins(
      rawBasins
    );

  state.basinProcessingOrder =
    getBasinProcessingOrder(
      state.basinDefinitions
    );

  state.flowBlockedCells =
    buildFlowBlockedCells(
      state
    );

  terrainState =
    state;

  currentTerrainName =
    terrainName;

  flowSeed =
    newRandomSeed();

  rebuildTerrainMesh();
  ensureWaterMesh();
  buildAnalysisLayers();
  rebuildFlowVisualization();

  updateTerrainName();
  updateVerticalDisplayScale();
  frameCamera();

  renderResult(
    calculateRetentionForRainfall(
      displayedRainfall
    )
  );

  setStatus(
    "READY"
  );
}


/* =========================================================
   TERRAIN DISPLAY
========================================================= */

function rebuildTerrainMesh() {
  if (terrainMesh) {
    world.remove(
      terrainMesh
    );

    terrainMesh.geometry.dispose();
    terrainMesh.material.dispose();

    terrainMesh =
      null;
  }


  const state =
    terrainState;

  const positions =
    [];

  const indices =
    [];


  for (
    let z = 0;
    z < state.resolution;
    z++
  ) {
    for (
      let x = 0;
      x < state.resolution;
      x++
    ) {
      const index =
        z *
        state.resolution +
        x;

      positions.push(
        (
          x + 0.5
        ) *
        state.cellWidthM -
        state.widthM / 2,

        state.heights[index],

        (
          z + 0.5
        ) *
        state.cellDepthM -
        state.depthM / 2
      );
    }
  }


  for (
    let z = 0;
    z < state.resolution - 1;
    z++
  ) {
    for (
      let x = 0;
      x < state.resolution - 1;
      x++
    ) {
      const a =
        z *
        state.resolution +
        x;

      const b =
        a + 1;

      const c =
        a +
        state.resolution;

      const d =
        c + 1;

      indices.push(
        a,
        c,
        b,

        b,
        c,
        d
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

  geometry.setIndex(
    indices
  );

  geometry.computeVertexNormals();


  terrainMesh =
    new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color:
          0x51595c,

        roughness:
          0.95,

        metalness:
          0.02,

        side:
          THREE.DoubleSide
      })
    );

  world.add(
    terrainMesh
  );
}


/* =========================================================
   TERRAIN-FOLLOWING WATER GEOMETRY
========================================================= */

function ensureWaterMesh() {
  disposeWaterMesh();

  waterMesh =
    new THREE.Group();

  waterGroup.add(
    waterMesh
  );
}


function disposeWaterMesh() {
  if (!waterMesh) {
    return;
  }

  disposeObjectResources(
    waterMesh
  );

  waterGroup.remove(
    waterMesh
  );

  waterMesh =
    null;
}


function updateWaterOpacity(
  value
) {
  if (!waterMesh) {
    return;
  }

  waterMesh.traverse(
    (object) => {
      if (object.material) {
        object.material.opacity =
          value;

        object.material.needsUpdate =
          true;
      }
    }
  );
}


function addExportVertex(
  point,
  vertices,
  vertexMap
) {
  const key =
    point
      .map(
        (value) =>
          Number(value).toFixed(5)
      )
      .join("|");

  if (vertexMap.has(key)) {
    return vertexMap.get(key);
  }

  const index =
    vertices.length / 3;

  vertices.push(
    point[0],
    point[1],
    point[2]
  );

  vertexMap.set(
    key,
    index
  );

  return index;
}


function addExportTriangle(
  a,
  b,
  c,
  vertices,
  triangles,
  vertexMap
) {
  triangles.push([
    addExportVertex(
      a,
      vertices,
      vertexMap
    ),

    addExportVertex(
      b,
      vertices,
      vertexMap
    ),

    addExportVertex(
      c,
      vertices,
      vertexMap
    )
  ]);
}


function addExportQuad(
  a,
  b,
  c,
  d,
  vertices,
  triangles,
  vertexMap
) {
  addExportTriangle(
    a,
    b,
    c,
    vertices,
    triangles,
    vertexMap
  );

  addExportTriangle(
    a,
    c,
    d,
    vertices,
    triangles,
    vertexMap
  );
}


function getTerrainCornerHeight(
  state,
  cornerX,
  cornerZ
) {
  let total =
    0;

  let count =
    0;


  for (
    let dz = -1;
    dz <= 0;
    dz++
  ) {
    for (
      let dx = -1;
      dx <= 0;
      dx++
    ) {
      const x =
        cornerX + dx;

      const z =
        cornerZ + dz;

      if (
        x < 0 ||
        x >= state.resolution ||
        z < 0 ||
        z >= state.resolution
      ) {
        continue;
      }

      total +=
        state.heights[
          z *
          state.resolution +
          x
        ];

      count++;
    }
  }

  return count > 0
    ? total / count
    : state.minimumHeight;
}


function getTerrainCellCorners(
  state,
  x,
  z
) {
  const x0 =
    x *
    state.cellWidthM -
    state.widthM / 2;

  const x1 =
    (
      x + 1
    ) *
    state.cellWidthM -
    state.widthM / 2;

  const z0 =
    z *
    state.cellDepthM -
    state.depthM / 2;

  const z1 =
    (
      z + 1
    ) *
    state.cellDepthM -
    state.depthM / 2;

  return [
    {
      x: x0,
      y:
        getTerrainCornerHeight(
          state,
          x,
          z
        ),
      z: z0
    },

    {
      x: x1,
      y:
        getTerrainCornerHeight(
          state,
          x + 1,
          z
        ),
      z: z0
    },

    {
      x: x1,
      y:
        getTerrainCornerHeight(
          state,
          x + 1,
          z + 1
        ),
      z: z1
    },

    {
      x: x0,
      y:
        getTerrainCornerHeight(
          state,
          x,
          z + 1
        ),
      z: z1
    }
  ];
}


function clipPolygonToWaterLevel(
  points,
  waterLevel
) {
  const output =
    [];

  for (
    let index = 0;
    index < points.length;
    index++
  ) {
    const a =
      points[index];

    const b =
      points[
        (
          index + 1
        ) %
        points.length
      ];

    const aInside =
      a.y <= waterLevel;

    const bInside =
      b.y <= waterLevel;


    if (
      aInside &&
      bInside
    ) {
      output.push({
        x: b.x,
        y: b.y,
        z: b.z
      });

      continue;
    }


    const denominator =
      b.y - a.y;

    if (
      Math.abs(
        denominator
      ) < 0.000001
    ) {
      continue;
    }

    const amount =
      (
        waterLevel -
        a.y
      ) / denominator;

    const intersection = {
      x:
        a.x +
        (
          b.x -
          a.x
        ) *
        amount,

      y:
        waterLevel,

      z:
        a.z +
        (
          b.z -
          a.z
        ) *
        amount
    };


    if (
      aInside &&
      !bInside
    ) {
      output.push(
        intersection
      );
    }

    if (
      !aInside &&
      bInside
    ) {
      output.push(
        intersection
      );

      output.push({
        x: b.x,
        y: b.y,
        z: b.z
      });
    }
  }

  return output;
}


function polygonArea(
  points
) {
  let area =
    0;

  for (
    let index = 0;
    index < points.length;
    index++
  ) {
    const a =
      points[index];

    const b =
      points[
        (
          index + 1
        ) %
        points.length
      ];

    area +=
      a.x * b.z -
      b.x * a.z;
  }

  return Math.abs(
    area
  ) * 0.5;
}


function triangulatePolygon(
  points
) {
  const contour =
    points.map(
      (point) =>
        new THREE.Vector2(
          point.x,
          point.z
        )
    );

  const triangles =
    THREE.ShapeUtils.triangulateShape(
      contour,
      []
    );

  if (
    triangles &&
    triangles.length > 0
  ) {
    return triangles;
  }

  const fallback =
    [];

  for (
    let index = 1;
    index < points.length - 1;
    index++
  ) {
    fallback.push([
      0,
      index,
      index + 1
    ]);
  }

  return fallback;
}


function addWaterCellGeometry(
  cell,
  waterLevel,
  wetSet,
  state,
  vertices,
  triangles,
  vertexMap
) {
  const polygon =
    clipPolygonToWaterLevel(
      cell.corners,
      waterLevel
    );

  if (
    polygon.length < 3 ||
    polygonArea(polygon) <
      state.cellAreaM2 *
      0.00001
  ) {
    return;
  }


  const top =
    polygon.map(
      (point) => [
        point.x,
        waterLevel,
        point.z
      ]
    );

  const bottom =
    polygon.map(
      (point) => [
        point.x,
        point.y,
        point.z
      ]
    );


  triangulatePolygon(
    polygon
  ).forEach(
    (face) => {
      addExportTriangle(
        top[face[0]],
        top[face[1]],
        top[face[2]],
        vertices,
        triangles,
        vertexMap
      );

      addExportTriangle(
        bottom[face[2]],
        bottom[face[1]],
        bottom[face[0]],
        vertices,
        triangles,
        vertexMap
      );
    }
  );


  const edges = [
    {
      a:
        cell.corners[0],

      b:
        cell.corners[1],

      nx:
        cell.x,

      nz:
        cell.z - 1
    },

    {
      a:
        cell.corners[1],

      b:
        cell.corners[2],

      nx:
        cell.x + 1,

      nz:
        cell.z
    },

    {
      a:
        cell.corners[2],

      b:
        cell.corners[3],

      nx:
        cell.x,

      nz:
        cell.z + 1
    },

    {
      a:
        cell.corners[3],

      b:
        cell.corners[0],

      nx:
        cell.x - 1,

      nz:
        cell.z
    }
  ];


  edges.forEach(
    (edge) => {
      const neighbourIndex =
        edge.nz *
        state.resolution +
        edge.nx;

      const neighbourWet =
        edge.nx >= 0 &&
        edge.nx < state.resolution &&
        edge.nz >= 0 &&
        edge.nz < state.resolution &&
        wetSet.has(
          neighbourIndex
        );

      if (neighbourWet) {
        return;
      }

      const aInside =
        edge.a.y <= waterLevel;

      const bInside =
        edge.b.y <= waterLevel;

      if (
        !aInside &&
        !bInside
      ) {
        return;
      }

      let a =
        edge.a;

      let b =
        edge.b;


      if (
        aInside !==
        bInside
      ) {
        const denominator =
          b.y - a.y;

        if (
          Math.abs(
            denominator
          ) < 0.000001
        ) {
          return;
        }

        const amount =
          (
            waterLevel -
            a.y
          ) / denominator;

        const intersection = {
          x:
            a.x +
            (
              b.x -
              a.x
            ) *
            amount,

          y:
            waterLevel,

          z:
            a.z +
            (
              b.z -
              a.z
            ) *
            amount
        };

        if (aInside) {
          b =
            intersection;
        } else {
          a =
            intersection;
        }
      }


      addExportQuad(
        [
          a.x,
          a.y,
          a.z
        ],

        [
          b.x,
          b.y,
          b.z
        ],

        [
          b.x,
          waterLevel,
          b.z
        ],

        [
          a.x,
          waterLevel,
          a.z
        ],

        vertices,
        triangles,
        vertexMap
      );
    }
  );
}


function buildVoxelWaterVolumeMesh(
  result,
  selectedBasin = null
) {
  const vertices =
    [];

  const triangles =
    [];

  const vertexMap =
    new Map();

  const basins =
    selectedBasin
      ? [selectedBasin]
      : result.basins;


  basins.forEach(
    (basin) => {
      if (
        basin.retainedVolumeM3 <=
        0.000001
      ) {
        return;
      }

      const wetSet =
        new Set();

      const cells =
        [];


      basin.cells.forEach(
        (index) => {
          const x =
            index %
            result.resolution;

          const z =
            Math.floor(
              index /
              result.resolution
            );

          const corners =
            getTerrainCellCorners(
              result,
              x,
              z
            );

          const polygon =
            clipPolygonToWaterLevel(
              corners,
              basin.waterLevel
            );

          if (
            polygon.length >= 3 &&
            polygonArea(polygon) >
              result.cellAreaM2 *
              0.00001
          ) {
            wetSet.add(
              index
            );

            cells.push({
              index,
              x,
              z,
              corners
            });
          }
        }
      );


      cells.forEach(
        (cell) => {
          addWaterCellGeometry(
            cell,
            basin.waterLevel,
            wetSet,
            result,
            vertices,
            triangles,
            vertexMap
          );
        }
      );
    }
  );


  return {
    vertices,
    triangles
  };
}


function createGeometryFromExportMesh(
  mesh
) {
  const positions =
    [];

  const indices =
    [];


  mesh.triangles.forEach(
    (triangle) => {
      const base =
        positions.length / 3;

      triangle.forEach(
        (vertexIndex) => {
          positions.push(
            mesh.vertices[
              vertexIndex * 3
            ],

            mesh.vertices[
              vertexIndex * 3 + 1
            ],

            mesh.vertices[
              vertexIndex * 3 + 2
            ]
          );
        }
      );

      indices.push(
        base,
        base + 1,
        base + 2
      );
    }
  );


  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      positions,
      3
    )
  );

  geometry.setIndex(
    indices
  );

  geometry.computeVertexNormals();

  return geometry;
}


function updateWaterVisualization(
  result
) {
  if (!waterMesh) {
    return;
  }

  clearGroup(
    waterMesh
  );


  result.basins.forEach(
    (basin) => {
      if (
        basin.retainedVolumeM3 <=
        0.000001
      ) {
        return;
      }

      const meshData =
        buildVoxelWaterVolumeMesh(
          result,
          basin
        );

      if (
        meshData.triangles.length ===
        0
      ) {
        return;
      }

      const mesh =
        new THREE.Mesh(
          createGeometryFromExportMesh(
            meshData
          ),

          new THREE.MeshBasicMaterial({
            color:
              0x7897aa,

            transparent:
              true,

            opacity:
              numberValue(
                "waterOpacity"
              ),

            depthWrite:
              false,

            side:
              THREE.DoubleSide
          })
        );

      mesh.renderOrder =
        10;

      mesh.frustumCulled =
        false;

      waterMesh.add(
        mesh
      );
    }
  );

  updateWaterOpacity(
    numberValue(
      "waterOpacity"
    )
  );
}


/* =========================================================
   LABELS AND READOUTS
========================================================= */

function updateBasinLabels(
  result
) {
  clearGroup(
    labelGroup
  );

  const checkbox =
    $("showWaterLabels");

  labelGroup.visible =
    checkbox
      ? checkbox.checked
      : true;

  if (
    !labelGroup.visible
  ) {
    return;
  }

  const basins =
    result.basins.filter(
      (basin) =>
        basin.retainedVolumeM3 >
        0.000001
    );

  const lift =
    Math.max(
      0.8,
      Math.min(
        result.cellWidthM,
        result.cellDepthM
      ) * 0.2
    );


  basins.forEach(
    (basin, index) => {
      const element =
        document.createElement(
          "div"
        );

      element.className =
        "basin-label";

      element.innerHTML =
        `
          <span class="label-title">
            BASIN ${String(
              index + 1
            ).padStart(
              2,
              "0"
            )}
          </span>

          <span class="label-volume">
            ${formatVolume(
              basin.retainedVolumeM3
            )}
          </span>
        `;

      const label =
        new CSS2DObject(
          element
        );

      label.position.set(
        basin.x,
        basin.waterLevel + lift,
        basin.z
      );

      labelGroup.add(
        label
      );
    }
  );
}


function updateReadouts(
  result
) {
  $("terrainAreaReadout").textContent =
    `${formatNumber(
      result.terrainAreaM2,
      0
    )} m²`;

  $("effectiveRainfallReadout").textContent =
    `${formatNumber(
      result.rainfallLPerM2,
      1
    )} / ${formatNumber(
      result.rainfallDepthM * 1000,
      1
    )} mm`;

  $("rainfallVolumeReadout").textContent =
    formatVolume(
      result.totalRainfallM3
    );

  $("retainedVolumeReadout").textContent =
    formatVolume(
      result.retainedVolumeM3
    );

  $("runoffVolumeReadout").textContent =
    formatVolume(
      result.runoffVolumeM3
    );

  $("retentionPercentReadout").textContent =
    `${formatNumber(
      result.retentionPercent,
      1
    )} %`;

  $("waterLevelReadout").textContent =
    `${formatNumber(
      result.maximumWaterLevel,
      2
    )} m`;

  $("wetAreaReadout").textContent =
    `${formatNumber(
      result.wetAreaM2,
      0
    )} m²`;


  const output =
    $("basinReadout");

  output.innerHTML =
    "";

  const basins =
    result.basins.filter(
      (basin) =>
        basin.retainedVolumeM3 >
        0.000001
    );

  if (
    basins.length ===
    0
  ) {
    output.textContent =
      "No retained water.";

    return;
  }


  basins.forEach(
    (basin, index) => {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "basin-row";

      row.innerHTML =
        `
          <span>
            BASIN ${String(
              index + 1
            ).padStart(
              2,
              "0"
            )}
          </span>

          <strong>
            ${formatVolume(
              basin.retainedVolumeM3
            )}
          </strong>
        `;

      output.appendChild(
        row
      );
    }
  );
}


function updateTerrainName() {
  $("terrainNameReadout").textContent =
    currentTerrainName.toUpperCase();

  $("terrainStatus").textContent =
    currentTerrainName.toUpperCase();
}


function renderResult(
  result
) {
  if (!result) {
    return;
  }

  currentResult =
    result;

  updateWaterVisualization(
    result
  );

  updateBasinLabels(
    result
  );

  updateReadouts(
    result
  );

  updateFlowVisibility();
  updateAnalysisVisibility();
  updateTerrainName();
}


/* =========================================================
   CAMERA
========================================================= */

function updateVerticalDisplayScale() {
  if (world) {
    world.scale.y =
      numberValue(
        "verticalExaggeration"
      );
  }
}


function updateCameraTarget() {
  if (
    !terrainState ||
    !controls
  ) {
    return;
  }

  controls.target.set(
    0,
    terrainState.maximumHeight *
      numberValue(
        "verticalExaggeration"
      ) *
      0.22,
    0
  );

  controls.update();
}


function frameCamera() {
  if (!terrainState) {
    return;
  }

  const horizontalSize =
    Math.max(
      terrainState.widthM,
      terrainState.depthM
    );

  const verticalScale =
    numberValue(
      "verticalExaggeration"
    );

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


/* =========================================================
   ANALYSIS LAYERS
========================================================= */

function getCellGradient(
  state,
  x,
  z
) {
  const heightAt =
    (sampleX, sampleZ) => {
      const safeX =
        clamp(
          sampleX,
          0,
          state.resolution - 1
        );

      const safeZ =
        clamp(
          sampleZ,
          0,
          state.resolution - 1
        );

      return state.heights[
        safeZ *
        state.resolution +
        safeX
      ];
    };


  const left =
    heightAt(
      x - 1,
      z
    );

  const right =
    heightAt(
      x + 1,
      z
    );

  const down =
    heightAt(
      x,
      z - 1
    );

  const up =
    heightAt(
      x,
      z + 1
    );

  const gradientX =
    (
      right -
      left
    ) /
    (
      2 *
      state.cellWidthM
    );

  const gradientZ =
    (
      up -
      down
    ) /
    (
      2 *
      state.cellDepthM
    );

  return {
    gradientX,
    gradientZ,

    downhillX:
      -gradientX,

    downhillZ:
      -gradientZ,

    slopeDegrees:
      Math.atan(
        Math.hypot(
          gradientX,
          gradientZ
        )
      ) *
      180 /
      Math.PI
  };
}


function slopeColor(
  normalized
) {
  const color =
    new THREE.Color();

  color.setHSL(
    0.64 -
    clamp(
      normalized,
      0,
      1
    ) * 0.64,

    0.72,

    0.5
  );

  return color;
}


function watershedColor(
  watershedId
) {
  if (watershedId < 0) {
    return new THREE.Color(
      0x566166
    );
  }

  const color =
    new THREE.Color();

  color.setHSL(
    (
      watershedId *
      0.61803398875
    ) % 1,

    0.54,

    0.5
  );

  return color;
}


function appendAnalysisQuad(
  data,
  points,
  color
) {
  const base =
    data.positions.length / 3;

  points.forEach(
    (point) => {
      data.positions.push(
        point.x,
        point.y,
        point.z
      );

      data.vertexColors.push(
        color.r,
        color.g,
        color.b
      );

      data.vertices.push(
        point.x,
        point.y,
        point.z
      );

      data.colors.push(
        Math.round(
          color.r * 255
        ),

        Math.round(
          color.g * 255
        ),

        Math.round(
          color.b * 255
        )
      );
    }
  );

  data.indices.push(
    base,
    base + 1,
    base + 2,

    base,
    base + 2,
    base + 3
  );

  data.triangles.push([
    base,
    base + 1,
    base + 2
  ]);

  data.triangles.push([
    base,
    base + 2,
    base + 3
  ]);
}


function createColorLayerMesh(
  data,
  opacity,
  renderOrder
) {
  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      data.positions,
      3
    )
  );

  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(
      data.vertexColors,
      3
    )
  );

  geometry.setIndex(
    data.indices
  );

  const material =
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });

  const mesh =
    new THREE.Mesh(
      geometry,
      material
    );

  mesh.renderOrder =
    renderOrder;

  mesh.frustumCulled =
    false;

  return mesh;
}


function buildSlopeSteepnessLayer(
  state
) {
  const data = {
    positions: [],
    vertexColors: [],
    indices: [],
    vertices: [],
    colors: [],
    triangles: []
  };

  const lift =
    Math.max(
      0.05,
      Math.min(
        state.cellWidthM,
        state.cellDepthM
      ) * 0.06
    );


  for (
    let z = 0;
    z < state.resolution;
    z++
  ) {
    for (
      let x = 0;
      x < state.resolution;
      x++
    ) {
      const slope =
        getCellGradient(
          state,
          x,
          z
        );

      const normalized =
        clamp(
          slope.slopeDegrees /
          MAX_PROCEDURAL_SLOPE_DEGREES,
          0,
          1
        );

      const corners =
        getTerrainCellCorners(
          state,
          x,
          z
        );

      appendAnalysisQuad(
        data,
        corners.map(
          (point) =>
            new THREE.Vector3(
              point.x,
              point.y + lift,
              point.z
            )
        ),
        slopeColor(
          normalized
        )
      );
    }
  }

  return data;
}


function buildWatershedLayer(
  state
) {
  const data = {
    positions: [],
    vertexColors: [],
    indices: [],
    vertices: [],
    colors: [],
    triangles: []
  };

  const terminalToBasin =
    new Map();

  state.basinDefinitions.forEach(
    (basin, index) => {
      terminalToBasin.set(
        basin.sinkIndex,
        index
      );
    }
  );

  const lift =
    Math.max(
      0.06,
      Math.min(
        state.cellWidthM,
        state.cellDepthM
      ) * 0.08
    );


  for (
    let z = 0;
    z < state.resolution;
    z++
  ) {
    for (
      let x = 0;
      x < state.resolution;
      x++
    ) {
      const index =
        z *
        state.resolution +
        x;

      const terminal =
        state.flowTerminals[index];

      const watershedId =
        terminalToBasin.has(
          terminal
        )
          ? terminalToBasin.get(
              terminal
            )
          : -1;

      const corners =
        getTerrainCellCorners(
          state,
          x,
          z
        );

      appendAnalysisQuad(
        data,
        corners.map(
          (point) =>
            new THREE.Vector3(
              point.x,
              point.y + lift,
              point.z
            )
        ),
        watershedColor(
          watershedId
        )
      );
    }
  }

  return data;
}


function buildSlopeOrientationLayer(
  state
) {
  const arrows =
    [];

  const paths =
    [];

  const spacing =
    Math.max(
      3,
      Math.floor(
        state.resolution / 31
      )
    );

  const length =
    Math.max(
      state.cellWidthM,
      state.cellDepthM
    ) * 1.45;


  for (
    let z = 2;
    z < state.resolution - 2;
    z += spacing
  ) {
    for (
      let x = 2;
      x < state.resolution - 2;
      x += spacing
    ) {
      const slope =
        getCellGradient(
          state,
          x,
          z
        );

      const direction =
        new THREE.Vector3(
          slope.downhillX,
          0,
          slope.downhillZ
        );

      if (
        direction.lengthSq() <
        0.000001
      ) {
        continue;
      }

      direction.normalize();

      const corners =
        getTerrainCellCorners(
          state,
          x,
          z
        );

      const origin =
        new THREE.Vector3(
          (
            corners[0].x +
            corners[2].x
          ) / 2,

          (
            corners[0].y +
            corners[1].y +
            corners[2].y +
            corners[3].y
          ) / 4 +
          Math.max(
            0.8,
            Math.min(
              state.cellWidthM,
              state.cellDepthM
            ) * 0.25
          ),

          (
            corners[0].z +
            corners[2].z
          ) / 2
        );

      const arrow =
        new THREE.ArrowHelper(
          direction,
          origin,
          length,
          0xc7d49b,
          length * 0.27,
          length * 0.14
        );

      arrow.renderOrder =
        50;

      arrow.frustumCulled =
        false;

      [
        arrow.line,
        arrow.cone
      ].forEach(
        (part) => {
          if (
            part &&
            part.material
          ) {
            part.material.depthTest =
              false;

            part.material.depthWrite =
              false;

            part.material.transparent =
              true;

            part.material.opacity =
              0.92;
          }
        }
      );

      arrows.push(
        arrow
      );


      const end =
        origin.clone().add(
          direction.clone().multiplyScalar(
            length
          )
        );

      const side =
        new THREE.Vector3(
          -direction.z,
          0,
          direction.x
        );

      const headLength =
        length * 0.27;

      const headWidth =
        length * 0.14;

      const headBase =
        end.clone().sub(
          direction.clone().multiplyScalar(
            headLength
          )
        );

      const headA =
        headBase.clone().add(
          side.clone().multiplyScalar(
            headWidth
          )
        );

      const headB =
        headBase.clone().sub(
          side.clone().multiplyScalar(
            headWidth
          )
        );

      paths.push([
        origin,
        end
      ]);

      paths.push([
        end,
        headA
      ]);

      paths.push([
        end,
        headB
      ]);
    }
  }

  return {
    arrows,
    paths
  };
}


function watershedCornerKey(
  x,
  z
) {
  return `${x}:${z}`;
}


function buildWatershedLoopsFromCells(
  cells,
  state
) {
  const cellSet =
    new Set(
      cells
    );

  const edges =
    [];

  const addEdge =
    (a, b) => {
      edges.push({
        a,
        b
      });
    };


  cells.forEach(
    (index) => {
      const x =
        index %
        state.resolution;

      const z =
        Math.floor(
          index /
          state.resolution
        );

      const north =
        z > 0
          ? index - state.resolution
          : -1;

      const east =
        x < state.resolution - 1
          ? index + 1
          : -1;

      const south =
        z < state.resolution - 1
          ? index + state.resolution
          : -1;

      const west =
        x > 0
          ? index - 1
          : -1;


      if (!cellSet.has(north)) {
        addEdge(
          [x, z],
          [x + 1, z]
        );
      }

      if (!cellSet.has(east)) {
        addEdge(
          [x + 1, z],
          [x + 1, z + 1]
        );
      }

      if (!cellSet.has(south)) {
        addEdge(
          [x + 1, z + 1],
          [x, z + 1]
        );
      }

      if (!cellSet.has(west)) {
        addEdge(
          [x, z + 1],
          [x, z]
        );
      }
    }
  );


  const outgoing =
    new Map();

  edges.forEach(
    (edge) => {
      const key =
        watershedCornerKey(
          edge.a[0],
          edge.a[1]
        );

      if (!outgoing.has(key)) {
        outgoing.set(
          key,
          []
        );
      }

      outgoing.get(
        key
      ).push(
        edge
      );
    }
  );


  const unused =
    new Set(
      edges
    );

  const loops =
    [];


  while (unused.size > 0) {
    const first =
      unused.values().next().value;

    if (!first) {
      break;
    }

    const loop =
      [];

    const start =
      watershedCornerKey(
        first.a[0],
        first.a[1]
      );

    let current =
      first;

    let safety =
      0;

    while (
      current &&
      unused.has(current) &&
      safety < edges.length + 10
    ) {
      safety++;

      unused.delete(
        current
      );

      loop.push(
        current.a
      );

      const nextKey =
        watershedCornerKey(
          current.b[0],
          current.b[1]
        );

      if (nextKey === start) {
        break;
      }

      const nextEdges =
        outgoing.get(
          nextKey
        ) || [];

      current =
        nextEdges.find(
          (edge) =>
            unused.has(edge)
        ) || null;
    }

    if (loop.length >= 3) {
      loops.push(
        loop
      );
    }
  }

  return loops;
}


function smoothWatershedLoop(
  points
) {
  let current =
    points.map(
      (point) =>
        point.clone()
    );


  for (
    let pass = 0;
    pass < 3;
    pass++
  ) {
    const next =
      [];

    for (
      let index = 0;
      index < current.length;
      index++
    ) {
      const previous =
        current[
          (
            index -
            1 +
            current.length
          ) %
          current.length
        ];

      const point =
        current[index];

      const following =
        current[
          (
            index + 1
          ) %
          current.length
        ];

      next.push(
        new THREE.Vector3()
          .addScaledVector(
            previous,
            0.2
          )
          .addScaledVector(
            point,
            0.6
          )
          .addScaledVector(
            following,
            0.2
          )
      );
    }

    current =
      next;
  }


  const curve =
    new THREE.CatmullRomCurve3(
      current,
      true,
      "centripetal",
      0.35
    );

  return curve.getPoints(
    Math.max(
      36,
      current.length * 4
    )
  );
}


function buildWatershedBoundaryLines(
  state
) {
  const group =
    new THREE.Group();

  const used =
    new Set();

  const lift =
    Math.max(
      0.18,
      Math.min(
        state.cellWidthM,
        state.cellDepthM
      ) * 0.18
    );


  state.basinDefinitions.forEach(
    (basin) => {
      const loops =
        buildWatershedLoopsFromCells(
          basin.catchmentCells,
          state
        );

      loops.forEach(
        (loop) => {
          const points =
            loop.map(
              (corner) =>
                new THREE.Vector3(
                  corner[0] *
                    state.cellWidthM -
                    state.widthM / 2,

                  getTerrainCornerHeight(
                    state,
                    corner[0],
                    corner[1]
                  ) + lift,

                  corner[1] *
                    state.cellDepthM -
                    state.depthM / 2
                )
            );

          const key =
            points
              .map(
                (point) =>
                  `${Math.round(
                    point.x
                  )}:${
                    Math.round(
                      point.z
                    )
                  }`
              )
              .sort()
              .join("|");

          if (used.has(key)) {
            return;
          }

          used.add(key);

          const smooth =
            smoothWatershedLoop(
              points
            );

          const line =
            createWideLine(
              smooth,
              0xe3d6eb,
              2.2,
              0.9,
              true,
              70
            );

          if (line) {
            group.add(
              line
            );
          }
        }
      );
    }
  );

  return group;
}


function buildAnalysisLayers() {
  clearGroup(
    orientationGroup
  );

  clearGroup(
    steepnessGroup
  );

  clearGroup(
    watershedGroup
  );


  const orientation =
    buildSlopeOrientationLayer(
      terrainState
    );

  orientation.arrows.forEach(
    (arrow) => {
      orientationGroup.add(
        arrow
      );
    }
  );

  terrainState.slopeOrientationPaths =
    orientation.paths;


  const steepnessData =
    buildSlopeSteepnessLayer(
      terrainState
    );

  terrainState.slopeSteepnessExport =
    steepnessData;

  steepnessGroup.add(
    createColorLayerMesh(
      steepnessData,
      0.64,
      40
    )
  );


  const watershedData =
    buildWatershedLayer(
      terrainState
    );

  terrainState.watershedExport =
    watershedData;

  watershedGroup.add(
    createColorLayerMesh(
      watershedData,
      0.3,
      35
    )
  );

  watershedGroup.add(
    buildWatershedBoundaryLines(
      terrainState
    )
  );

  updateAnalysisVisibility();
}


function updateAnalysisVisibility() {
  if (!terrainState) {
    return;
  }

  orientationGroup.visible =
    $("showSlopeOrientation")
      ? $("showSlopeOrientation").checked
      : false;

  steepnessGroup.visible =
    $("showSlopeSteepness")
      ? $("showSlopeSteepness").checked
      : false;

  watershedGroup.visible =
    $("showWatersheds")
      ? $("showWatersheds").checked
      : false;

  updateSteepnessLegend();
}


/* =========================================================
   FLOWLINE SAFETY
========================================================= */

function buildFlowBlockedCells(
  state
) {
  const blocked =
    new Set();

  /*
   * Only block the sink and its immediate
   * neighbourhood. The previous version
   * blocked every cell in every basin,
   * which could remove almost all possible
   * flowline starting points.
   */
  state.basinDefinitions.forEach(
    (basin) => {
      const sinkIndex =
        basin.sinkIndex;

      const sinkX =
        sinkIndex %
        state.resolution;

      const sinkZ =
        Math.floor(
          sinkIndex /
          state.resolution
        );

      for (
        let dz = -1;
        dz <= 1;
        dz++
      ) {
        for (
          let dx = -1;
          dx <= 1;
          dx++
        ) {
          const x =
            sinkX + dx;

          const z =
            sinkZ + dz;

          if (
            x < 0 ||
            x >= state.resolution ||
            z < 0 ||
            z >= state.resolution
          ) {
            continue;
          }

          blocked.add(
            `${x}:${z}`
          );
        }
      }
    }
  );

  return blocked;
}


function flowPointBlocked(
  x,
  z
) {
  const state =
    terrainState;

  const cellX =
    Math.floor(
      (
        x +
        state.widthM / 2
      ) /
      state.cellWidthM
    );

  const cellZ =
    Math.floor(
      (
        z +
        state.depthM / 2
      ) /
      state.cellDepthM
    );

  if (
    cellX < 0 ||
    cellX >= state.resolution ||
    cellZ < 0 ||
    cellZ >= state.resolution
  ) {
    return true;
  }

  return state.flowBlockedCells.has(
    `${cellX}:${cellZ}`
  );
}


function distancePointToSegmentXZ(
  point,
  a,
  b
) {
  const abX =
    b.x - a.x;

  const abZ =
    b.z - a.z;

  const lengthSquared =
    abX * abX +
    abZ * abZ;

  if (
    lengthSquared <=
    0.000001
  ) {
    return Math.hypot(
      point.x - a.x,
      point.z - a.z
    );
  }

  const amount =
    clamp(
      (
        (
          point.x - a.x
        ) *
        abX +

        (
          point.z - a.z
        ) *
        abZ
      ) /
      lengthSquared,

      0,
      1
    );

  const closestX =
    a.x +
    abX * amount;

  const closestZ =
    a.z +
    abZ * amount;

  return Math.hypot(
    point.x - closestX,
    point.z - closestZ
  );
}


function cross2D(
  a,
  b,
  c
) {
  return (
    b.x - a.x
  ) *
  (
    c.z - a.z
  ) -
  (
    b.z - a.z
  ) *
  (
    c.x - a.x
  );
}


function pointOnSegment2D(
  point,
  a,
  b
) {
  return (
    point.x >=
      Math.min(
        a.x,
        b.x
      ) - 0.0001 &&

    point.x <=
      Math.max(
        a.x,
        b.x
      ) + 0.0001 &&

    point.z >=
      Math.min(
        a.z,
        b.z
      ) - 0.0001 &&

    point.z <=
      Math.max(
        a.z,
        b.z
      ) + 0.0001
  );
}


function segmentsIntersect2D(
  a,
  b,
  c,
  d
) {
  const abC =
    cross2D(
      a,
      b,
      c
    );

  const abD =
    cross2D(
      a,
      b,
      d
    );

  const cdA =
    cross2D(
      c,
      d,
      a
    );

  const cdB =
    cross2D(
      c,
      d,
      b
    );

  const epsilon =
    0.000001;


  if (
    Math.abs(abC) < epsilon &&
    pointOnSegment2D(
      c,
      a,
      b
    )
  ) {
    return true;
  }

  if (
    Math.abs(abD) < epsilon &&
    pointOnSegment2D(
      d,
      a,
      b
    )
  ) {
    return true;
  }

  if (
    Math.abs(cdA) < epsilon &&
    pointOnSegment2D(
      a,
      c,
      d
    )
  ) {
    return true;
  }

  if (
    Math.abs(cdB) < epsilon &&
    pointOnSegment2D(
      b,
      c,
      d
    )
  ) {
    return true;
  }

  const abOpposite =
    (
      abC > epsilon &&
      abD < -epsilon
    ) ||
    (
      abC < -epsilon &&
      abD > epsilon
    );

  const cdOpposite =
    (
      cdA > epsilon &&
      cdB < -epsilon
    ) ||
    (
      cdA < -epsilon &&
      cdB > epsilon
    );

  return (
    abOpposite &&
    cdOpposite
  );
}


function wouldRevisitOldFlowPath(
  points,
  nextPoint,
  minimumSeparation
) {
  if (points.length < 6) {
    return false;
  }

  const last =
    points[
      points.length - 1
    ];

  const lastCheckedSegment =
    points.length - 5;


  for (
    let index = 0;
    index < lastCheckedSegment;
    index++
  ) {
    const a =
      points[index];

    const b =
      points[index + 1];


    if (
      segmentsIntersect2D(
        last,
        nextPoint,
        a,
        b
      )
    ) {
      return true;
    }


    const distance =
      distancePointToSegmentXZ(
        nextPoint,
        a,
        b
      );

    if (
      distance < minimumSeparation
    ) {
      return true;
    }
  }

  return false;
}


function truncateFlowPathAtLoop(
  points,
  separationRatio = 0.32
) {
  if (
    !terrainState ||
    points.length < 6
  ) {
    return points;
  }

  const separation =
    Math.min(
      terrainState.cellWidthM,
      terrainState.cellDepthM
    ) *
    separationRatio;

  const safePoints =
    [
      points[0].clone()
    ];


  for (
    let index = 1;
    index < points.length;
    index++
  ) {
    const nextPoint =
      points[index];

    if (
      wouldRevisitOldFlowPath(
        safePoints,
        nextPoint,
        separation
      )
    ) {
      break;
    }

    safePoints.push(
      nextPoint.clone()
    );
  }

  return safePoints;
}


/* =========================================================
   FLOWLINE INTEGRATION
========================================================= */

function sampleTerrainContinuous(
  x,
  z
) {
  const state =
    terrainState;

  const gridX =
    (
      x +
      state.widthM / 2
    ) /
    state.cellWidthM -
    0.5;

  const gridZ =
    (
      z +
      state.depthM / 2
    ) /
    state.cellDepthM -
    0.5;

  if (
    gridX < 0 ||
    gridZ < 0 ||
    gridX >
      state.resolution - 1 ||
    gridZ >
      state.resolution - 1
  ) {
    return null;
  }


  const sampleGrid =
    (sampleX, sampleZ) => {
      const safeX =
        clamp(
          sampleX,
          0,
          state.resolution - 1
        );

      const safeZ =
        clamp(
          sampleZ,
          0,
          state.resolution - 1
        );

      const x0 =
        Math.floor(
          safeX
        );

      const z0 =
        Math.floor(
          safeZ
        );

      const x1 =
        Math.min(
          x0 + 1,
          state.resolution - 1
        );

      const z1 =
        Math.min(
          z0 + 1,
          state.resolution - 1
        );

      const fx =
        safeX - x0;

      const fz =
        safeZ - z0;

      const h00 =
        state.heights[
          z0 *
          state.resolution +
          x0
        ];

      const h10 =
        state.heights[
          z0 *
          state.resolution +
          x1
        ];

      const h01 =
        state.heights[
          z1 *
          state.resolution +
          x0
        ];

      const h11 =
        state.heights[
          z1 *
          state.resolution +
          x1
        ];

      return (
        h00 * (1 - fx) * (1 - fz) +
        h10 * fx * (1 - fz) +
        h01 * (1 - fx) * fz +
        h11 * fx * fz
      );
    };


  const height =
    sampleGrid(
      gridX,
      gridZ
    );

  const sampleDistance =
    0.45;

  const gradientX =
    (
      sampleGrid(
        gridX + sampleDistance,
        gridZ
      ) -
      sampleGrid(
        gridX - sampleDistance,
        gridZ
      )
    ) /
    (
      2 *
      sampleDistance *
      state.cellWidthM
    );

  const gradientZ =
    (
      sampleGrid(
        gridX,
        gridZ + sampleDistance
      ) -
      sampleGrid(
        gridX,
        gridZ - sampleDistance
      )
    ) /
    (
      2 *
      sampleDistance *
      state.cellDepthM
    );

  return {
    height,
    gradientX,
    gradientZ
  };
}


function integrateFlowPath(
  startX,
  startZ
) {
  const state =
    terrainState;

  if (
    flowPointBlocked(
      startX,
      startZ
    )
  ) {
    return [];
  }

  const points =
    [];

  /*
   * The old implementation stopped when the
   * path revisited the same raster cell.
   * Because the integration step is smaller
   * than one cell, that stopped every path
   * after roughly one step.
   *
   * We now allow several sub-cell samples and
   * stop only when a cell is occupied for too
   * long, while the geometric loop detector
   * still prevents actual loops.
   */
  const visitedCells =
    new Map();

  const direction =
    new THREE.Vector2();

  let x =
    startX;

  let z =
    startZ;

  let pathLength =
    0;

  const stepLength =
    Math.min(
      state.cellWidthM,
      state.cellDepthM
    ) * 0.30;

  const verticalLift =
    Math.max(
      1.4,
      Math.min(
        state.cellWidthM,
        state.cellDepthM
      ) * 0.12
    );

  const maximumSteps =
    Math.min(
      3000,
      state.resolution * 18
    );

  const maximumDirectionTurn =
    degreesToRadians(
      105
    );

  const minimumSeparation =
    Math.min(
      state.cellWidthM,
      state.cellDepthM
    ) * 0.38;


  for (
    let iteration = 0;
    iteration < maximumSteps;
    iteration++
  ) {
    const sample =
      sampleTerrainContinuous(
        x,
        z
      );

    if (
      !sample ||
      flowPointBlocked(
        x,
        z
      )
    ) {
      break;
    }


    const cellX =
      Math.floor(
        (
          x +
          state.widthM / 2
        ) /
        state.cellWidthM
      );

    const cellZ =
      Math.floor(
        (
          z +
          state.depthM / 2
        ) /
        state.cellDepthM
      );

    const cellKey =
      `${cellX}:${cellZ}`;

    const cellVisits =
      visitedCells.get(
        cellKey
      ) || 0;

    if (
      cellVisits >= 12
    ) {
      break;
    }

    visitedCells.set(
      cellKey,
      cellVisits + 1
    );


    points.push(
      new THREE.Vector3(
        x,
        sample.height +
        verticalLift,
        z
      )
    );


    const downhill =
      new THREE.Vector2(
        -sample.gradientX,
        -sample.gradientZ
      );


    if (
      downhill.lengthSq() >
      0.000000001
    ) {
      downhill.normalize();

      if (
        direction.lengthSq() ===
        0
      ) {
        direction.copy(
          downhill
        );
      } else {
        const turn =
          direction.angleTo(
            downhill
          );

        if (
          turn >
          maximumDirectionTurn
        ) {
          break;
        }

        direction.lerp(
          downhill,
          0.16
        );

        direction.normalize();
      }
    }


    if (
      direction.lengthSq() ===
      0
    ) {
      break;
    }


    const nextX =
      x +
      direction.x *
      stepLength;

    const nextZ =
      z +
      direction.y *
      stepLength;


    if (
      nextX <
        -state.widthM / 2 ||
      nextX >
        state.widthM / 2 ||
      nextZ <
        -state.depthM / 2 ||
      nextZ >
        state.depthM / 2
    ) {
      break;
    }


    if (
      flowPointBlocked(
        nextX,
        nextZ
      )
    ) {
      break;
    }


    const nextSample =
      sampleTerrainContinuous(
        nextX,
        nextZ
      );

    if (!nextSample) {
      break;
    }


    const maximumAllowedRise =
      Math.max(
        0.025,
        stepLength * 0.015
      );

    if (
      nextSample.height >
      sample.height +
      maximumAllowedRise
    ) {
      break;
    }


    const nextPoint =
      new THREE.Vector3(
        nextX,
        nextSample.height +
        verticalLift,
        nextZ
      );


    if (
      wouldRevisitOldFlowPath(
        points,
        nextPoint,
        minimumSeparation
      )
    ) {
      break;
    }


    x =
      nextX;

    z =
      nextZ;

    pathLength +=
      stepLength;
  }


  if (
    pathLength <
    Math.min(
      state.widthM,
      state.depthM
    ) * 0.035
  ) {
    return [];
  }


  return truncateFlowPathAtLoop(
    points,
    0.32
  );
}


function smoothFlowPath(
  points
) {
  if (points.length < 3) {
    return points;
  }

  let current =
    truncateFlowPathAtLoop(
      points,
      0.32
    );


  for (
    let pass = 0;
    pass < 2;
    pass++
  ) {
    const next =
      [
        current[0].clone()
      ];

    for (
      let index = 0;
      index < current.length - 1;
      index++
    ) {
      const a =
        current[index];

      const b =
        current[index + 1];

      const q =
        new THREE.Vector3()
          .lerpVectors(
            a,
            b,
            0.22
          );

      const r =
        new THREE.Vector3()
          .lerpVectors(
            a,
            b,
            0.78
          );

      next.push(
        q,
        r
      );
    }

    next.push(
      current[
        current.length - 1
      ].clone()
    );

    current =
      truncateFlowPathAtLoop(
        next,
        0.22
      );
  }

  return current;
}


function clearFlowVisualization() {
  clearGroup(
    flowGroup
  );

  flowExportPaths =
    [];
}


function rebuildFlowVisualization() {
  clearFlowVisualization();

  if (!terrainState) {
    return;
  }

  const random =
    mulberry32(
      flowSeed
    );

  const candidates =
    [];

  const seen =
    new Set();

  const maximumPaths =
    110;

  const spacing =
    Math.max(
      4,
      Math.floor(
        terrainState.resolution / 12
      )
    );


  const addCandidate =
    (startX, startZ) => {
      const path =
        integrateFlowPath(
          startX,
          startZ
        );

      if (path.length < 10) {
        return;
      }

      const first =
        path[0];

      const last =
        path[
          path.length - 1
        ];

      const key =
        `${Math.round(first.x)}:` +
        `${Math.round(first.z)}:` +
        `${Math.round(last.x)}:` +
        `${Math.round(last.z)}`;

      if (seen.has(key)) {
        return;
      }

      seen.add(key);

      candidates.push({
        path,

        score:
          path.length +
          random() * 80
      });
    };


  for (
    let z = 2;
    z < terrainState.resolution - 2;
    z += spacing
  ) {
    for (
      let x = 2;
      x < terrainState.resolution - 2;
      x += spacing
    ) {
      addCandidate(
        (
          x + 0.5
        ) *
        terrainState.cellWidthM -
        terrainState.widthM / 2 +
        (
          random() - 0.5
        ) *
        terrainState.cellWidthM *
        2.5,

        (
          z + 0.5
        ) *
        terrainState.cellDepthM -
        terrainState.depthM / 2 +
        (
          random() - 0.5
        ) *
        terrainState.cellDepthM *
        2.5
      );
    }
  }


  let attempts =
    0;

  while (
    candidates.length <
      maximumPaths &&
    attempts <
      maximumPaths * 55
  ) {
    attempts++;

    addCandidate(
      (
        random() - 0.5
      ) *
      terrainState.widthM *
      0.96,

      (
        random() - 0.5
      ) *
      terrainState.depthM *
      0.96
    );
  }


  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );


  candidates
    .slice(
      0,
      maximumPaths
    )
    .forEach(
      (candidate) => {
        const safePath =
          truncateFlowPathAtLoop(
            candidate.path,
            0.32
          );

        const smooth =
          smoothFlowPath(
            safePath
          );

        const finalPath =
          truncateFlowPathAtLoop(
            smooth,
            0.20
          );

        if (
          finalPath.length < 8
        ) {
          return;
        }

        const line =
          createWideLine(
            finalPath,
            0x9bd1e5,
            2.7,
            0.94,
            false,
            80
          );

        if (line) {
          flowGroup.add(
            line
          );
        }

        flowExportPaths.push(
          finalPath.map(
            (point) =>
              point.clone()
          )
        );
      }
    );

  updateFlowVisibility();
}


function updateFlowVisibility() {
  if (!flowGroup) {
    return;
  }

  flowGroup.visible =
    $("showFlow")
      ? $("showFlow").checked
      : true;
}


/* =========================================================
   DESIGN COMPARISON
========================================================= */

function createDesignSnapshot(
  name,
  result
) {
  return {
    name,

    terrainName:
      result.terrainName,

    rainfallLPerM2:
      result.rainfallLPerM2,

    terrainAreaM2:
      result.terrainAreaM2,

    totalRainfallM3:
      result.totalRainfallM3,

    totalRainfallL:
      result.totalRainfallL,

    retainedVolumeM3:
      result.retainedVolumeM3,

    retainedVolumeL:
      result.retainedVolumeL,

    runoffVolumeM3:
      result.runoffVolumeM3,

    runoffVolumeL:
      result.runoffVolumeL,

    retentionPercent:
      result.retentionPercent,

    basins:
      result.basins.map(
        (basin) => ({
          basinIndex:
            basin.basinIndex,

          retainedVolumeM3:
            basin.retainedVolumeM3,

          retainedVolumeL:
            basin.retainedVolumeL,

          inflowVolumeM3:
            basin.inflowVolumeM3,

          spillVolumeM3:
            basin.spillVolumeM3,

          spillVolumeL:
            basin.spillVolumeL,

          areaM2:
            basin.areaM2,

          maximumDepthM:
            basin.maximumDepthM,

          waterLevel:
            basin.waterLevel,

          x:
            basin.x,

          y:
            basin.y,

          z:
            basin.z
        })
      )
  };
}


function storeCurrentDesign() {
  if (
    !currentResult
  ) {
    return;
  }

  const input =
    $("designName");

  const name =
    input &&
    input.value.trim()
      ? input.value.trim()
      : `Design ${String(
          storedDesigns.length + 1
        ).padStart(
          2,
          "0"
        )}`;

  storedDesigns.push(
    createDesignSnapshot(
      name,
      currentResult
    )
  );

  renderDesignComparison();

  setStatus(
    "DESIGN STORED"
  );
}


function renderDesignComparison() {
  const container =
    $("designComparisonTable");

  if (!container) {
    return;
  }

  container.innerHTML =
    "";

  if (
    storedDesigns.length === 0
  ) {
    container.innerHTML =
      `
        <div class="empty-comparison">
          No designs stored.
        </div>
      `;

    return;
  }

  const table =
    document.createElement(
      "table"
    );

  table.className =
    "comparison-table";

  table.innerHTML =
    `
      <thead>
        <tr>
          <th>DESIGN</th>
          <th>RETAINED</th>
          <th>RUNOFF</th>
        </tr>
      </thead>

      <tbody></tbody>
    `;

  const body =
    table.querySelector(
      "tbody"
    );


  storedDesigns.forEach(
    (design) => {
      const row =
        document.createElement(
          "tr"
        );

      row.innerHTML =
        `
          <td>
            <strong>
              ${escapeHtml(
                design.name
              )}
            </strong>
            <br>
            ${escapeHtml(
              design.terrainName
            )}
          </td>

          <td>
            ${formatVolume(
              design.retainedVolumeM3
            )}
            <br>
            ${formatNumber(
              design.retentionPercent,
              1
            )} %
          </td>

          <td>
            ${formatVolume(
              design.runoffVolumeM3
            )}
          </td>
        `;

      body.appendChild(
        row
      );
    }
  );

  container.appendChild(
    table
  );
}


/* =========================================================
   SERIALISERS
========================================================= */

function serializePly(
  mesh
) {
  const lines =
    [
      "ply",
      "format ascii 1.0",
      `element vertex ${mesh.vertices.length / 3}`,
      "property float x",
      "property float y",
      "property float z",
      `element face ${mesh.triangles.length}`,
      "property list uchar int vertex_indices",
      "end_header"
    ];


  for (
    let index = 0;
    index < mesh.vertices.length;
    index += 3
  ) {
    lines.push(
      [
        mesh.vertices[index],
        mesh.vertices[index + 1],
        mesh.vertices[index + 2]
      ].join(" ")
    );
  }


  mesh.triangles.forEach(
    (triangle) => {
      lines.push(
        `3 ${triangle[0]} ${triangle[1]} ${triangle[2]}`
      );
    }
  );

  return lines.join(
    "\n"
  );
}


function serializeColoredPly(
  mesh
) {
  const lines =
    [
      "ply",
      "format ascii 1.0",
      `element vertex ${mesh.vertices.length / 3}`,
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      `element face ${mesh.triangles.length}`,
      "property list uchar int vertex_indices",
      "end_header"
    ];


  for (
    let index = 0;
    index < mesh.vertices.length / 3;
    index++
  ) {
    lines.push(
      [
        mesh.vertices[index * 3],
        mesh.vertices[index * 3 + 1],
        mesh.vertices[index * 3 + 2],
        mesh.colors[index * 3],
        mesh.colors[index * 3 + 1],
        mesh.colors[index * 3 + 2]
      ].join(" ")
    );
  }


  mesh.triangles.forEach(
    (triangle) => {
      lines.push(
        `3 ${triangle[0]} ${triangle[1]} ${triangle[2]}`
      );
    }
  );

  return lines.join(
    "\n"
  );
}


function serializeStl(
  mesh
) {
  const triangleCount =
    mesh.triangles.length;

  const buffer =
    new ArrayBuffer(
      84 +
      triangleCount * 50
    );

  const view =
    new DataView(
      buffer
    );

  const header =
    "Binary STL retained water";


  for (
    let index = 0;
    index < 80;
    index++
  ) {
    view.setUint8(
      index,
      index < header.length
        ? header.charCodeAt(index)
        : 0
    );
  }

  view.setUint32(
    80,
    triangleCount,
    true
  );


  const readVertex =
    (index) => {
      return new THREE.Vector3(
        mesh.vertices[index * 3],
        mesh.vertices[index * 3 + 1],
        mesh.vertices[index * 3 + 2]
      );
    };


  let offset =
    84;


  mesh.triangles.forEach(
    (triangle) => {
      const a =
        readVertex(
          triangle[0]
        );

      const b =
        readVertex(
          triangle[1]
        );

      const c =
        readVertex(
          triangle[2]
        );

      const normal =
        new THREE.Vector3()
          .subVectors(
            b,
            a
          )
          .cross(
            new THREE.Vector3()
              .subVectors(
                c,
                a
              )
          );

      if (
        normal.lengthSq() >
        0.0000001
      ) {
        normal.normalize();
      } else {
        normal.set(
          0,
          1,
          0
        );
      }


      view.setFloat32(
        offset,
        normal.x,
        true
      );

      offset += 4;

      view.setFloat32(
        offset,
        normal.y,
        true
      );

      offset += 4;

      view.setFloat32(
        offset,
        normal.z,
        true
      );

      offset += 4;


      [
        a,
        b,
        c
      ].forEach(
        (vertex) => {
          view.setFloat32(
            offset,
            vertex.x,
            true
          );

          offset += 4;

          view.setFloat32(
            offset,
            vertex.y,
            true
          );

          offset += 4;

          view.setFloat32(
            offset,
            vertex.z,
            true
          );

          offset += 4;
        }
      );

      view.setUint16(
        offset,
        0,
        true
      );

      offset += 2;
    }
  );

  return buffer;
}


function downloadBlob(
  data,
  filename,
  mimeType
) {
  const blob =
    data instanceof Blob
      ? data
      : new Blob(
          [data],
          {
            type:
              mimeType
          }
        );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      "a"
    );

  link.href =
    url;

  link.download =
    filename;

  link.style.display =
    "none";

  document.body.appendChild(
    link
  );

  link.click();

  window.setTimeout(
    () => {
      link.remove();

      URL.revokeObjectURL(
        url
      );
    },
    1500
  );
}


function terrainFilenameSlug() {
  return currentTerrainName
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-|-$/g,
      ""
    ) ||
    "terrain";
}


/* =========================================================
   EXPORTS
========================================================= */

function downloadWaterVolume(
  format
) {
  if (
    !currentResult ||
    currentResult.retainedVolumeM3 <=
      0.000001
  ) {
    alert(
      "There is currently no retained water to export."
    );

    return;
  }

  const mesh =
    buildVoxelWaterVolumeMesh(
      currentResult
    );

  const isPly =
    format === "ply";

  const extension =
    isPly
      ? "ply"
      : "stl";

  const data =
    isPly
      ? serializePly(mesh)
      : serializeStl(mesh);

  downloadBlob(
    data,
    `${terrainFilenameSlug()}-retained-water.${extension}`,
    isPly
      ? "application/octet-stream"
      : "model/stl"
  );

  setStatus(
    `${extension.toUpperCase()} DOWNLOADED`
  );
}


function serializeFlowLinesObj(
  paths
) {
  const lines =
    [
      "# Rainwater retention line export",
      "# Coordinates are physical model units"
    ];

  let vertexIndex =
    1;


  paths.forEach(
    (path, pathIndex) => {
      if (path.length < 2) {
        return;
      }

      lines.push(
        `o line_${String(
          pathIndex + 1
        ).padStart(
          3,
          "0"
        )}`
      );

      path.forEach(
        (point) => {
          lines.push(
            `v ${point.x} ${point.y} ${point.z}`
          );
        }
      );

      const indices =
        path.map(
          (_, index) =>
            vertexIndex + index
        );

      lines.push(
        `l ${indices.join(" ")}`
      );

      vertexIndex +=
        path.length;
    }
  );

  return lines.join(
    "\n"
  );
}


function downloadFlowLinesObj() {
  if (
    flowExportPaths.length ===
    0
  ) {
    alert(
      "There are currently no flow lines to export."
    );

    return;
  }

  downloadBlob(
    serializeFlowLinesObj(
      flowExportPaths
    ),
    `${terrainFilenameSlug()}-flow-lines.obj`,
    "text/plain"
  );

  setStatus(
    "FLOW OBJ DOWNLOADED"
  );
}


function downloadSlopeOrientation() {
  if (
    !terrainState ||
    !terrainState.slopeOrientationPaths
  ) {
    return;
  }

  downloadBlob(
    serializeFlowLinesObj(
      terrainState.slopeOrientationPaths
    ),
    `${terrainFilenameSlug()}-slope-orientation.obj`,
    "text/plain"
  );

  setStatus(
    "SLOPE ORIENTATION DOWNLOADED"
  );
}


function downloadSlopeSteepness() {
  if (
    !terrainState ||
    !terrainState.slopeSteepnessExport
  ) {
    return;
  }

  downloadBlob(
    serializeColoredPly(
      terrainState.slopeSteepnessExport
    ),
    `${terrainFilenameSlug()}-slope-steepness.ply`,
    "application/octet-stream"
  );

  setStatus(
    "SLOPE STEEPNESS DOWNLOADED"
  );
}


function downloadWatersheds() {
  if (
    !terrainState ||
    !terrainState.watershedExport
  ) {
    return;
  }

  downloadBlob(
    serializeColoredPly(
      terrainState.watershedExport
    ),
    `${terrainFilenameSlug()}-watersheds.ply`,
    "application/octet-stream"
  );

  setStatus(
    "WATERSHEDS DOWNLOADED"
  );
}


function downloadViewerPng() {
  renderer.render(
    scene,
    camera
  );

  renderer.domElement.toBlob(
    (blob) => {
      if (!blob) {
        return;
      }

      downloadBlob(
        blob,
        "rainwater-retention-viewer.png",
        "image/png"
      );

      setStatus(
        "PNG DOWNLOADED"
      );
    },
    "image/png"
  );
}


function downloadRetentionCsv() {
  if (
    !currentResult
  ) {
    return;
  }

  const input =
    $("designName");

  const currentName =
    input &&
    input.value.trim()
      ? input.value.trim()
      : "CURRENT DESIGN";

  const designs =
    [
      ...storedDesigns,

      createDesignSnapshot(
        currentName,
        currentResult
      )
    ];

  const rows =
    [
      [
        "record_type",
        "design",
        "topography",
        "rainfall_L_per_m2",
        "projected_area_m2",
        "total_rainfall_m3",
        "retained_volume_m3",
        "runoff_volume_m3",
        "retention_percent",
        "basin_index",
        "basin_area_m2",
        "basin_water_level_m",
        "basin_retained_m3",
        "basin_spill_m3"
      ]
    ];


  designs.forEach(
    (design) => {
      rows.push([
        "summary",
        design.name,
        design.terrainName,
        design.rainfallLPerM2,
        design.terrainAreaM2,
        design.totalRainfallM3,
        design.retainedVolumeM3,
        design.runoffVolumeM3,
        design.retentionPercent,
        "",
        "",
        "",
        "",
        ""
      ]);


      design.basins.forEach(
        (basin) => {
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
            basin.basinIndex,
            basin.areaM2,
            basin.waterLevel,
            basin.retainedVolumeM3,
            basin.spillVolumeM3
          ]);
        }
      );
    }
  );


  const csv =
    rows
      .map(
        (row) =>
          row
            .map(
              csvEscape
            )
            .join(",")
      )
      .join("\n");

  downloadBlob(
    csv,
    "rainwater-retention.csv",
    "text/csv;charset=utf-8"
  );

  setStatus(
    "CSV DOWNLOADED"
  );
}


/* =========================================================
   MODEL FILE LOADING
========================================================= */

function collectTrianglesFromObject(
  root
) {
  const triangles =
    [];

  root.updateMatrixWorld(
    true
  );


  root.traverse(
    (child) => {
      if (
        !child.isMesh ||
        !child.geometry ||
        !child.geometry.attributes ||
        !child.geometry.attributes.position
      ) {
        return;
      }

      const geometry =
        child.geometry;

      const position =
        geometry.attributes.position;

      const index =
        geometry.index;

      const matrixWorld =
        child.matrixWorld;


      const readVertex =
        (vertexIndex) => {
          const vector =
            new THREE.Vector3();

          vector.fromBufferAttribute(
            position,
            vertexIndex
          );

          vector.applyMatrix4(
            matrixWorld
          );

          return [
            vector.x,
            vector.y,
            vector.z
          ];
        };


      if (index) {
        for (
          let i = 0;
          i + 2 < index.count;
          i += 3
        ) {
          triangles.push([
            readVertex(
              index.getX(i)
            ),

            readVertex(
              index.getX(i + 1)
            ),

            readVertex(
              index.getX(i + 2)
            )
          ]);
        }
      } else {
        for (
          let i = 0;
          i + 2 < position.count;
          i += 3
        ) {
          triangles.push([
            readVertex(i),
            readVertex(i + 1),
            readVertex(i + 2)
          ]);
        }
      }
    }
  );

  return triangles;
}


function getFileExtension(
  filename
) {
  return filename
    .toLowerCase()
    .split(".")
    .pop();
}


function isPrimaryTerrainExtension(
  extension
) {
  return [
    "ply",
    "stl",
    "obj",
    "tif",
    "tiff",
    "xyz",
    "txt",
    "asc"
  ].includes(
    extension
  );
}


function findWorldFile(
  primaryFile,
  companionFiles
) {
  const baseName =
    primaryFile.name
      .replace(
        /\.[^/.]+$/,
        ""
      )
      .toLowerCase();

  return companionFiles.find(
    (file) => {
      const extension =
        getFileExtension(
          file.name
        );

      const fileBaseName =
        file.name
          .replace(
            /\.[^/.]+$/,
            ""
          )
          .toLowerCase();

      return (
        extension === "tfw" &&
        fileBaseName === baseName
      );
    }
  ) || null;
}


async function loadTerrainFiles(
  files
) {
  const primaryFile =
    files.find(
      (file) =>
        isPrimaryTerrainExtension(
          getFileExtension(
            file.name
          )
        )
    );

  if (!primaryFile) {
    alert(
      "Please upload a PLY, STL, OBJ, GeoTIFF, XYZ or ESRI ASCII Grid file."
    );

    return;
  }

  await loadModelFile(
    primaryFile,
    files
  );
}


async function loadModelFile(
  file,
  companionFiles = []
) {
  const extension =
    getFileExtension(
      file.name
    );

  try {
    setStatus(
      "LOADING TERRAIN"
    );


    if (
      extension === "tif" ||
      extension === "tiff"
    ) {
      rawRasterTerrain =
        await loadGeoTiffRaster(
          file,
          findWorldFile(
            file,
            companionFiles
          )
        );

      rawTriangles =
        null;

      proceduralSeed =
        null;

      currentTerrainName =
        file.name.replace(
          /\.[^/.]+$/,
          ""
        );

      if ($("designName")) {
        $("designName").value =
          currentTerrainName;
      }

      buildImportedRasterTerrain();

      setStatus(
        "READY"
      );

      return;
    }


    if (
      extension === "xyz"
    ) {
      rawRasterTerrain =
        parseXYZRaster(
          await file.text()
        );

      rawTriangles =
        null;

      proceduralSeed =
        null;

      currentTerrainName =
        file.name.replace(
          /\.[^/.]+$/,
          ""
        );

      if ($("designName")) {
        $("designName").value =
          currentTerrainName;
      }

      buildImportedRasterTerrain();

      setStatus(
        "READY"
      );

      return;
    }


    if (
      extension === "asc"
    ) {
      rawRasterTerrain =
        parseEsriAsciiGrid(
          await file.text()
        );

      rawTriangles =
        null;

      proceduralSeed =
        null;

      currentTerrainName =
        file.name.replace(
          /\.[^/.]+$/,
          ""
        );

      if ($("designName")) {
        $("designName").value =
          currentTerrainName;
      }

      buildImportedRasterTerrain();

      setStatus(
        "READY"
      );

      return;
    }


    if (
      extension === "txt"
    ) {
      const text =
        await file.text();

      const firstLines =
        text
          .split(
            /\r?\n/
          )
          .slice(
            0,
            10
          )
          .join(
            "\n"
          )
          .toLowerCase();

      if (
        firstLines.includes(
          "ncols"
        ) &&
        firstLines.includes(
          "nrows"
        )
      ) {
        rawRasterTerrain =
          parseEsriAsciiGrid(
            text
          );
      } else {
        rawRasterTerrain =
          parseXYZRaster(
            text
          );
      }

      rawTriangles =
        null;

      proceduralSeed =
        null;

      currentTerrainName =
        file.name.replace(
          /\.[^/.]+$/,
          ""
        );

      if ($("designName")) {
        $("designName").value =
          currentTerrainName;
      }

      buildImportedRasterTerrain();

      setStatus(
        "READY"
      );

      return;
    }


    if (
      ![
        "ply",
        "stl",
        "obj"
      ].includes(
        extension
      )
    ) {
      throw new Error(
        "Unsupported file type."
      );
    }


    let object;


    if (
      extension === "obj"
    ) {
      object =
        new OBJLoader().parse(
          await file.text()
        );
    } else {
      const buffer =
        await file.arrayBuffer();

      const geometry =
        extension === "ply"
          ? new PLYLoader().parse(
              buffer
            )
          : new STLLoader().parse(
              buffer
            );

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


    rawTriangles =
      collectTrianglesFromObject(
        object
      );

    rawRasterTerrain =
      null;

    if (
      rawTriangles.length ===
      0
    ) {
      throw new Error(
        "No triangles were found in the model."
      );
    }

    proceduralSeed =
      null;

    currentTerrainName =
      file.name.replace(
        /\.[^/.]+$/,
        ""
      );

    if ($("designName")) {
      $("designName").value =
        currentTerrainName;
    }

    buildUploadedTerrain();

    setStatus(
      "READY"
    );
  } catch (error) {
    console.error(error);

    setStatus(
      "TERRAIN ERROR"
    );

    alert(
      `Could not load the terrain file.\n\n${error.message}`
    );
  }
}


/* =========================================================
   ANIMATION
========================================================= */

function animate() {
  requestAnimationFrame(
    animate
  );

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


/* =========================================================
   START
========================================================= */

initializeScene();

bindControls();

buildProceduralTerrain(
  true
);

renderDesignComparison();

requestAnimationFrame(
  animate
);
