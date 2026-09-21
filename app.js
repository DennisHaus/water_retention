import * as THREE from "three";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

import {
  CSS2DRenderer,
  CSS2DObject
} from "three/addons/renderers/CSS2DRenderer.js";


/* --------------------------------------------------
   HELPERS
-------------------------------------------------- */

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

  if (
    !element
  ) {
    return 0;
  }

  const value =
    Number(
      element.value
    );

  return Number.isFinite(value)
    ? value
    : 0;
};


const degreesToRadians = (
  degrees
) => {
  return degrees * Math.PI / 180;
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


const formatInteger = (
  value
) => {
  return Math.round(
    Number(value)
  ).toLocaleString("en-US");
};


const formatVolume = (
  volumeM3
) => {
  if (
    volumeM3 < 1
  ) {
    return `${formatInteger(volumeM3 * 1000)} L`;
  }

  return `${formatNumber(volumeM3, 2)} m³`;
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
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
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
    return `"${stringValue.replaceAll(
      '"',
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


/* --------------------------------------------------
   CONSTANTS
-------------------------------------------------- */

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


/* --------------------------------------------------
   PRIORITY QUEUE
-------------------------------------------------- */

class MinHeap {
  constructor() {
    this.items =
      [];
  }

  get size() {
    return this.items.length;
  }

  push(
    item
  ) {
    const array =
      this.items;

    array.push(
      item
    );

    let index =
      array.length - 1;

    while (
      index > 0
    ) {
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

    if (
      array.length === 0
    ) {
      return null;
    }

    const first =
      array[0];

    const last =
      array.pop();

    if (
      array.length === 0
    ) {
      return first;
    }

    let index =
      0;

    while (
      true
    ) {
      const left =
        index * 2 + 1;

      if (
        left >= array.length
      ) {
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


/* --------------------------------------------------
   GLOBAL STATE
-------------------------------------------------- */

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
let flowParticleMesh;

let terrainState =
  null;

let rawTriangles =
  null;

let currentTerrainName =
  "GENERATED ALPINE BASIN";

let currentResult =
  null;

let storedDesigns =
  [];

let displayedRainfall =
  numberValue(
    "rainfallPerM2"
  );

let proceduralSeed =
  null;

let flowSeed =
  1;

let flowParticleData =
  [];

let flowExportPaths =
  [];


/* --------------------------------------------------
   SCENE
-------------------------------------------------- */

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
      5000
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

  labelRenderer.setSize(
    $("viewer").clientWidth,
    $("viewer").clientHeight
  );

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
    "organic-flow-lines";

  world.add(
    flowGroup
  );


  window.addEventListener(
    "resize",
    resizeRenderer
  );

  resizeRenderer();
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
    viewer.clientWidth;

  const height =
    viewer.clientHeight;

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
}


/* --------------------------------------------------
   INPUT BINDING
-------------------------------------------------- */

function bindPair(
  rangeId,
  numberId,
  callback,
  eventName = "change"
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
        Number(rawValue);

      if (
        !Number.isFinite(value)
      ) {
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
    eventName,
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
        event.key === "Enter"
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
      String(value);
  }

  if (
    number
  ) {
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
      if (
        world
      ) {
        world.scale.y =
          value;
      }

      updateCameraTarget();
    },
    "input"
  );


  $("showFlow").addEventListener(
    "change",
    updateFlowVisibility
  );


  $("showWaterLabels").addEventListener(
    "change",
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


  $("clearWaterButton").addEventListener(
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


  $("resetViewButton").addEventListener(
    "click",
    frameCamera
  );


  $("newTerrainButton").addEventListener(
    "click",
    () => {
      rawTriangles =
        null;

      buildProceduralTerrain(
        true
      );
    }
  );


  $("resetModelOrientationButton").addEventListener(
    "click",
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


  $("storeDesignButton").addEventListener(
    "click",
    storeCurrentDesign
  );


  $("clearDesignsButton").addEventListener(
    "click",
    () => {
      storedDesigns =
        [];

      renderDesignComparison();
    }
  );


  $("downloadRetentionButton").addEventListener(
    "click",
    downloadRetentionCsv
  );


  $("downloadWaterPlyButton").addEventListener(
    "click",
    () => {
      downloadWaterVolume(
        "ply"
      );
    }
  );


  $("downloadWaterStlButton").addEventListener(
    "click",
    () => {
      downloadWaterVolume(
        "stl"
      );
    }
  );


  $("downloadViewerPngButton").addEventListener(
    "click",
    downloadViewerPng
  );


  $("downloadFlowObjButton").addEventListener(
    "click",
    downloadFlowLinesObj
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


  $("dropZone").addEventListener(
    "dragover",
    (event) => {
      event.preventDefault();

      $("dropZone").classList.add(
        "drag-over"
      );
    }
  );


  $("dropZone").addEventListener(
    "dragleave",
    () => {
      $("dropZone").classList.remove(
        "drag-over"
      );
    }
  );


  $("dropZone").addEventListener(
    "drop",
    async (event) => {
      event.preventDefault();

      $("dropZone").classList.remove(
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


/* --------------------------------------------------
   PROCEDURAL TERRAIN
-------------------------------------------------- */

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

  const terrain =
    generateProceduralHeightfield(
      resolution,
      proceduralSeed
    );

  const terrainName =
    `GENERATED TERRAIN ` +
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


function generateProceduralHeightfield(
  resolution,
  seed
) {
  const random =
    mulberry32(
      seed
    );

  const widthM =
    1100 +
    random() * 500;

  const depthM =
    850 +
    random() * 350;

  const heights =
    new Float32Array(
      resolution *
      resolution
    );


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

  const valleyAngle =
    random() *
    Math.PI *
    2;

  const basinCount =
    2 +
    Math.floor(
      random() * 3
    );

  const basins =
    [];

  for (
    let index = 0;
    index < basinCount;
    index++
  ) {
    basins.push({
      x:
        -widthM * 0.28 +
        random() *
          widthM * 0.56,

      z:
        -depthM * 0.18 +
        random() *
          depthM * 0.42,

      radiusX:
        100 +
        random() * 180,

      radiusZ:
        90 +
        random() * 160,

      depth:
        55 +
        random() * 125,

      ring:
        18 +
        random() * 34
    });
  }


  const damCount =
    1 +
    Math.floor(
      random() * 3
    );

  const dams =
    [];

  for (
    let index = 0;
    index < damCount;
    index++
  ) {
    dams.push({
      orientation:
        random() > 0.5
          ? "x"
          : "z",

      position:
        random() * 300 -
        150,

      height:
        25 +
        random() * 65,

      width:
        280 +
        random() * 380,

      thickness:
        16 +
        random() * 28
    });
  }


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


      let height =
        90;

      height +=
        0.075 *
        (
          valleyZ +
          depthM / 2
        );

      height +=
        70 *
        Math.pow(
          Math.abs(
            valleyX /
            (widthM / 2)
          ),
          1.65
        );

      height +=
        35 *
        Math.pow(
          Math.abs(
            valleyZ /
            (depthM / 2)
          ),
          2.1
        );


      height +=
        15 *
        Math.sin(
          normalizedX * 5.4 +
          normalizedZ * 2.1 +
          phaseA
        );

      height +=
        11 *
        Math.cos(
          normalizedZ * 7.1 -
          normalizedX * 3.3 +
          phaseB
        );

      height +=
        7 *
        Math.sin(
          normalizedX * 14 +
          normalizedZ * 8 +
          phaseC
        );


      for (
        const basin of basins
      ) {
        const distance =
          Math.pow(
            (
              localX -
              basin.x
            ) /
            basin.radiusX,
            2
          ) +
          Math.pow(
            (
              localZ -
              basin.z
            ) /
            basin.radiusZ,
            2
          );

        height -=
          basin.depth *
          Math.exp(
            -0.5 *
            distance
          );

        const radialDistance =
          Math.sqrt(
            distance
          );

        height +=
          basin.ring *
          Math.exp(
            -Math.pow(
              (
                radialDistance -
                1
              ) /
              0.16,
              2
            )
          );
      }


      for (
        const dam of dams
      ) {
        let distance;
        let longitudinal;

        if (
          dam.orientation === "x"
        ) {
          distance =
            Math.abs(
              localZ -
              dam.position
            );

          longitudinal =
            Math.abs(
              localX
            );
        } else {
          distance =
            Math.abs(
              localX -
              dam.position
            );

          longitudinal =
            Math.abs(
              localZ
            );
        }

        const extent =
          Math.max(
            0,
            1 -
            Math.pow(
              longitudinal /
              dam.width,
              4
            )
          );

        height +=
          dam.height *
          Math.exp(
            -Math.pow(
              distance /
              dam.thickness,
              2
            )
          ) *
          extent;
      }

      heights[
        z *
        resolution +
        x
      ] =
        height;
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


/* --------------------------------------------------
   MODEL IMPORT
-------------------------------------------------- */

function rebuildUploadedTerrainIfAvailable() {
  if (
    !rawTriangles ||
    rawTriangles.length === 0
  ) {
    return;
  }

  buildUploadedTerrain();
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
  } catch (error) {
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

  const transformed =
    [];

  for (
    const triangle of triangles
  ) {
    const outputTriangle =
      [];

    for (
      const point of triangle
    ) {
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

      outputTriangle.push([
        vector.x,
        vector.y,
        vector.z
      ]);
    }

    transformed.push(
      outputTriangle
    );
  }

  return transformed;
}


function rasterizeTrianglesToHeightfield(
  triangles,
  resolution
) {
  if (
    !triangles ||
    triangles.length === 0
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
    !Number.isFinite(widthM) ||
    !Number.isFinite(depthM) ||
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
      ) &&
      heights[index] !==
        -Infinity
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


/* --------------------------------------------------
   HYDROLOGY
-------------------------------------------------- */

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

        const distance =
          Math.hypot(
            dx,
            dz
          );

        const slope =
          difference /
          distance;

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
      resolved === -2
    ) {
      resolved =
        current;
    }

    for (
      const index of path
    ) {
      terminals[index] =
        resolved;
    }
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
    const sinkHeight =
      state.heights[sinkIndex];

    let outletCrest =
      Infinity;

    let outletFrom =
      -1;

    let outletTo =
      -1;

    let destinationTerminal =
      -1;


    /*
     * Find the lowest edge outside the
     * sink catchment that can act as a
     * spill route.
     */
    const catchmentSet =
      new Set(
        catchmentCells
      );

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


    /*
     * The retained footprint is the
     * portion of the catchment below
     * the spill contour.
     */
    const depressionCells =
      catchmentCells.filter(
        (index) =>
          state.heights[index] <=
          outletCrest + 0.0001
      );


    if (
      depressionCells.length === 0
    ) {
      depressionCells.push(
        sinkIndex
      );
    }


    let minimumHeight =
      sinkHeight;

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


  const sinkToBasin =
    new Map();

  basins.forEach(
    (basin, index) => {
      sinkToBasin.set(
        basin.sinkIndex,
        index
      );
    }
  );


  basins.forEach(
    (basin, index) => {
      if (
        basin.destinationTerminal >= 0
      ) {
        basin.destinationIndex =
          sinkToBasin.get(
            basin.destinationTerminal
          ) ?? -1;
      }

      if (
        basin.destinationIndex ===
        index
      ) {
        basin.destinationIndex =
          -1;
      }
    }
  );

  return basins;
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
      indegree[index] === 0
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

    for (
      const destination of outgoing[index]
    ) {
      indegree[destination]--;

      if (
        indegree[destination] === 0
      ) {
        queue.push(
          destination
        );
      }
    }
  }


  if (
    order.length < basins.length
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
      ) / 2;

    let volumeM3 =
      0;

    for (
      const index of basin.cells
    ) {
      const depth =
        Math.max(
          0,
          middle -
          state.heights[index]
        );

      volumeM3 +=
        depth *
        state.cellAreaM2;
    }

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

  for (
    const index of basin.cells
  ) {
    const depth =
      Math.max(
        0,
        waterLevel -
        state.heights[index]
      );

    retainedVolumeM3 +=
      depth *
      state.cellAreaM2;
  }

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
  const state =
    terrainState;

  if (
    !state
  ) {
    return null;
  }

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


  /*
   * Rainfall falling across every basin
   * catchment enters that basin.
   */
  for (
    let basinIndex = 0;
    basinIndex <
      state.basinDefinitions.length;
    basinIndex++
  ) {
    const basin =
      state.basinDefinitions[
        basinIndex
      ];

    incoming[basinIndex] =
      basin.catchmentCells.length *
      state.cellAreaM2 *
      rainfallDepthM;
  }


  const resultBasins =
    [];


  /*
   * Process upstream basins first.
   */
  for (
    const basinIndex of state.basinProcessingOrder
  ) {
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

    let maximumDepthM =
      0;

    let weightedX =
      0;

    let weightedY =
      0;

    let weightedZ =
      0;


    for (
      const index of basin.cells
    ) {
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

      maximumDepthM =
        Math.max(
          maximumDepthM,
          depthM
        );

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

      const cellVolumeM3 =
        depthM *
        state.cellAreaM2;

      weightedX +=
        localX *
        cellVolumeM3;

      weightedY +=
        (
          state.heights[index] +
          depthM / 2
        ) *
        cellVolumeM3;

      weightedZ +=
        localZ *
        cellVolumeM3;
    }


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
      maximumDepthM,

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


    /*
     * Pass excess water to the next
     * basin. Anything without a basin
     * destination becomes runoff.
     */
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


/*
  This function is intentionally defined
  before the initialisation call at the end.
*/
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

  const terminals =
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

    flowTerminals:
      terminals
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

  state.basinDefinitions =
    buildBasinDefinitions(
      state
    );

  state.basinProcessingOrder =
    getBasinProcessingOrder(
      state.basinDefinitions
    );

  terrainState =
    state;

  currentTerrainName =
    terrainName;

  flowSeed =
    newRandomSeed();

  rebuildTerrainMesh();
  ensureWaterMesh();
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


/* --------------------------------------------------
   TERRAIN MESH
-------------------------------------------------- */

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
        widthM / 2;

      const localZ =
        (
          z + 0.5
        ) *
        terrainState.cellDepthM -
        depthM / 2;

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
        a + resolution;

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
        color: 0x51595c,
        roughness: 0.95,
        metalness: 0.02
      })
    );

  terrainMesh.name =
    "terrain";

  world.add(
    terrainMesh
  );
}


/* --------------------------------------------------
   SMOOTH WATER
-------------------------------------------------- */

function ensureWaterMesh() {
  disposeWaterMesh();

  waterMesh =
    new THREE.Group();

  waterMesh.name =
    "smooth-retained-water";

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

  waterMesh.traverse(
    (object) => {
      if (
        object.geometry
      ) {
        object.geometry.dispose();
      }

      if (
        object.material
      ) {
        if (
          Array.isArray(
            object.material
          )
        ) {
          object.material.forEach(
            (material) =>
              material.dispose()
          );
        } else {
          object.material.dispose();
        }
      }
    }
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


function cellCornerKey(
  x,
  z
) {
  return `${x}:${z}`;
}


function directedEdgeKey(
  a,
  b
) {
  return (
    `${cellCornerKey(a[0], a[1])}>` +
    `${cellCornerKey(b[0], b[1])}`
  );
}


function buildBoundaryLoopsForCells(
  cells
) {
  const directedEdges =
    new Map();


  const addEdge =
    (a, b) => {
      const forward =
        directedEdgeKey(
          a,
          b
        );

      const reverse =
        directedEdgeKey(
          b,
          a
        );

      if (
        directedEdges.has(
          reverse
        )
      ) {
        directedEdges.delete(
          reverse
        );
      } else {
        directedEdges.set(
          forward,
          {
            a: [...a],
            b: [...b]
          }
        );
      }
    };


  for (
    const index of cells
  ) {
    const x =
      index %
      terrainState.resolution;

    const z =
      Math.floor(
        index /
        terrainState.resolution
      );

    addEdge(
      [x, z],
      [x + 1, z]
    );

    addEdge(
      [x + 1, z],
      [x + 1, z + 1]
    );

    addEdge(
      [x + 1, z + 1],
      [x, z + 1]
    );

    addEdge(
      [x, z + 1],
      [x, z]
    );
  }


  const edges =
    Array.from(
      directedEdges.values()
    );

  const outgoing =
    new Map();

  edges.forEach(
    (edge) => {
      const key =
        cellCornerKey(
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
      cellCornerKey(
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

      loop.push(
        [...current.a]
      );

      const nextKey =
        cellCornerKey(
          current.b[0],
          current.b[1]
        );

      if (
        nextKey === startKey
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
        ) || null;
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


function smoothClosedLoop(
  points,
  iterations = 2
) {
  let current =
    points.map(
      (point) =>
        point.clone()
    );

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
      const a =
        current[index];

      const b =
        current[
          (
            index + 1
          ) %
          current.length
        ];

      const q =
        new THREE.Vector3()
          .lerpVectors(
            a,
            b,
            0.24
          );

      const r =
        new THREE.Vector3()
          .lerpVectors(
            a,
            b,
            0.76
          );

      next.push(
        q,
        r
      );
    }

    current =
      next;
  }

  return current;
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

  return area / 2;
}


function getSmoothedPondLoops(
  result,
  basin
) {
  const wetCells =
    basin.cells.filter(
      (index) =>
        result.waterDepth[index] >
        0.0001
    );

  if (
    wetCells.length < 3
  ) {
    return [];
  }

  const rawLoops =
    buildBoundaryLoopsForCells(
      wetCells
    );

  const loops =
    [];


  for (
    const rawLoop of rawLoops
  ) {
    const worldLoop =
      rawLoop.map(
        (corner) =>
          new THREE.Vector3(
            corner[0] *
              result.cellWidthM -
              result.widthM / 2,

            0,

            corner[1] *
              result.cellDepthM -
              result.depthM / 2
          )
      );

    let smoothed =
      smoothClosedLoop(
        worldLoop,
        2
      );

    if (
      smoothed.length < 3
    ) {
      continue;
    }

    if (
      Math.abs(
        polygonArea(
          smoothed
        )
      ) < 1
    ) {
      continue;
    }

    if (
      polygonArea(
        smoothed
      ) < 0
    ) {
      smoothed =
        smoothed.reverse();
    }

    loops.push(
      smoothed
    );
  }

  return loops;
}


function createWaterSurfaceMesh(
  points,
  waterLevel
) {
  if (
    points.length < 3
  ) {
    return null;
  }

  const shape =
    new THREE.Shape();

  shape.moveTo(
    points[0].x,
    points[0].z
  );

  for (
    let index = 1;
    index < points.length;
    index++
  ) {
    shape.lineTo(
      points[index].x,
      points[index].z
    );
  }

  shape.closePath();


  const geometry =
    new THREE.ShapeGeometry(
      shape
    );

  const position =
    geometry.attributes.position;

  for (
    let index = 0;
    index < position.count;
    index++
  ) {
    const x =
      position.getX(
        index
      );

    const z =
      position.getY(
        index
      );

    position.setXYZ(
      index,
      x,
      waterLevel + 0.04,
      z
    );
  }

  position.needsUpdate =
    true;

  geometry.computeVertexNormals();


  const material =
    new THREE.MeshPhysicalMaterial({
      color: 0x7897aa,
      transparent: true,
      opacity:
        numberValue(
          "waterOpacity"
        ),
      roughness: 0.14,
      metalness: 0.04,
      clearcoat: 0.48,
      clearcoatRoughness: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide
    });

  const surface =
    new THREE.Mesh(
      geometry,
      material
    );

  surface.renderOrder =
    10;


  const outlinePoints =
    points.map(
      (point) =>
        new THREE.Vector3(
          point.x,
          waterLevel + 0.25,
          point.z
        )
    );

  outlinePoints.push(
    outlinePoints[0].clone()
  );

  const outlineGeometry =
    new THREE.BufferGeometry()
      .setFromPoints(
        outlinePoints
      );

  const outlineMaterial =
    new THREE.LineBasicMaterial({
      color: 0xa9c7d8,
      transparent: true,
      opacity: 0.38,
      depthTest: false,
      depthWrite: false
    });

  const outline =
    new THREE.Line(
      outlineGeometry,
      outlineMaterial
    );

  outline.renderOrder =
    12;


  const group =
    new THREE.Group();

  group.add(
    surface
  );

  group.add(
    outline
  );

  return group;
}


function updateWaterVisualization(
  result
) {
  if (
    !waterMesh
  ) {
    return;
  }

  while (
    waterMesh.children.length > 0
  ) {
    const child =
      waterMesh.children[
        waterMesh.children.length - 1
      ];

    waterMesh.remove(
      child
    );

    child.traverse(
      (object) => {
        if (
          object.geometry
        ) {
          object.geometry.dispose();
        }

        if (
          object.material
        ) {
          if (
            Array.isArray(
              object.material
            )
          ) {
            object.material.forEach(
              (material) =>
                material.dispose()
            );
          } else {
            object.material.dispose();
          }
        }
      }
    );
  }


  for (
    const basin of result.basins
  ) {
    if (
      basin.retainedVolumeM3 <=
      0.0001
    ) {
      continue;
    }

    const loops =
      getSmoothedPondLoops(
        result,
        basin
      );

    for (
      const loop of loops
    ) {
      const surface =
        createWaterSurfaceMesh(
          loop,
          basin.waterLevel
        );

      if (
        surface
      ) {
        waterMesh.add(
          surface
        );
      }
    }
  }

  updateWaterOpacity(
    numberValue(
      "waterOpacity"
    )
  );
}


/* --------------------------------------------------
   READOUTS
-------------------------------------------------- */

function clearBasinLabels() {
  while (
    labelGroup.children.length > 0
  ) {
    const child =
      labelGroup.children[
        labelGroup.children.length - 1
      ];

    labelGroup.remove(
      child
    );
  }
}


function updateBasinLabels(
  result
) {
  clearBasinLabels();

  labelGroup.visible =
    $("showWaterLabels").checked;

  if (
    !labelGroup.visible
  ) {
    return;
  }

  const basins =
    result.basins.filter(
      (basin) =>
        basin.retainedVolumeM3 >
        0.0001
    );


  basins
    .slice(
      0,
      12
    )
    .forEach(
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
          basin.y + 0.8,
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


  const basinReadout =
    $("basinReadout");

  basinReadout.innerHTML =
    "";

  const visibleBasins =
    result.basins.filter(
      (basin) =>
        basin.retainedVolumeM3 >
        0.0001
    );

  if (
    visibleBasins.length === 0
  ) {
    basinReadout.textContent =
      "No retained water.";

    return;
  }

  visibleBasins
    .slice(
      0,
      20
    )
    .forEach(
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
  updateFlowParticles();
  updateTerrainName();
}


/* --------------------------------------------------
   CAMERA
-------------------------------------------------- */

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

  const scale =
    numberValue(
      "verticalExaggeration"
    );

  controls.target.set(
    0,
    terrainState.maximumHeight *
      scale *
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


/* --------------------------------------------------
   CONTINUOUS FLOWLINES
-------------------------------------------------- */

function sampleTerrainContinuous(
  localX,
  localZ
) {
  const state =
    terrainState;

  const gridX =
    (
      localX +
      state.widthM / 2
    ) /
    state.cellWidthM -
    0.5;

  const gridZ =
    (
      localZ +
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
    (x, z) => {
      const clampedX =
        clamp(
          x,
          0,
          state.resolution - 1
        );

      const clampedZ =
        clamp(
          z,
          0,
          state.resolution - 1
        );

      const x0 =
        Math.floor(
          clampedX
        );

      const z0 =
        Math.floor(
          clampedZ
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
        clampedX - x0;

      const fz =
        clampedZ - z0;

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


function integrateContinuousFlowPath(
  startX,
  startZ
) {
  const state =
    terrainState;

  const points =
    [];

  let x =
    startX;

  let z =
    startZ;

  const direction =
    new THREE.Vector2();

  const stepLength =
    Math.max(
      state.cellWidthM,
      state.cellDepthM
    ) *
    0.42;

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
      600,
      state.resolution * 4
    );


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

    points.push(
      new THREE.Vector3(
        x,
        sample.height + lift,
        z
      )
    );


    const downhill =
      new THREE.Vector2(
        -sample.gradientX,
        -sample.gradientZ
      );

    const slope =
      downhill.length();

    if (
      slope < 0.0008
    ) {
      break;
    }

    downhill.normalize();

    if (
      direction.lengthSq() === 0
    ) {
      direction.copy(
        downhill
      );
    } else {
      direction.lerp(
        downhill,
        0.42
      );

      direction.normalize();
    }

    x +=
      direction.x *
      stepLength;

    z +=
      direction.y *
      stepLength;


    const outside =
      x <
        -state.widthM / 2 ||
      x >
        state.widthM / 2 ||
      z <
        -state.depthM / 2 ||
      z >
        state.depthM / 2;

    if (
      outside
    ) {
      break;
    }
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
      0.18
    );

  return curve.getPoints(
    Math.min(
      100,
      Math.max(
        20,
        points.length * 2
      )
    )
  );
}


function buildFlowPathData(
  points
) {
  const cumulativeDistances =
    [0];

  let totalLength =
    0;

  for (
    let index = 1;
    index < points.length;
    index++
  ) {
    totalLength +=
      points[index].distanceTo(
        points[index - 1]
      );

    cumulativeDistances.push(
      totalLength
    );
  }

  return {
    points,
    cumulativeDistances,
    totalLength
  };
}


function sampleFlowPath(
  pathData,
  distance,
  target
) {
  if (
    !pathData ||
    pathData.points.length < 2 ||
    pathData.totalLength <= 0
  ) {
    return;
  }

  let localDistance =
    distance %
    pathData.totalLength;

  if (
    localDistance < 0
  ) {
    localDistance +=
      pathData.totalLength;
  }

  let segment =
    0;

  while (
    segment <
      pathData.cumulativeDistances.length - 2 &&
    pathData.cumulativeDistances[
      segment + 1
    ] < localDistance
  ) {
    segment++;
  }

  const startDistance =
    pathData.cumulativeDistances[
      segment
    ];

  const endDistance =
    pathData.cumulativeDistances[
      segment + 1
    ];

  const segmentLength =
    endDistance -
    startDistance;

  const amount =
    segmentLength > 0
      ? (
          localDistance -
          startDistance
        ) /
        segmentLength
      : 0;

  target.lerpVectors(
    pathData.points[segment],
    pathData.points[segment + 1],
    amount
  );
}


function clearFlowVisualization() {
  if (
    !flowGroup
  ) {
    return;
  }

  while (
    flowGroup.children.length > 0
  ) {
    const child =
      flowGroup.children[
        flowGroup.children.length - 1
      ];

    flowGroup.remove(
      child
    );

    child.traverse(
      (object) => {
        if (
          object.geometry
        ) {
          object.geometry.dispose();
        }

        if (
          object.material
        ) {
          if (
            Array.isArray(
              object.material
            )
          ) {
            object.material.forEach(
              (material) =>
                material.dispose()
            );
          } else {
            object.material.dispose();
          }
        }
      }
    );
  }

  flowParticleMesh =
    null;

  flowParticleData =
    [];

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

  const seen =
    new Set();

  const gridSpacing =
    Math.max(
      3,
      Math.floor(
        terrainState.resolution /
        12
      )
    );


  /*
   * Regularly distributed seed paths
   * with small random offsets.
   */
  for (
    let z = 2;
    z < terrainState.resolution - 2;
    z += gridSpacing
  ) {
    for (
      let x = 2;
      x < terrainState.resolution - 2;
      x += gridSpacing
    ) {
      const jitterX =
        (
          random() - 0.5
        ) *
        terrainState.cellWidthM *
        2.4;

      const jitterZ =
        (
          random() - 0.5
        ) *
        terrainState.cellDepthM *
        2.4;

      const startX =
        (
          x + 0.5
        ) *
        terrainState.cellWidthM -
        terrainState.widthM / 2 +
        jitterX;

      const startZ =
        (
          z + 0.5
        ) *
        terrainState.cellDepthM -
        terrainState.depthM / 2 +
        jitterZ;

      const path =
        integrateContinuousFlowPath(
          startX,
          startZ
        );

      if (
        path.length < 5
      ) {
        continue;
      }

      const first =
        path[0];

      const last =
        path[path.length - 1];

      const key =
        `${Math.round(first.x)}:` +
        `${Math.round(first.z)}:` +
        `${Math.round(last.x)}:` +
        `${Math.round(last.z)}`;

      if (
        seen.has(
          key
        )
      ) {
        continue;
      }

      seen.add(
        key
      );

      candidates.push({
        path,

        score:
          path.length +
          random() * 50
      });
    }
  }


  /*
   * Supplement with random paths if
   * the terrain produces too many short
   * gradient paths.
   */
  let attempts =
    0;

  while (
    candidates.length <
      maximumPaths &&
    attempts <
      maximumPaths * 20
  ) {
    attempts++;

    const startX =
      (
        random() - 0.5
      ) *
      terrainState.widthM *
      0.92;

    const startZ =
      (
        random() - 0.5
      ) *
      terrainState.depthM *
      0.92;

    const path =
      integrateContinuousFlowPath(
        startX,
        startZ
      );

    if (
      path.length < 5
    ) {
      continue;
    }

    candidates.push({
      path,

      score:
        path.length +
        random() * 40
    });
  }


  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );


  const selected =
    candidates.slice(
      0,
      maximumPaths
    );


  for (
    const candidate of selected
  ) {
    const smoothPoints =
      smoothFlowPath(
        candidate.path
      );

    if (
      smoothPoints.length < 2
    ) {
      continue;
    }

    const curve =
      new THREE.CatmullRomCurve3(
        smoothPoints,
        false,
        "centripetal",
        0.16
      );

    const visiblePoints =
      curve.getPoints(
        Math.min(
          100,
          Math.max(
            20,
            smoothPoints.length * 2
          )
        )
      );

    flowExportPaths.push(
      visiblePoints.map(
        (point) =>
          point.clone()
      )
    );


    const tubeGeometry =
      new THREE.TubeGeometry(
        curve,
        Math.min(
          80,
          Math.max(
            20,
            visiblePoints.length
          )
        ),
        Math.max(
          0.8,
          Math.min(
            terrainState.cellWidthM,
            terrainState.cellDepthM
          ) *
          0.022
        ),
        5,
        false
      );

    const tubeMaterial =
      new THREE.MeshBasicMaterial({
        color: 0x78a9c8,
        transparent: true,
        opacity: 0.68,
        depthTest: false,
        depthWrite: false
      });

    const tube =
      new THREE.Mesh(
        tubeGeometry,
        tubeMaterial
      );

    tube.name =
      "organic-flow-line";

    tube.renderOrder =
      20;

    flowGroup.add(
      tube
    );


    if (
      flowParticleData.length <
      260
    ) {
      flowParticleData.push({
        pathData:
          buildFlowPathData(
            visiblePoints
          ),

        phase:
          random(),

        speed:
          Math.max(
            terrainState.cellWidthM,
            terrainState.cellDepthM
          ) *
          (
            0.45 +
            random() *
            1.1
          )
      });
    }
  }


  if (
    flowParticleData.length > 0
  ) {
    const particleGeometry =
      new THREE.SphereGeometry(
        Math.max(
          0.9,
          Math.min(
            terrainState.cellWidthM,
            terrainState.cellDepthM
          ) *
          0.11
        ),
        8,
        6
      );

    const particleMaterial =
      new THREE.MeshBasicMaterial({
        color: 0xa4c9db,
        transparent: true,
        opacity: 0.86,
        depthTest: false,
        depthWrite: false
      });

    flowParticleMesh =
      new THREE.InstancedMesh(
        particleGeometry,
        particleMaterial,
        flowParticleData.length
      );

    flowParticleMesh.name =
      "moving-flow-particles";

    flowParticleMesh.frustumCulled =
      false;

    flowParticleMesh.renderOrder =
      25;

    flowGroup.add(
      flowParticleMesh
    );
  }

  updateFlowVisibility();
}


function updateFlowVisibility() {
  if (
    !flowGroup
  ) {
    return;
  }

  flowGroup.visible =
    $("showFlow").checked;
}


function updateFlowParticles() {
  if (
    !flowParticleMesh
  ) {
    return;
  }

  const visible =
    $("showFlow").checked &&
    displayedRainfall > 0.0001;

  flowParticleMesh.visible =
    visible;

  if (
    !visible
  ) {
    flowParticleMesh.count =
      0;

    return;
  }

  const matrix =
    new THREE.Matrix4();

  const position =
    new THREE.Vector3();

  const quaternion =
    new THREE.Quaternion();

  const scale =
    new THREE.Vector3(
      1,
      1,
      1
    );

  const time =
    performance.now() /
    1000;

  flowParticleMesh.count =
    flowParticleData.length;


  for (
    let index = 0;
    index < flowParticleData.length;
    index++
  ) {
    const particle =
      flowParticleData[index];

    const distance =
      time *
      particle.speed +
      particle.phase *
      particle.pathData.totalLength;

    sampleFlowPath(
      particle.pathData,
      distance,
      position
    );

    matrix.compose(
      position,
      quaternion,
      scale
    );

    flowParticleMesh.setMatrixAt(
      index,
      matrix
    );
  }

  flowParticleMesh.instanceMatrix.needsUpdate =
    true;
}


/* --------------------------------------------------
   DESIGN COMPARISON
-------------------------------------------------- */

function makeDesignSnapshot(
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
    makeDesignSnapshot(
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
    storedDesigns.length === 0
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


/* --------------------------------------------------
   WATER EXPORT
-------------------------------------------------- */

function addExportVertex(
  point,
  vertices,
  vertexMap
) {
  const key =
    point
      .map(
        (value) =>
          value.toFixed(5)
      )
      .join("|");

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


function buildSmoothedWaterVolumeMesh(
  result
) {
  const vertices =
    [];

  const triangles =
    [];

  const vertexMap =
    new Map();


  for (
    const basin of result.basins
  ) {
    if (
      basin.retainedVolumeM3 <=
      0.0001
    ) {
      continue;
    }

    const loops =
      getSmoothedPondLoops(
        result,
        basin
      );

    for (
      const loop of loops
    ) {
      if (
        loop.length < 3
      ) {
        continue;
      }

      const contour =
        loop.map(
          (point) =>
            new THREE.Vector2(
              point.x,
              point.z
            )
        );

      const topY =
        basin.waterLevel;

      const bottomY =
        basin.minimumHeight;

      if (
        topY - bottomY <=
        0.0001
      ) {
        continue;
      }


      const topIndices =
        contour.map(
          (point) =>
            addExportVertex(
              [
                point.x,
                topY,
                point.y
              ],
              vertices,
              vertexMap
            )
        );

      const bottomIndices =
        contour.map(
          (point) =>
            addExportVertex(
              [
                point.x,
                bottomY,
                point.y
              ],
              vertices,
              vertexMap
            )
        );


      const triangulated =
        THREE.ShapeUtils.triangulateShape(
          contour,
          []
        );

      for (
        const triangle of triangulated
      ) {
        const ia =
          contour.indexOf(
            triangle[0]
          );

        const ib =
          contour.indexOf(
            triangle[1]
          );

        const ic =
          contour.indexOf(
            triangle[2]
          );

        if (
          ia < 0 ||
          ib < 0 ||
          ic < 0
        ) {
          continue;
        }

        addExportTriangle(
          [
            contour[ia].x,
            topY,
            contour[ia].y
          ],
          [
            contour[ib].x,
            topY,
            contour[ib].y
          ],
          [
            contour[ic].x,
            topY,
            contour[ic].y
          ],
          vertices,
          triangles,
          vertexMap
        );

        addExportTriangle(
          [
            contour[ic].x,
            bottomY,
            contour[ic].y
          ],
          [
            contour[ib].x,
            bottomY,
            contour[ib].y
          ],
          [
            contour[ia].x,
            bottomY,
            contour[ia].y
          ],
          vertices,
          triangles,
          vertexMap
        );
      }


      for (
        let index = 0;
        index < contour.length;
        index++
      ) {
        const nextIndex =
          (
            index + 1
          ) %
          contour.length;

        addExportQuad(
          [
            contour[index].x,
            bottomY,
            contour[index].y
          ],
          [
            contour[nextIndex].x,
            bottomY,
            contour[nextIndex].y
          ],
          [
            contour[nextIndex].x,
            topY,
            contour[nextIndex].y
          ],
          [
            contour[index].x,
            topY,
            contour[index].y
          ],
          vertices,
          triangles,
          vertexMap
        );
      }
    }
  }

  return {
    vertices,
    triangles
  };
}


function serializePly(
  mesh
) {
  const lines =
    [];

  lines.push(
    "ply"
  );

  lines.push(
    "format ascii 1.0"
  );

  lines.push(
    `element vertex ${mesh.vertices.length / 3}`
  );

  lines.push(
    "property float x"
  );

  lines.push(
    "property float y"
  );

  lines.push(
    "property float z"
  );

  lines.push(
    `element face ${mesh.triangles.length}`
  );

  lines.push(
    "property list uchar int vertex_indices"
  );

  lines.push(
    "end_header"
  );


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


  for (
    const triangle of mesh.triangles
  ) {
    lines.push(
      `3 ${triangle[0]} ${triangle[1]} ${triangle[2]}`
    );
  }

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
    "Rainwater retention volume";


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


  const getVertex =
    (index) => {
      return new THREE.Vector3(
        mesh.vertices[
          index * 3
        ],

        mesh.vertices[
          index * 3 + 1
        ],

        mesh.vertices[
          index * 3 + 2
        ]
      );
    };


  let offset =
    84;

  for (
    const triangle of mesh.triangles
  ) {
    const a =
      getVertex(
        triangle[0]
      );

    const b =
      getVertex(
        triangle[1]
      );

    const c =
      getVertex(
        triangle[2]
      );

    const ab =
      new THREE.Vector3()
        .subVectors(
          b,
          a
        );

    const ac =
      new THREE.Vector3()
        .subVectors(
          c,
          a
        );

    const normal =
      new THREE.Vector3()
        .crossVectors(
          ab,
          ac
        )
        .normalize();


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


    for (
      const vertex of [
        a,
        b,
        c
      ]
    ) {
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

    view.setUint16(
      offset,
      0,
      true
    );

    offset +=
      2;
  }

  return buffer;
}


/* --------------------------------------------------
   EXPORT HELPERS
-------------------------------------------------- */

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
    1000
  );
}


function downloadWaterVolume(
  format
) {
  if (
    !currentResult ||
    currentResult.retainedVolumeM3 <=
      0.0001
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
      buildSmoothedWaterVolumeMesh(
        currentResult
      );

    if (
      mesh.triangles.length === 0
    ) {
      throw new Error(
        "The retained-water geometry contains no triangles."
      );
    }

    const isPly =
      format === "ply";

    const data =
      isPly
        ? serializePly(
            mesh
          )
        : serializeStl(
            mesh
          );

    const slug =
      currentTerrainName
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

    downloadBlob(
      data,
      `${slug}-retained-water.${isPly ? "ply" : "stl"}`,
      "application/octet-stream"
    );

    setStatus(
      `${isPly ? "PLY" : "STL"} DOWNLOADED`
    );
  } catch (error) {
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
    [];

  lines.push(
    "# Rainwater retention flow lines"
  );

  lines.push(
    "# Coordinates are physical model units"
  );

  let vertexIndex =
    1;


  paths.forEach(
    (path, pathIndex) => {
      lines.push(
        `o flow_${String(
          pathIndex + 1
        ).padStart(
          3,
          "0"
        )}`
      );

      for (
        const point of path
      ) {
        lines.push(
          `v ${point.x} ${point.y} ${point.z}`
        );
      }

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

      if (
        indices.length >= 2
      ) {
        lines.push(
          `l ${indices.join(" ")}`
        );
      }

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
    !flowExportPaths ||
    flowExportPaths.length === 0
  ) {
    alert(
      "There are currently no flow lines to export."
    );

    return;
  }

  const data =
    serializeFlowLinesObj(
      flowExportPaths
    );

  const slug =
    currentTerrainName
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

  downloadBlob(
    data,
    `${slug}-flow-lines.obj`,
    "text/plain"
  );

  setStatus(
    "FLOW OBJ DOWNLOADED"
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

  const designInput =
    $("designName");

  const currentName =
    designInput &&
    designInput.value.trim()
      ? designInput.value.trim()
      : "CURRENT DESIGN";

  const designs =
    [
      ...storedDesigns,
      makeDesignSnapshot(
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


  for (
    const design of designs
  ) {
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


/* --------------------------------------------------
   MODEL LOADING
-------------------------------------------------- */

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
    filename.split(".").pop();

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
      extension === "obj"
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

      let geometry;

      if (
        extension === "ply"
      ) {
        geometry =
          new PLYLoader().parse(
            buffer
          );
      } else {
        geometry =
          new STLLoader().parse(
            buffer
          );
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
      collectTrianglesFromObject(
        object
      );

    if (
      triangles.length === 0
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
  } catch (error) {
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


/* --------------------------------------------------
   DESIGN STORAGE
-------------------------------------------------- */

function makeDesignSnapshot(
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
    makeDesignSnapshot(
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
    storedDesigns.length === 0
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


/* --------------------------------------------------
   ANIMATION
-------------------------------------------------- */

function animate() {
  requestAnimationFrame(
    animate
  );

  updateFlowParticles();

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


/* --------------------------------------------------
   INITIALISE
-------------------------------------------------- */

initializeScene();
bindControls();
buildProceduralTerrain(
  true
);
renderDesignComparison();

requestAnimationFrame(
  animate
);
