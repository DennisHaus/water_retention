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


/* =========================================================
   HELPERS
========================================================= */

const $ = (
  id
) => {
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


const numberValue = (
  id
) => {
  const element =
    $(id);

  if (
    !element
  ) {
    return 0;
  }

  const value =
    Number(
      element.value
    );

  return Number.isFinite(
    value
  )
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
      minimumFractionDigits:
        decimals,

      maximumFractionDigits:
        decimals
    }
  );
};


const formatVolume = (
  volumeM3
) => {
  if (
    !Number.isFinite(
      volumeM3
    )
  ) {
    return "0 L";
  }

  if (
    volumeM3 < 1
  ) {
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


function setStatus(
  message
) {
  const element =
    $("status");

  if (
    !element
  ) {
    return;
  }

  element.textContent =
    String(
      message
    ).toUpperCase();
}


function escapeHtml(
  value
) {
  return String(value)
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


function csvEscape(
  value
) {
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
    return `"${stringValue.replace(
      /"/g,
      '""'
    )}"`;
  }

  return stringValue;
}


function mulberry32(
  seed
) {
  let value =
    seed >>> 0;

  return function random() {
    value +=
      0x6D2B79F5;

    let result =
      value;

    result =
      Math.imul(
        result ^
          result >>> 15,
        result | 1
      );

    result ^=
      result +
      Math.imul(
        result ^
          result >>> 7,
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


function disposeObjectResources(
  object
) {
  object.traverse(
    (child) => {
      if (
        child.geometry
      ) {
        child.geometry.dispose();
      }

      if (
        child.material
      ) {
        if (
          Array.isArray(
            child.material
          )
        ) {
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
  if (
    !group
  ) {
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


function onClick(
  id,
  callback
) {
  const element =
    $(id);

  if (
    element
  ) {
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

  if (
    element
  ) {
    element.addEventListener(
      "change",
      callback
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
      antialias:
        true,

      preserveDrawingBuffer:
        true
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


  const ambientLight =
    new THREE.HemisphereLight(
      0xc2dcf0,
      0x161616,
      2.3
    );

  scene.add(
    ambientLight
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

  waterGroup.name =
    "retained-water";

  world.add(
    waterGroup
  );


  labelGroup =
    new THREE.Group();

  labelGroup.name =
    "basin-labels";

  world.add(
    labelGroup
  );


  flowGroup =
    new THREE.Group();

  flowGroup.name =
    "static-flow-lines";

  world.add(
    flowGroup
  );


  analysisGroup =
    new THREE.Group();

  analysisGroup.name =
    "analysis-layers";

  world.add(
    analysisGroup
  );


  orientationGroup =
    new THREE.Group();

  orientationGroup.name =
    "slope-orientation";

  analysisGroup.add(
    orientationGroup
  );


  steepnessGroup =
    new THREE.Group();

  steepnessGroup.name =
    "slope-steepness";

  analysisGroup.add(
    steepnessGroup
  );


  watershedGroup =
    new THREE.Group();

  watershedGroup.name =
    "watersheds";

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
    width /
    height;

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
  linewidth = 2,
  opacity = 0.9,
  closed = false,
  renderOrder = 80
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

  if (
    closed
  ) {
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
      transparent:
        true,
      opacity,
      depthTest:
        false,
      depthWrite:
        false
    });

  const viewer =
    $("viewer");

  material.resolution.set(
    Math.max(
      1,
      viewer.clientWidth
    ),
    Math.max(
      1,
      viewer.clientHeight
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
   CONTROLS
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

  if (
    !range ||
    !number
  ) {
    return;
  }

  const update =
    (rawValue) => {
      let value =
        Number(
          rawValue
        );

      if (
        !Number.isFinite(
          value
        )
      ) {
        value =
          Number(
            range.value
          );
      }

      value =
        clamp(
          value,
          Number(
            range.min
          ),
          Number(
            range.max
          )
        );

      range.value =
        String(
          value
        );

      number.value =
        String(
          value
        );

      callback(
        value
      );
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
      if (
        event.key ===
        "Enter"
      ) {
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

  if (
    range
  ) {
    range.value =
      String(
        value
      );
  }

  if (
    number
  ) {
    number.value =
      String(
        value
      );
  }
}


function bindControls() {
  bindPair(
    "rainfallPerM2",
    "rainfallPerM2Number",
    (value) => {
      displayedRainfall =
        value;

      if (
        terrainState
      ) {
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
    (value) => {
      updateWaterOpacity(
        value
      );
    },
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
      if (
        currentResult
      ) {
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


  onClick(
    "detailedDescriptionLink",
    (event) => {
      event.preventDefault();

      const details =
        $("detailedDescription");

      if (
        details
      ) {
        details.open =
          true;

        details.scrollIntoView({
          behavior:
            "smooth",
          block:
            "start"
        });
      }
    }
  );


  const clearWaterButton =
    $("clearWaterButton") ||
    $("emptyWaterButton");

  if (
    clearWaterButton
  ) {
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

      if (
        input
      ) {
        input.click();
      }
    }
  );


  const dropZone =
    $("dropZone");

  if (
    dropZone
  ) {
    dropZone.addEventListener(
      "click",
      () => {
        const input =
          $("modelFileInput");

        if (
          input
        ) {
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

        const file =
          event.dataTransfer.files[0];

        if (
          file
        ) {
          await loadModelFile(
            file
          );
        }
      }
    );
  }


  const modelInput =
    $("modelFileInput");

  if (
    modelInput
  ) {
    modelInput.addEventListener(
      "change",
      async (event) => {
        const file =
          event.target.files[0];

        if (
          file
        ) {
          await loadModelFile(
            file
          );
        }

        event.target.value =
          "";
      }
    );
  }
}


/* =========================================================
   LEGEND
========================================================= */

function createSteepnessLegend() {
  if (
    steepnessLegendElement
  ) {
    return;
  }

  const viewer =
    $("viewer");

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
  if (
    !steepnessLegendElement
  ) {
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
    `GENERATED ALPINE ` +
    proceduralSeed
      .toString(16)
      .padStart(
        8,
        "0"
      )
      .toUpperCase();

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
        x /
          radiusX,
        2
      ) +
      Math.pow(
        z /
          radiusZ,
        2
      )
    )
  );
}


function ridgeNoise(
  value
) {
  return 1 -
    Math.abs(
      Math.sin(
        value
      )
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
    random() *
      300;

  const depthM =
    950 +
    random() *
      260;

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

  const phaseD =
    random() *
    Math.PI *
    2;


  const basins = [
    {
      x:
        -widthM *
          0.08 +
        random() *
          widthM *
          0.16,

      z:
        -depthM *
          0.08 +
        random() *
          depthM *
          0.12,

      radiusX:
        105 +
        random() *
          55,

      radiusZ:
        115 +
        random() *
          60,

      depth:
        45 +
        random() *
          45,

      ring:
        22 +
        random() *
          18
    },

    {
      x:
        widthM *
          0.18 +
        random() *
          widthM *
          0.08,

      z:
        depthM *
          0.08 +
        random() *
          depthM *
          0.12,

      radiusX:
        95 +
        random() *
          60,

      radiusZ:
        100 +
        random() *
          65,

      depth:
        35 +
        random() *
          38,

      ring:
        16 +
        random() *
          18
    }
  ];


  const cirques = [
    {
      x:
        -widthM *
          0.27,

      z:
        depthM *
          0.22,

      radiusX:
        widthM *
          0.13,

      radiusZ:
        depthM *
          0.13,

      depth:
        55 +
        random() *
          40
    },

    {
      x:
        widthM *
          0.29,

      z:
        depthM *
          0.34,

      radiusX:
        widthM *
          0.12,

      radiusZ:
        depthM *
          0.15,

      depth:
        48 +
        random() *
          38
    }
  ];


  const morainePosition =
    -depthM *
      0.12;

  const moraineHeight =
    30 +
    random() *
      30;

  const moraineWidth =
    330 +
    random() *
      170;

  const moraineThickness =
    18 +
    random() *
      11;


  const cosAngle =
    Math.cos(
      valleyAngle
    );

  const sinAngle =
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
      const normalizedX =
        (
          x + 0.5
        ) /
        resolution *
        2 -
        1;

      const normalizedZ =
        (
          z + 0.5
        ) /
        resolution *
        2 -
        1;

      const localX =
        normalizedX *
        widthM /
        2;

      const localZ =
        normalizedZ *
        depthM /
        2;


      const valleyX =
        localX *
          cosAngle +
        localZ *
          sinAngle;

      const valleyZ =
        -localX *
          sinAngle +
        localZ *
          cosAngle;


      const normalizedValleyX =
        valleyX /
        (
          widthM *
          0.5
        );

      const normalizedValleyZ =
        valleyZ /
        (
          depthM *
          0.5
        );


      let height =
        62;

      height +=
        72 *
        (
          normalizedValleyZ +
          1
        ) /
        2;

      height +=
        120 *
        Math.pow(
          Math.abs(
            normalizedValleyX
          ),
          1.72
        );

      height +=
        30 *
        Math.pow(
          Math.abs(
            normalizedValleyX
          ),
          4
        );


      const sideWeight =
        Math.min(
          1,
          Math.abs(
            normalizedValleyX
          ) *
          1.65
        );

      height +=
        sideWeight *
        (
          18 *
          ridgeNoise(
            normalizedValleyZ *
              7.2 +
            normalizedValleyX *
              3.1 +
            phaseA
          ) +

          13 *
          ridgeNoise(
            normalizedValleyZ *
              12.7 -
            normalizedValleyX *
              4.4 +
            phaseB
          )
        );


      height +=
        14 *
        Math.sin(
          normalizedValleyZ *
            6.2 +
          normalizedValleyX *
            2.4 +
          phaseA
        );

      height +=
        10 *
        Math.cos(
          normalizedValleyZ *
            11.5 -
          normalizedValleyX *
            4.7 +
          phaseB
        );

      height +=
        6 *
        Math.sin(
          normalizedValleyZ *
            22 +
          normalizedValleyX *
            9 +
          phaseC
        );

      height +=
        3.5 *
        Math.cos(
          normalizedValleyZ *
            39 -
          normalizedValleyX *
            18 +
          phaseD
        );


      for (
        const cirque of cirques
      ) {
        const bowl =
          gaussian2D(
            valleyX -
              cirque.x,
            valleyZ -
              cirque.z,
            cirque.radiusX,
            cirque.radiusZ
          );

        const ridge =
          gaussian2D(
            valleyX -
              cirque.x,
            valleyZ -
              cirque.z *
                0.88,
            cirque.radiusX *
              1.3,
            cirque.radiusZ *
              1.2
          );

        height -=
          cirque.depth *
          bowl;

        height +=
          26 *
          ridge;
      }


      for (
        const basin of basins
      ) {
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
          basin.ring *
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


      const moraineDistance =
        Math.abs(
          valleyZ -
          morainePosition
        );

      const moraineExtent =
        Math.max(
          0,
          1 -
          Math.pow(
            Math.abs(
              valleyX
            ) /
            moraineWidth,
            4
          )
        );

      height +=
        moraineHeight *
        Math.exp(
          -Math.pow(
            moraineDistance /
            moraineThickness,
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

        for (
          const [dx, dz] of SLOPE_NEIGHBOURS
        ) {
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
            continue;
          }

          const nextIndex =
            nextZ *
              resolution +
            nextX;

          const horizontalDistance =
            Math.hypot(
              dx *
                cellWidthM,
              dz *
                cellDepthM
            );

          const maximumDifference =
            horizontalDistance *
            maximumSlopeRatio;

          const difference =
            heights[index] -
            heights[nextIndex];

          if (
            Math.abs(
              difference
            ) <=
            maximumDifference
          ) {
            continue;
          }

          const excess =
            Math.abs(
              difference
            ) -
            maximumDifference;

          const adjustment =
            excess *
            0.5;

          if (
            difference > 0
          ) {
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
      }
    }

    if (
      !changed
    ) {
      break;
    }
  }


  let maximumObservedRatio =
    0;

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

      for (
        const [dx, dz] of SLOPE_NEIGHBOURS
      ) {
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
          continue;
        }

        const nextIndex =
          nextZ *
            resolution +
          nextX;

        const horizontalDistance =
          Math.hypot(
            dx *
              cellWidthM,
            dz *
              cellDepthM
          );

        const ratio =
          Math.abs(
            heights[index] -
            heights[nextIndex]
          ) /
          horizontalDistance;

        maximumObservedRatio =
          Math.max(
            maximumObservedRatio,
            ratio
          );
      }
    }
  }


  if (
    maximumObservedRatio >
    maximumSlopeRatio
  ) {
    const factor =
      maximumSlopeRatio /
      maximumObservedRatio;

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

    for (
      let index = 0;
      index < heights.length;
      index++
    ) {
      heights[index] =
        minimumHeight +
        (
          heights[index] -
          minimumHeight
        ) *
        factor;
    }
  }
}


/* =========================================================
   MODEL IMPORT
========================================================= */

function rebuildUploadedTerrainIfAvailable() {
  if (
    !rawTriangles ||
    rawTriangles.length ===
    0
  ) {
    return;
  }

  buildUploadedTerrain();
}


function transformRawTriangles(
  triangles
) {
  const modelScale =
    numberValue(
      "modelScale"
    );

  const metersPerModelUnit =
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

  const scale =
    modelScale *
    metersPerModelUnit;


  return triangles.map(
    (triangle) =>
      triangle.map(
        (point) => {
          const vector =
            new THREE.Vector3(
              point[0] *
                scale,

              point[1] *
                scale,

              point[2] *
                scale
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

    const transformedTriangles =
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
        transformedTriangles,
        resolution
      );

    applyTerrainData(
      terrain,
      currentTerrainName
    );
  } catch (
    error
  ) {
    console.error(
      error
    );

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
  if (
    !triangles ||
    triangles.length ===
    0
  ) {
    throw new Error(
      "The model contains no triangles."
    );
  }

  let minX =
    Infinity;

  let maxX =
    -Infinity;

  let minZ =
    Infinity;

  let maxZ =
    -Infinity;


  for (
    const triangle of triangles
  ) {
    for (
      const point of triangle
    ) {
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
  }


  const widthM =
    maxX -
    minX;

  const depthM =
    maxZ -
    minZ;

  if (
    !Number.isFinite(
      widthM
    ) ||
    !Number.isFinite(
      depthM
    ) ||
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


  for (
    const triangle of triangles
  ) {
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
      continue;
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
        const sampleU =
          x + 0.5;

        const sampleV =
          z + 0.5;

        const a =
          (
            (
              v1 -
              v2
            ) *
            (
              sampleU -
              u2
            ) +
            (
              u2 -
              u1
            ) *
            (
              sampleV -
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
              sampleU -
              u2
            ) +
            (
              u0 -
              u2
            ) *
            (
              sampleV -
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

        const height =
          a * p0[1] +
          b * p1[1] +
          c * p2[1];

        const index =
          z *
            resolution +
          x;

        heights[index] =
          Math.max(
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


  let minimumHeight =
    Infinity;

  for (
    let index = 0;
    index < heights.length;
    index++
  ) {
    if (
      !Number.isFinite(
        heights[index]
      )
    ) {
      throw new Error(
        "The model could not be converted into a continuous heightfield."
      );
    }

    minimumHeight =
      Math.min(
        minimumHeight,
        heights[index]
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


  for (
    let index = 0;
    index < heights.length;
    index++
  ) {
    if (
      Number.isFinite(
        heights[index]
      )
    ) {
      queue[tail++] =
        index;
    }
  }

  if (
    tail === 0
  ) {
    return;
  }


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


    for (
      const [dx, dz] of NEIGHBOURS
    ) {
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
        continue;
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
        continue;
      }

      heights[nextIndex] =
        heights[index];

      queue[tail++] =
        nextIndex;
    }
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
      if (
        visited[index]
      ) {
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
    seedBoundary(
      x
    );

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


    for (
      const [dx, dz] of NEIGHBOURS
    ) {
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
        continue;
      }

      const nextIndex =
        nextZ *
          resolution +
        nextX;

      if (
        visited[nextIndex]
      ) {
        continue;
      }

      visited[nextIndex] =
        1;

      const nextLevel =
        Math.max(
          current.level,
          heights[nextIndex]
        );

      spillLevels[nextIndex] =
        nextLevel;

      heap.push({
        index:
          nextIndex,
        level:
          nextLevel
      });
    }
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

      if (
        boundary
      ) {
        continue;
      }


      let target =
        -1;

      let bestSlope =
        0;


      for (
        const [dx, dz] of NEIGHBOURS
      ) {
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
          continue;
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


  for (
    const index of order
  ) {
    const target =
      targets[index];

    if (
      target >= 0
    ) {
      accumulation[target] +=
        accumulation[index];
    }
  }

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

      if (
        target < 0
      ) {
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

    if (
      resolved ===
      -2
    ) {
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

    if (
      terminal < 0
    ) {
      continue;
    }

    if (
      !groups.has(
        terminal
      )
    ) {
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


  for (
    const [
      sinkIndex,
      catchmentCells
    ] of groups.entries()
  ) {
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


    for (
      const index of catchmentCells
    ) {
      const x =
        index %
        state.resolution;

      const z =
        Math.floor(
          index /
          state.resolution
        );


      for (
        const [dx, dz] of NEIGHBOURS
      ) {
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
          continue;
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
          continue;
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
    }


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


    const depressionCells =
      catchmentCells.filter(
        (index) =>
          state.heights[index] <=
          outletCrest +
          0.0001
      );


    if (
      depressionCells.length ===
      0
    ) {
      depressionCells.push(
        sinkIndex
      );
    }


    let minimumHeight =
      Infinity;

    for (
      const index of depressionCells
    ) {
      minimumHeight =
        Math.min(
          minimumHeight,
          state.heights[index]
        );
    }


    let capacityM3 =
      0;

    for (
      const index of depressionCells
    ) {
      capacityM3 +=
        Math.max(
          0,
          outletCrest -
          state.heights[index]
        ) *
        state.cellAreaM2;
    }


    basins.push({
      sinkIndex,
      catchmentCells,
      cells:
        depressionCells,
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

  const largest =
    rawBasins.reduce(
      (current, basin) => {
        const currentSize =
          Math.max(
            current.capacityM3,
            current.cells.length
          );

        const basinSize =
          Math.max(
            basin.capacityM3,
            basin.cells.length
          );

        return basinSize >
          currentSize
          ? basin
          : current;
      }
    );

  const largestSize =
    Math.max(
      largest.capacityM3,
      largest.cells.length
    );

  const threshold =
    largestSize *
    BASIN_SIGNIFICANCE_RATIO;

  const selected =
    rawBasins.filter(
      (basin) =>
        Math.max(
          basin.capacityM3,
          basin.cells.length
        ) >= threshold
    );

  const selectedBySink =
    new Map();

  selected.forEach(
    (basin, index) => {
      basin.significanceRatio =
        largestSize > 0
          ? Math.max(
              basin.capacityM3,
              basin.cells.length
            ) /
            largestSize
          : 1;

      basin.destinationIndex =
        -1;

      selectedBySink.set(
        basin.sinkIndex,
        index
      );
    }
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


  selected.forEach(
    (basin, selectedIndex) => {
      let cursor =
        rawBySink.get(
          basin.destinationTerminal
        );

      const visited =
        new Set();

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
          const possible =
            selectedBySink.get(
              cursor.sinkIndex
            );

          if (
            possible !==
            selectedIndex
          ) {
            destinationIndex =
              possible;
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

  for (
    let index = 0;
    index < basins.length;
    index++
  ) {
    if (
      indegree[index] ===
      0
    ) {
      queue.push(
        index
      );
    }
  }


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


  if (
    order.length <
    basins.length
  ) {
    for (
      let index = 0;
      index < basins.length;
      index++
    ) {
      if (
        !order.includes(
          index
        )
      ) {
        basins[index].destinationIndex =
          -1;

        order.push(
          index
        );
      }
    }
  }

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
      ) /
      2;

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
    ) /
    2;

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
  if (
    !terrainState
  ) {
    return null;
  }

  const state =
    terrainState;

  const rainfallDepthM =
    Math.max(
      0,
      rainfallLPerM2
    ) /
    1000;

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
    (basin, basinIndex) => {
      incoming[basinIndex] =
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
            state.widthM /
            2;

          const localZ =
            (
              z + 0.5
            ) *
            state.cellDepthM -
            state.depthM /
            2;

          const cellVolumeM3 =
            depthM *
            state.cellAreaM2;

          weightedX +=
            localX *
            cellVolumeM3;

          weightedY +=
            (
              state.heights[index] +
              depthM /
                2
            ) *
            cellVolumeM3;

          weightedZ +=
            localZ *
            cellVolumeM3;
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
          destination <
            incoming.length
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

  const terrainAreaM2 =
    data.widthM *
    data.depthM;

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
    terrainAreaM2,

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
  if (
    terrainMesh
  ) {
    world.remove(
      terrainMesh
    );

    terrainMesh.geometry.dispose();
    terrainMesh.material.dispose();

    terrainMesh =
      null;
  }


  const {
    heights,
    resolution,
    widthM,
    depthM
  } =
    terrainState;

  const positions =
    [];

  const indices =
    [];


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

      const localX =
        (
          x + 0.5
        ) *
        terrainState.cellWidthM -
        widthM /
        2;

      const localZ =
        (
          z + 0.5
        ) *
        terrainState.cellDepthM -
        depthM /
        2;

      positions.push(
        localX,
        heights[index],
        localZ
      );
    }
  }


  for (
    let z = 0;
    z < resolution - 1;
    z++
  ) {
    for (
      let x = 0;
      x < resolution - 1;
      x++
    ) {
      const a =
        z *
          resolution +
        x;

      const b =
        a + 1;

      const c =
        a +
        resolution;

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

  terrainMesh.name =
    "terrain";

  world.add(
    terrainMesh
  );
}


/* =========================================================
   WATER GEOMETRY
========================================================= */

function ensureWaterMesh() {
  disposeWaterMesh();

  waterMesh =
    new THREE.Group();

  waterMesh.name =
    "terrain-following-water-volumes";

  waterGroup.add(
    waterMesh
  );
}


function disposeWaterMesh() {
  if (
    !waterMesh
  ) {
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
  if (
    !waterMesh
  ) {
    return;
  }

  waterMesh.traverse(
    (object) => {
      if (
        object.material
      ) {
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
          Number(
            value
          ).toFixed(
            5
          )
      )
      .join(
        "|"
      );

  if (
    vertexMap.has(
      key
    )
  ) {
    return vertexMap.get(
      key
    );
  }

  const index =
    vertices.length /
    3;

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
      const cellX =
        cornerX +
        dx;

      const cellZ =
        cornerZ +
        dz;

      if (
        cellX < 0 ||
        cellX >= state.resolution ||
        cellZ < 0 ||
        cellZ >= state.resolution
      ) {
        continue;
      }

      total +=
        state.heights[
          cellZ *
            state.resolution +
          cellX
        ];

      count++;
    }
  }

  return count > 0
    ? total /
      count
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
    state.widthM /
      2;

  const x1 =
    (
      x + 1
    ) *
      state.cellWidthM -
    state.widthM /
      2;

  const z0 =
    z *
      state.cellDepthM -
    state.depthM /
      2;

  const z1 =
    (
      z + 1
    ) *
      state.cellDepthM -
    state.depthM /
      2;

  return [
    {
      x:
        x0,

      y:
        getTerrainCornerHeight(
          state,
          x,
          z
        ),

      z:
        z0
    },

    {
      x:
        x1,

      y:
        getTerrainCornerHeight(
          state,
          x + 1,
          z
        ),

      z:
        z0
    },

    {
      x:
        x1,

      y:
        getTerrainCornerHeight(
          state,
          x + 1,
          z + 1
        ),

      z:
        z1
    },

    {
      x:
        x0,

      y:
        getTerrainCornerHeight(
          state,
          x,
          z + 1
        ),

      z:
        z1
    }
  ];
}


function cloneWaterPoint(
  point
) {
  return {
    x:
      point.x,

    y:
      point.y,

    z:
      point.z
  };
}


function cleanWaterPolygon(
  points
) {
  const cleaned =
    [];

  points.forEach(
    (point) => {
      const previous =
        cleaned[
          cleaned.length - 1
        ];

      if (
        !previous ||
        Math.hypot(
          point.x -
            previous.x,

          point.z -
            previous.z
        ) >
        0.00001
      ) {
        cleaned.push(
          cloneWaterPoint(
            point
          )
        );
      }
    }
  );

  if (
    cleaned.length > 2
  ) {
    const first =
      cleaned[0];

    const last =
      cleaned[
        cleaned.length - 1
      ];

    if (
      Math.hypot(
        first.x -
          last.x,

        first.z -
          last.z
      ) <
      0.00001
    ) {
      cleaned.pop();
    }
  }

  return cleaned;
}


function clipTerrainPolygonToWater(
  points,
  waterLevel
) {
  const output =
    [];

  const epsilon =
    0.000001;


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
      a.y <=
      waterLevel +
      epsilon;

    const bInside =
      b.y <=
      waterLevel +
      epsilon;


    if (
      aInside &&
      bInside
    ) {
      output.push(
        cloneWaterPoint(
          b
        )
      );

      continue;
    }


    const denominator =
      b.y -
      a.y;

    if (
      Math.abs(
        denominator
      ) < 0.000001
    ) {
      continue;
    }

    if (
      aInside &&
      !bInside
    ) {
      const amount =
        (
          waterLevel -
          a.y
        ) /
        denominator;

      output.push({
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
      });

      continue;
    }


    if (
      !aInside &&
      bInside
    ) {
      const amount =
        (
          waterLevel -
          a.y
        ) /
        denominator;

      output.push({
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
      });

      output.push(
        cloneWaterPoint(
          b
        )
      );
    }
  }

  return cleanWaterPolygon(
    output
  );
}


function getWaterEdgeSegment(
  a,
  b,
  waterLevel
) {
  const aInside =
    a.y <=
    waterLevel;

  const bInside =
    b.y <=
    waterLevel;

  if (
    !aInside &&
    !bInside
  ) {
    return null;
  }

  if (
    aInside &&
    bInside
  ) {
    return [
      cloneWaterPoint(
        a
      ),

      cloneWaterPoint(
        b
      )
    ];
  }

  const denominator =
    b.y -
    a.y;

  if (
    Math.abs(
      denominator
    ) < 0.000001
  ) {
    return null;
  }

  const amount =
    (
      waterLevel -
      a.y
    ) /
    denominator;

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

  return aInside
    ? [
        cloneWaterPoint(
          a
        ),

        intersection
      ]
    : [
        intersection,

        cloneWaterPoint(
          b
        )
      ];
}


function waterPolygonArea2D(
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
      a.x *
        b.z -
      b.x *
        a.z;
  }

  return Math.abs(
    area *
    0.5
  );
}


function triangulateWaterPolygon(
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
    index <
      points.length - 1;
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
  const clipped =
    clipTerrainPolygonToWater(
      cell.corners,
      waterLevel
    );

  if (
    clipped.length < 3 ||
    waterPolygonArea2D(
      clipped
    ) <
      state.cellAreaM2 *
      0.00001
  ) {
    return;
  }


  const topPoints =
    clipped.map(
      (point) => [
        point.x,
        waterLevel,
        point.z
      ]
    );

  const bottomPoints =
    clipped.map(
      (point) => [
        point.x,
        point.y,
        point.z
      ]
    );

  const polygonTriangles =
    triangulateWaterPolygon(
      clipped
    );


  polygonTriangles.forEach(
    (face) => {
      const a =
        face[0];

      const b =
        face[1];

      const c =
        face[2];

      addExportTriangle(
        topPoints[a],
        topPoints[b],
        topPoints[c],
        vertices,
        triangles,
        vertexMap
      );

      addExportTriangle(
        bottomPoints[c],
        bottomPoints[b],
        bottomPoints[a],
        vertices,
        triangles,
        vertexMap
      );
    }
  );


  const x =
    cell.x;

  const z =
    cell.z;

  const edgeDefinitions = [
    {
      a:
        cell.corners[0],

      b:
        cell.corners[1],

      neighbourX:
        x,

      neighbourZ:
        z - 1
    },

    {
      a:
        cell.corners[1],

      b:
        cell.corners[2],

      neighbourX:
        x + 1,

      neighbourZ:
        z
    },

    {
      a:
        cell.corners[2],

      b:
        cell.corners[3],

      neighbourX:
        x,

      neighbourZ:
        z + 1
    },

    {
      a:
        cell.corners[3],

      b:
        cell.corners[0],

      neighbourX:
        x - 1,

      neighbourZ:
        z
    }
  ];


  edgeDefinitions.forEach(
    (edge) => {
      const neighbourInside =
        edge.neighbourX >= 0 &&
        edge.neighbourX <
          state.resolution &&
        edge.neighbourZ >= 0 &&
        edge.neighbourZ <
          state.resolution &&
        wetSet.has(
          edge.neighbourZ *
            state.resolution +
          edge.neighbourX
        );

      if (
        neighbourInside
      ) {
        return;
      }

      const segment =
        getWaterEdgeSegment(
          edge.a,
          edge.b,
          waterLevel
        );

      if (
        !segment
      ) {
        return;
      }

      const a =
        segment[0];

      const b =
        segment[1];

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
      ? [
          selectedBasin
        ]
      : result.basins;


  basins.forEach(
    (basin) => {
      if (
        basin.retainedVolumeM3 <=
        0.000001
      ) {
        return;
      }

      const wetCells =
        [];

      const wetSet =
        new Set();


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

          const clipped =
            clipTerrainPolygonToWater(
              corners,
              basin.waterLevel
            );

          if (
            clipped.length >= 3 &&
            waterPolygonArea2D(
              clipped
            ) >
              result.cellAreaM2 *
              0.00001
          ) {
            wetSet.add(
              index
            );

            wetCells.push({
              index,
              x,
              z,
              corners
            });
          }
        }
      );


      wetCells.forEach(
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
        positions.length /
        3;

      triangle.forEach(
        (vertexIndex) => {
          positions.push(
            mesh.vertices[
              vertexIndex *
              3
            ],

            mesh.vertices[
              vertexIndex *
              3 +
              1
            ],

            mesh.vertices[
              vertexIndex *
              3 +
              2
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
  if (
    !waterMesh
  ) {
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

      const geometry =
        createGeometryFromExportMesh(
          meshData
        );

      /*
       * MeshBasicMaterial avoids false
       * diagonal shading across the
       * clipped water-cell surfaces.
       */
      const material =
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
        });

      const mesh =
        new THREE.Mesh(
          geometry,
          material
        );

      mesh.name =
        "terrain-following-water-volume";

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

function clearBasinLabels() {
  clearGroup(
    labelGroup
  );
}


function updateBasinLabels(
  result
) {
  clearBasinLabels();

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

  const visibleBasins =
    result.basins.filter(
      (basin) =>
        basin.retainedVolumeM3 >
        0.000001
    );

  const labelLift =
    Math.max(
      0.8,
      Math.min(
        result.cellWidthM,
        result.cellDepthM
      ) *
      0.2
    );


  visibleBasins.forEach(
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
        basin.waterLevel +
          labelLift,
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
      result.rainfallDepthM *
        1000,
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


  const basinReadout =
    $("basinReadout");

  basinReadout.innerHTML =
    "";

  const visibleBasins =
    result.basins.filter(
      (basin) =>
        basin.retainedVolumeM3 >
        0.000001
    );

  if (
    visibleBasins.length ===
    0
  ) {
    basinReadout.textContent =
      "No retained water.";

    return;
  }


  visibleBasins.forEach(
    (basin, index) => {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "basin-row";

      const title =
        document.createElement(
          "span"
        );

      title.textContent =
        `BASIN ${String(
          index + 1
        ).padStart(
          2,
          "0"
        )}`;

      const value =
        document.createElement(
          "strong"
        );

      value.textContent =
        formatVolume(
          basin.retainedVolumeM3
        );

      row.appendChild(
        title
      );

      row.appendChild(
        value
      );

      basinReadout.appendChild(
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
  if (
    !result
  ) {
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
  if (
    world
  ) {
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

  const verticalScale =
    numberValue(
      "verticalExaggeration"
    );

  controls.target.set(
    0,
    terrainState.maximumHeight *
      verticalScale *
      0.22,
    0
  );

  controls.update();
}


function frameCamera() {
  if (
    !terrainState
  ) {
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
    horizontalSize *
      0.9,

    Math.max(
      horizontalSize *
        0.65,

      visualHeight *
        1.35
    ),

    horizontalSize *
      0.9
  );

  controls.target.set(
    0,
    visualHeight *
      0.22,
    0
  );

  controls.maxDistance =
    horizontalSize *
    8;

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
  const resolution =
    state.resolution;

  const heightAt =
    (sampleX, sampleZ) => {
      const safeX =
        clamp(
          sampleX,
          0,
          resolution - 1
        );

      const safeZ =
        clamp(
          sampleZ,
          0,
          resolution - 1
        );

      return state.heights[
        safeZ *
          resolution +
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

  const denominatorX =
    (
      Math.min(
        resolution - 1,
        x + 1
      ) -
      Math.max(
        0,
        x - 1
      )
    ) *
    state.cellWidthM;

  const denominatorZ =
    (
      Math.min(
        resolution - 1,
        z + 1
      ) -
      Math.max(
        0,
        z - 1
      )
    ) *
    state.cellDepthM;

  const gradientX =
    denominatorX > 0
      ? (
          right -
          left
        ) /
        denominatorX
      : 0;

  const gradientZ =
    denominatorZ > 0
      ? (
          up -
          down
        ) /
        denominatorZ
      : 0;

  return {
    gradientX,
    gradientZ,

    downhillX:
      -gradientX,

    downhillZ:
      -gradientZ,

    slopeRatio:
      Math.hypot(
        gradientX,
        gradientZ
      ),

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
      ) *
      0.64,

    0.72,

    0.5
  );

  return color;
}


function watershedColor(
  watershedId
) {
  if (
    watershedId < 0
  ) {
    return new THREE.Color(
      0x5b6468
    );
  }

  const color =
    new THREE.Color();

  const hue =
    (
      watershedId *
      0.61803398875
    ) %
    1;

  color.setHSL(
    hue,
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
    data.positions.length /
    3;

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
          color.r *
          255
        ),

        Math.round(
          color.g *
          255
        ),

        Math.round(
          color.b *
          255
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
      vertexColors:
        true,

      transparent:
        true,

      opacity,

      depthTest:
        false,

      depthWrite:
        false,

      side:
        THREE.DoubleSide,

      polygonOffset:
        true,

      polygonOffsetFactor:
        -2,

      polygonOffsetUnits:
        -2
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
      0.04,
      Math.min(
        state.cellWidthM,
        state.cellDepthM
      ) *
      0.055
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
      const gradient =
        getCellGradient(
          state,
          x,
          z
        );

      const normalized =
        clamp(
          gradient.slopeDegrees /
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
              point.y +
                lift,
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
    (basin, basinIndex) => {
      terminalToBasin.set(
        basin.sinkIndex,
        basinIndex
      );
    }
  );

  const lift =
    Math.max(
      0.05,
      Math.min(
        state.cellWidthM,
        state.cellDepthM
      ) *
      0.075
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
        state.flowTerminals[
          index
        ];

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
              point.y +
                lift,
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

  /*
   * Approximately three times denser
   * than the earlier arrow field.
   */
  const spacing =
    Math.max(
      3,
      Math.floor(
        state.resolution /
          31
      )
    );

  const arrowLength =
    Math.max(
      state.cellWidthM,
      state.cellDepthM
    ) *
    1.5;


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
      const gradient =
        getCellGradient(
          state,
          x,
          z
        );

      const downhill =
        new THREE.Vector3(
          gradient.downhillX,
          0,
          gradient.downhillZ
        );

      if (
        downhill.lengthSq() <
        0.000001
      ) {
        continue;
      }

      downhill.normalize();

      const corners =
        getTerrainCellCorners(
          state,
          x,
          z
        );

      const center =
        new THREE.Vector3(
          (
            corners[0].x +
            corners[2].x
          ) *
            0.5,

          (
            corners[0].y +
            corners[1].y +
            corners[2].y +
            corners[3].y
          ) *
            0.25,

          (
            corners[0].z +
            corners[2].z
          ) *
            0.5
        );

      const lift =
        Math.max(
          0.8,
          Math.min(
            state.cellWidthM,
            state.cellDepthM
          ) *
          0.24
        );

      const origin =
        new THREE.Vector3(
          center.x,
          center.y +
            lift,
          center.z
        );

      const arrow =
        new THREE.ArrowHelper(
          downhill,
          origin,
          arrowLength,
          0xc7d49b,
          arrowLength *
            0.27,
          arrowLength *
            0.14
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
          downhill.clone().multiplyScalar(
            arrowLength
          )
        );

      const side =
        new THREE.Vector3(
          -downhill.z,
          0,
          downhill.x
        );

      const headLength =
        arrowLength *
        0.27;

      const headWidth =
        arrowLength *
        0.14;

      const headBase =
        end.clone().sub(
          downhill.clone().multiplyScalar(
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


  const addBoundaryEdge =
    (
      a,
      b
    ) => {
      edges.push({
        a: [
          a[0],
          a[1]
        ],

        b: [
          b[0],
          b[1]
        ]
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
          ? index -
            state.resolution
          : -1;

      const east =
        x < state.resolution - 1
          ? index + 1
          : -1;

      const south =
        z < state.resolution - 1
          ? index +
            state.resolution
          : -1;

      const west =
        x > 0
          ? index - 1
          : -1;


      if (
        !cellSet.has(
          north
        )
      ) {
        addBoundaryEdge(
          [x, z],
          [x + 1, z]
        );
      }

      if (
        !cellSet.has(
          east
        )
      ) {
        addBoundaryEdge(
          [x + 1, z],
          [x + 1, z + 1]
        );
      }

      if (
        !cellSet.has(
          south
        )
      ) {
        addBoundaryEdge(
          [x + 1, z + 1],
          [x, z + 1]
        );
      }

      if (
        !cellSet.has(
          west
        )
      ) {
        addBoundaryEdge(
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

      if (
        !outgoing.has(
          key
        )
      ) {
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


  while (
    unused.size > 0
  ) {
    const first =
      unused.values().next().value;

    if (
      !first
    ) {
      break;
    }

    const loop =
      [];

    const startKey =
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
      unused.has(
        current
      ) &&
      safety <
        edges.length + 10
    ) {
      safety++;

      unused.delete(
        current
      );

      loop.push([
        current.a[0],
        current.a[1]
      ]);

      const nextKey =
        watershedCornerKey(
          current.b[0],
          current.b[1]
        );

      if (
        nextKey ===
        startKey
      ) {
        break;
      }

      const candidates =
        outgoing.get(
          nextKey
        ) || [];

      current =
        candidates.find(
          (edge) =>
            unused.has(
              edge
            )
        ) ||
        null;
    }

    if (
      loop.length >= 3
    ) {
      loops.push(
        loop
      );
    }
  }

  return loops;
}


function smoothWatershedLoop(
  points,
  iterations = 3
) {
  let current =
    points.map(
      (point) =>
        point.clone()
    );


  /*
   * Three-point interpolation:
   * every point is replaced using its
   * previous, current and next points.
   */
  for (
    let iteration = 0;
    iteration < iterations;
    iteration++
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
    Math.min(
      260,
      Math.max(
        36,
        current.length *
          4
      )
    )
  );
}


function watershedLoopKey(
  points
) {
  return points
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
    .join(
      "|"
    );
}


function buildWatershedBoundaryLines(
  state
) {
  const groups =
    new Map();


  /*
   * Only significant watershed groups
   * are shown.
   */
  state.basinDefinitions.forEach(
    (basin) => {
      groups.set(
        basin.sinkIndex,
        basin.catchmentCells
      );
    }
  );


  const group =
    new THREE.Group();

  const usedLoops =
    new Set();

  const lift =
    Math.max(
      0.16,
      Math.min(
        state.cellWidthM,
        state.cellDepthM
      ) *
      0.16
    );


  groups.forEach(
    (cells) => {
      const rawLoops =
        buildWatershedLoopsFromCells(
          cells,
          state
        );

      rawLoops.forEach(
        (rawLoop) => {
          const worldPoints =
            rawLoop.map(
              (corner) =>
                new THREE.Vector3(
                  corner[0] *
                    state.cellWidthM -
                    state.widthM /
                    2,

                  getTerrainCornerHeight(
                    state,
                    corner[0],
                    corner[1]
                  ) +
                    lift,

                  corner[1] *
                    state.cellDepthM -
                    state.depthM /
                    2
                )
            );

          const loopKey =
            watershedLoopKey(
              worldPoints
            );

          if (
            usedLoops.has(
              loopKey
            )
          ) {
            return;
          }

          usedLoops.add(
            loopKey
          );


          const smoothPoints =
            smoothWatershedLoop(
              worldPoints,
              3
            );

          const line =
            createWideLine(
              smoothPoints,
              0xe3d6eb,
              2.2,
              0.92,
              true,
              70
            );

          if (
            line
          ) {
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

  analysisGroup.visible =
    true;

  updateAnalysisVisibility();
}


function updateAnalysisVisibility() {
  if (
    !terrainState
  ) {
    return;
  }

  analysisGroup.visible =
    true;

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
   FLOWLINES
========================================================= */

function flowCellKey(
  x,
  z
) {
  return `${x}:${z}`;
}


function buildFlowBlockedCells(
  state
) {
  const blocked =
    new Set();

  /*
   * Only significant basins are used.
   * A one-cell buffer prevents lines from
   * running directly across their water.
   */
  state.basinDefinitions.forEach(
    (basin) => {
      basin.cells.forEach(
        (index) => {
          const x =
            index %
            state.resolution;

          const z =
            Math.floor(
              index /
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
                continue;
              }

              blocked.add(
                flowCellKey(
                  nextX,
                  nextZ
                )
              );
            }
          }
        }
      );
    }
  );

  return blocked;
}


function isFlowPointBlocked(
  localX,
  localZ
) {
  const state =
    terrainState;

  const x =
    Math.floor(
      (
        localX +
        state.widthM /
          2
      ) /
      state.cellWidthM
    );

  const z =
    Math.floor(
      (
        localZ +
        state.depthM /
          2
      ) /
      state.cellDepthM
    );

  if (
    x < 0 ||
    x >= state.resolution ||
    z < 0 ||
    z >= state.resolution
  ) {
    return true;
  }

  return state.flowBlockedCells.has(
    flowCellKey(
      x,
      z
    )
  );
}


function sampleTerrainContinuous(
  localX,
  localZ
) {
  const state =
    terrainState;

  const gridX =
    (
      localX +
      state.widthM /
        2
    ) /
    state.cellWidthM -
    0.5;

  const gridZ =
    (
      localZ +
      state.depthM /
        2
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
    (x, z) => {
      const safeX =
        clamp(
          x,
          0,
          state.resolution - 1
        );

      const safeZ =
        clamp(
          z,
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
        safeX -
        x0;

      const fz =
        safeZ -
        z0;

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
        h00 *
          (1 - fx) *
          (1 - fz) +

        h10 *
          fx *
          (1 - fz) +

        h01 *
          (1 - fx) *
          fz +

        h11 *
          fx *
          fz
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
        gridX +
          sampleDistance,
        gridZ
      ) -
      sampleGrid(
        gridX -
          sampleDistance,
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
        gridZ +
          sampleDistance
      ) -
      sampleGrid(
        gridX,
        gridZ -
          sampleDistance
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


function cross2D(
  a,
  b,
  c
) {
  return (
    b.x -
    a.x
  ) *
  (
    c.z -
    a.z
  ) -
  (
    b.z -
    a.z
  ) *
  (
    c.x -
    a.x
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


function wouldSelfIntersect(
  points,
  nextPoint
) {
  if (
    points.length < 5
  ) {
    return false;
  }

  const last =
    points[
      points.length - 1
    ];

  /*
   * Ignore the most recent four
   * segments so normal local curvature
   * is not incorrectly treated as a loop.
   */
  for (
    let index = 0;
    index <
      points.length - 5;
    index++
  ) {
    if (
      segmentsIntersect2D(
        last,
        nextPoint,
        points[index],
        points[index + 1]
      )
    ) {
      return true;
    }
  }

  return false;
}


function integrateContinuousFlowPath(
  startX,
  startZ
) {
  const state =
    terrainState;

  if (
    isFlowPointBlocked(
      startX,
      startZ
    )
  ) {
    return [];
  }

  const points =
    [];

  let x =
    startX;

  let z =
    startZ;

  const direction =
    new THREE.Vector2();

  const stepLength =
    Math.min(
      state.cellWidthM,
      state.cellDepthM
    ) *
    0.34;

  const lift =
    Math.max(
      1.4,
      Math.min(
        state.cellWidthM,
        state.cellDepthM
      ) *
      0.12
    );

  const maximumSteps =
    Math.min(
      2400,
      state.resolution *
        14
    );

  let pathLength =
    0;


  for (
    let step = 0;
    step < maximumSteps;
    step++
  ) {
    const sample =
      sampleTerrainContinuous(
        x,
        z
      );

    if (
      !sample
    ) {
      break;
    }

    if (
      isFlowPointBlocked(
        x,
        z
      )
    ) {
      break;
    }


    points.push(
      new THREE.Vector3(
        x,
        sample.height +
          lift,
        z
      )
    );


    const downhill =
      new THREE.Vector2(
        -sample.gradientX,
        -sample.gradientZ
      );

    const gradientLength =
      downhill.length();

    if (
      gradientLength <
      0.000035 &&
      step > 30
    ) {
      break;
    }

    if (
      gradientLength >
      0.000001
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
        direction.lerp(
          downhill,
          0.13
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
        -state.widthM /
          2 ||
      nextX >
        state.widthM /
          2 ||
      nextZ <
        -state.depthM /
          2 ||
      nextZ >
        state.depthM /
          2
    ) {
      break;
    }

    if (
      isFlowPointBlocked(
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

    if (
      !nextSample
    ) {
      break;
    }

    const nextPoint =
      new THREE.Vector3(
        nextX,
        nextSample.height +
          lift,
        nextZ
      );

    if (
      wouldSelfIntersect(
        points,
        nextPoint
      )
    ) {
      break;
    }

    pathLength +=
      stepLength;

    x =
      nextX;

    z =
      nextZ;
  }

  if (
    pathLength <
    Math.min(
      state.widthM,
      state.depthM
    ) *
    0.025
  ) {
    return [];
  }

  return points;
}


function smoothFlowPath(
  points
) {
  if (
    points.length < 3
  ) {
    return points;
  }

  const curve =
    new THREE.CatmullRomCurve3(
      points,
      false,
      "centripetal",
      0.3
    );

  return curve.getPoints(
    Math.min(
      220,
      Math.max(
        40,
        points.length *
          2
      )
    )
  );
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

  if (
    !terrainState
  ) {
    return;
  }

  const random =
    mulberry32(
      flowSeed
    );

  const maximumPaths =
    110;

  const candidates =
    [];

  const spacing =
    Math.max(
      4,
      Math.floor(
        terrainState.resolution /
          12
      )
    );

  const seen =
    new Set();


  const addCandidate =
    (
      startX,
      startZ
    ) => {
      const path =
        integrateContinuousFlowPath(
          startX,
          startZ
        );

      if (
        path.length < 10
      ) {
        return;
      }

      const first =
        path[0];

      const last =
        path[
          path.length - 1
        ];

      const key =
        `${Math.round(
          first.x
        )}:` +
        `${Math.round(
          first.z
        )}:` +
        `${Math.round(
          last.x
        )}:` +
        `${Math.round(
          last.z
        )}`;

      if (
        seen.has(
          key
        )
      ) {
        return;
      }

      seen.add(
        key
      );

      candidates.push({
        path,

        score:
          path.length +
          random() *
          80
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
          terrainState.widthM /
            2 +
          (
            random() -
            0.5
          ) *
          terrainState.cellWidthM *
          2.5,

        (
          z + 0.5
        ) *
          terrainState.cellDepthM -
          terrainState.depthM /
            2 +
          (
            random() -
            0.5
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
      maximumPaths *
        55
  ) {
    attempts++;

    addCandidate(
      (
        random() -
        0.5
      ) *
      terrainState.widthM *
      0.96,

      (
        random() -
        0.5
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
        const smoothPoints =
          smoothFlowPath(
            candidate.path
          );

        if (
          smoothPoints.length < 6
        ) {
          return;
        }

        const line =
          createWideLine(
            smoothPoints,
            0x9bd1e5,
            2.5,
            0.9,
            false,
            80
          );

        if (
          line
        ) {
          flowGroup.add(
            line
          );
        }

        flowExportPaths.push(
          smoothPoints.map(
            (point) =>
              point.clone()
          )
        );
      }
    );

  updateFlowVisibility();
}


function updateFlowVisibility() {
  if (
    !flowGroup
  ) {
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
    !terrainState ||
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

  if (
    !container
  ) {
    return;
  }

  container.innerHTML =
    "";

  if (
    storedDesigns.length ===
    0
  ) {
    const empty =
      document.createElement(
        "div"
      );

    empty.className =
      "empty-comparison";

    empty.textContent =
      "No designs stored.";

    container.appendChild(
      empty
    );

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
   EXPORT SERIALISERS
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
      ].join(
        " "
      )
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
        mesh.vertices[
          index * 3
        ],

        mesh.vertices[
          index * 3 +
          1
        ],

        mesh.vertices[
          index * 3 +
          2
        ],

        mesh.colors[
          index * 3
        ],

        mesh.colors[
          index * 3 +
          1
        ],

        mesh.colors[
          index * 3 +
          2
        ]
      ].join(
        " "
      )
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
      triangleCount *
      50
    );

  const view =
    new DataView(
      buffer
    );

  const header =
    "Binary STL retained-water volume";


  for (
    let index = 0;
    index < 80;
    index++
  ) {
    view.setUint8(
      index,
      index < header.length
        ? header.charCodeAt(
            index
          )
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
        mesh.vertices[
          index * 3
        ],

        mesh.vertices[
          index * 3 +
          1
        ],

        mesh.vertices[
          index * 3 +
          2
        ]
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

      offset +=
        4;

      view.setFloat32(
        offset,
        normal.y,
        true
      );

      offset +=
        4;

      view.setFloat32(
        offset,
        normal.z,
        true
      );

      offset +=
        4;


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

          offset +=
            4;

          view.setFloat32(
            offset,
            vertex.y,
            true
          );

          offset +=
            4;

          view.setFloat32(
            offset,
            vertex.z,
            true
          );

          offset +=
            4;
        }
      );

      view.setUint16(
        offset,
        0,
        true
      );

      offset +=
        2;
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
          [
            data
          ],
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

  link.setAttribute(
    "download",
    filename
  );

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
   DOWNLOADS
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

  try {
    setStatus(
      "BUILDING WATER EXPORT"
    );

    const mesh =
      buildVoxelWaterVolumeMesh(
        currentResult
      );

    if (
      mesh.triangles.length ===
      0
    ) {
      throw new Error(
        "The retained-water geometry contains no triangles."
      );
    }

    const isPly =
      format ===
      "ply";

    const extension =
      isPly
        ? "ply"
        : "stl";

    const filename =
      `${terrainFilenameSlug()}-retained-water.${extension}`;

    const data =
      isPly
        ? serializePly(
            mesh
          )
        : serializeStl(
            mesh
          );

    downloadBlob(
      data,
      filename,
      isPly
        ? "application/octet-stream"
        : "model/stl"
    );

    setStatus(
      `${extension.toUpperCase()} DOWNLOADED`
    );
  } catch (
    error
  ) {
    console.error(
      error
    );

    setStatus(
      "EXPORT ERROR"
    );

    alert(
      `Water export failed.\n\n${error.message}`
    );
  }
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
      if (
        path.length < 2
      ) {
        return;
      }

      lines.push(
        `o flow_${String(
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
        [];

      for (
        let index = 0;
        index < path.length;
        index++
      ) {
        indices.push(
          vertexIndex +
          index
        );
      }

      lines.push(
        `l ${indices.join(
          " "
        )}`
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
    alert(
      "There is currently no slope-orientation layer to export."
    );

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
    alert(
      "There is currently no slope-steepness layer to export."
    );

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
    alert(
      "There is currently no watershed layer to export."
    );

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
  if (
    !renderer
  ) {
    return;
  }

  renderer.render(
    scene,
    camera
  );

  renderer.domElement.toBlob(
    (blob) => {
      if (
        !blob
      ) {
        alert(
          "The viewer image could not be created."
        );

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
    !terrainState ||
    !currentResult
  ) {
    alert(
      "There is no terrain loaded."
    );

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
    [];

  rows.push([
    "record_type",
    "design",
    "topography",
    "rainfall_L_per_m2",
    "rainfall_mm",
    "projected_area_m2",
    "total_rainfall_m3",
    "total_rainfall_l",
    "retained_volume_m3",
    "retained_volume_l",
    "runoff_volume_m3",
    "runoff_volume_l",
    "retention_percent",
    "basin_index",
    "basin_area_m2",
    "basin_max_depth_m",
    "basin_water_level_m",
    "basin_inflow_m3",
    "basin_retained_m3",
    "basin_spill_m3",
    "basin_retained_l",
    "centroid_x_m",
    "centroid_y_m",
    "centroid_z_m"
  ]);


  designs.forEach(
    (design) => {
      rows.push([
        "summary",
        design.name,
        design.terrainName,
        design.rainfallLPerM2,
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
            design.rainfallLPerM2,
            design.terrainAreaM2,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            basin.basinIndex,
            basin.areaM2,
            basin.maximumDepthM,
            basin.waterLevel,
            basin.inflowVolumeM3,
            basin.retainedVolumeM3,
            basin.spillVolumeM3,
            basin.retainedVolumeL,
            basin.x,
            basin.y,
            basin.z
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
            .join(
              ","
            )
      )
      .join(
        "\n"
      );

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


      if (
        index
      ) {
        for (
          let i = 0;
          i < index.count;
          i += 3
        ) {
          if (
            i + 2 >=
            index.count
          ) {
            break;
          }

          triangles.push([
            readVertex(
              index.getX(
                i
              )
            ),

            readVertex(
              index.getX(
                i + 1
              )
            ),

            readVertex(
              index.getX(
                i + 2
              )
            )
          ]);
        }
      } else {
        for (
          let i = 0;
          i < position.count;
          i += 3
        ) {
          if (
            i + 2 >=
            position.count
          ) {
            break;
          }

          triangles.push([
            readVertex(
              i
            ),

            readVertex(
              i + 1
            ),

            readVertex(
              i + 2
            )
          ]);
        }
      }
    }
  );

  return triangles;
}


async function loadModelFile(
  file
) {
  const filename =
    file.name.toLowerCase();

  const extension =
    filename.split(
      "."
    ).pop();

  if (
    ![
      "ply",
      "stl",
      "obj"
    ].includes(
      extension
    )
  ) {
    alert(
      "Please upload a PLY, STL or OBJ file."
    );

    return;
  }


  try {
    setStatus(
      "LOADING MODEL"
    );

    let object;


    if (
      extension ===
      "obj"
    ) {
      const text =
        await file.text();

      object =
        new OBJLoader().parse(
          text
        );
    } else {
      const buffer =
        await file.arrayBuffer();

      const geometry =
        extension ===
        "ply"
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


    const triangles =
      collectTrianglesFromObject(
        object
      );

    if (
      triangles.length ===
      0
    ) {
      throw new Error(
        "No triangles were found in the model."
      );
    }

    rawTriangles =
      triangles;

    proceduralSeed =
      null;

    currentTerrainName =
      file.name.replace(
        /\.[^/.]+$/,
        ""
      );

    $("designName").value =
      currentTerrainName;


    object.traverse(
      (child) => {
        if (
          child.isMesh &&
          child.geometry
        ) {
          child.geometry.dispose();
        }
      }
    );

    buildUploadedTerrain();

    setStatus(
      "READY"
    );
  } catch (
    error
  ) {
    console.error(
      error
    );

    setStatus(
      "MODEL ERROR"
    );

    alert(
      `Could not load the model.\n\n${error.message}`
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
