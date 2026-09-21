import * as THREE from "three";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

import {
  CSS2DRenderer,
  CSS2DObject
} from "three/addons/renderers/CSS2DRenderer.js";


const $ = (id) => {
  return document.getElementById(id);
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
  const value =
    Number($(id).value);

  return Number.isFinite(value)
    ? value
    : 0;
};


const degreesToRadians = (degrees) => {
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


const formatInteger = (value) => {
  return Math.round(
    Number(value)
  ).toLocaleString("en-US");
};


const formatVolume = (volumeM3) => {
  return (
    `${formatNumber(volumeM3, 2)} m³ / ` +
    `${formatInteger(volumeM3 * 1000)} L`
  );
};


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
let flowLineMesh;
let flowParticleMesh;
let rainMesh;

let flowParticleData = [];
let rainParticleData = [];

let terrainState = null;
let rawTriangles = null;

let currentTerrainName =
  "GENERATED ALPINE BASIN";

let currentResult = null;
let storedDesigns = [];

let displayedRainfall =
  numberValue("rainfallPerM2");

let targetRainfall =
  displayedRainfall;

let flowAnimationClock = 0;
let lastAnimationTime =
  performance.now();

let flowSeed = 1;
let proceduralSeed = null;

let terrainSeedCounter =
  (
    Date.now() ^
    Math.floor(
      Math.random() *
      0xffffffff
    )
  ) >>> 0;

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

    let index = 0;

    while (true) {
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

  terrainSeedCounter =
    (
      terrainSeedCounter +
      0x9e3779b9
    ) >>> 0;

  return terrainSeedCounter;
}


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
      0xbfd8ff,
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
    "rainfall-and-flow";

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

  const width =
    $("viewer").clientWidth;

  const height =
    $("viewer").clientHeight;

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
  $(rangeId).value =
    String(value);

  $(numberId).value =
    String(value);
}


function bindControls() {
  bindPair(
    "rainfallPerM2",
    "rainfallPerM2Number",
    (value) => {
      targetRainfall =
        value;

      displayedRainfall =
        value;

      flowAnimationClock =
        0;

      stopRainfallAnimation();

      if (
        terrainState
      ) {
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
      if (
        waterMesh
      ) {
        waterMesh.material.opacity =
          value;

        waterMesh.material.needsUpdate =
          true;
      }
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


      /*
       * Strong open slope toward one
       * boundary, guaranteeing runoff
       * for part of the terrain.
       */

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


      /*
       * Basins and raised rims.
       */

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


      /*
       * Artificial dam-like ridges.
       */

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
        z * resolution + x
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
    Infinity
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
        v1 - v2
      ) *
      (
        u0 - u2
      ) +
      (
        u2 - u1
      ) *
      (
        v0 - v2
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
              v1 - v2
            ) *
            (
              sampleU - u2
            ) +
            (
              u2 - u1
            ) *
            (
              sampleV - v2
            )
          ) /
          denominator;

        const b =
          (
            (
              v2 - v0
            ) *
            (
              sampleU - u2
            ) +
            (
              u0 - u2
            ) *
            (
              sampleV - v2
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
          Math.min(
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

  terrainState =
    state;

  currentTerrainName =
    terrainName;

  flowSeed =
    newRandomSeed();

  stopRainfallAnimation();

  rebuildTerrainMesh();
  ensureWaterMesh();
  rebuildFlowVisualization();

  updateTerrainName();
  updateVerticalDisplayScale();
  frameCamera();

  targetRainfall =
    numberValue(
      "rainfallPerM2"
    );

  displayedRainfall =
    targetRainfall;

  renderResult(
    calculateRetentionForRainfall(
      displayedRainfall
    )
  );

  setStatus(
    "READY"
  );
}


function computeSpillLevels(
  heights,
  resolution
) {
  const count =
    heights.length;

  const spillLevels =
    new Float32Array(
      count
    );

  spillLevels.fill(
    Infinity
  );

  const visited =
    new Uint8Array(
      count
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
  const count =
    heights.length;

  const targets =
    new Int32Array(
      count
    );

  targets.fill(
    -1
  );

  const accumulation =
    new Float32Array(
      count
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

      const isBoundary =
        x === 0 ||
        z === 0 ||
        x === resolution - 1 ||
        z === resolution - 1;

      if (
        isBoundary
      ) {
        continue;
      }

      const currentHeight =
        heights[index];

      let bestTarget =
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

        const heightDifference =
          currentHeight -
          heights[nextIndex];

        if (
          heightDifference <=
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
          heightDifference /
          distance;

        if (
          slope >
          bestSlope
        ) {
          bestSlope =
            slope;

          bestTarget =
            nextIndex;
        }
      }

      targets[index] =
        bestTarget;
    }
  }


  const order =
    Array.from(
      {
        length: count
      },
      (_, index) => index
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
  const count =
    targets.length;

  const terminals =
    new Int32Array(
      count
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
    start < count;
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

    let current =
      start;

    while (
      terminals[current] ===
      -2
    ) {
      path.push(
        current
      );

      const target =
        targets[current];

      if (
        target < 0
      ) {
        terminals[current] =
          current;

        break;
      }

      current =
        target;
    }

    const resolved =
      terminals[current];

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
      cells
    ] of groups.entries()
  ) {
    const spillLevel =
      state.spillLevels[sinkIndex];

    let minimumHeight =
      Infinity;

    let capacityM3 =
      0;

    for (
      const index of cells
    ) {
      const height =
        state.heights[index];

      minimumHeight =
        Math.min(
          minimumHeight,
          height
        );

      capacityM3 +=
        Math.max(
          0,
          spillLevel -
          height
        ) *
        state.cellAreaM2;
    }

    basins.push({
      sinkIndex,
      cells,
      spillLevel,
      minimumHeight,
      capacityM3
    });
  }

  basins.sort(
    (a, b) =>
      b.capacityM3 -
      a.capacityM3
  );

  return basins;
}


function volumeAtBasinLevel(
  basin,
  state,
  waterLevel
) {
  let volumeM3 =
    0;

  const cappedLevel =
    Math.min(
      waterLevel,
      basin.spillLevel
    );

  for (
    const index of basin.cells
  ) {
    const depth =
      Math.max(
        0,
        cappedLevel -
        state.heights[index]
      );

    volumeM3 +=
      depth *
      state.cellAreaM2;
  }

  return volumeM3;
}


function calculateBasinFill(
  basin,
  rainfallDepthM,
  state
) {
  const inflowVolumeM3 =
    basin.cells.length *
    state.cellAreaM2 *
    rainfallDepthM;

  if (
    inflowVolumeM3 <= 0 ||
    basin.capacityM3 <= 0
  ) {
    return {
      waterLevel:
        basin.minimumHeight,

      inflowVolumeM3,
      retainedVolumeM3: 0,
      spillVolumeM3: 0
    };
  }


  if (
    inflowVolumeM3 >=
    basin.capacityM3
  ) {
    return {
      waterLevel:
        basin.spillLevel,

      inflowVolumeM3,

      retainedVolumeM3:
        basin.capacityM3,

      spillVolumeM3:
        inflowVolumeM3 -
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

    const volume =
      volumeAtBasinLevel(
        basin,
        state,
        middle
      );

    if (
      volume <
      inflowVolumeM3
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

  const retainedVolumeM3 =
    volumeAtBasinLevel(
      basin,
      state,
      waterLevel
    );

  return {
    waterLevel,
    inflowVolumeM3,
    retainedVolumeM3,
    spillVolumeM3:
      Math.max(
        0,
        inflowVolumeM3 -
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
    ) /
    1000;

  const totalRainfallM3 =
    rainfallDepthM *
    state.terrainAreaM2;


  const waterDepth =
    new Float32Array(
      state.heights.length
    );

  let retainedVolumeM3 =
    0;

  let runoffVolumeM3 =
    0;

  let wetAreaM2 =
    0;

  let maximumWaterDepthM =
    0;

  let maximumWaterLevel =
    state.minimumHeight;

  let boundaryCellCount =
    0;


  for (
    let index = 0;
    index < state.flowTerminals.length;
    index++
  ) {
    if (
      state.flowTerminals[index] < 0
    ) {
      boundaryCellCount++;
    }
  }

  runoffVolumeM3 +=
    boundaryCellCount *
    state.cellAreaM2 *
    rainfallDepthM;


  const basins =
    [];


  for (
    const basin of state.basinDefinitions
  ) {
    const fill =
      calculateBasinFill(
        basin,
        rainfallDepthM,
        state
      );

    const output = {
      ...basin,
      ...fill,
      areaM2:
        0,
      maximumDepthM:
        0,
      x: 0,
      y: 0,
      z: 0
    };


    let weightedX =
      0;

    let weightedY =
      0;

    let weightedZ =
      0;


    for (
      const index of basin.cells
    ) {
      const cappedLevel =
        Math.min(
          fill.waterLevel,
          basin.spillLevel
        );

      const depthM =
        Math.max(
          0,
          cappedLevel -
          state.heights[index]
        );

      waterDepth[index] =
        depthM;

      if (
        depthM > 0.0001
      ) {
        output.areaM2 +=
          state.cellAreaM2;

        wetAreaM2 +=
          state.cellAreaM2;
      }

      output.maximumDepthM =
        Math.max(
          output.maximumDepthM,
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

      const localY =
        state.heights[index] +
        depthM / 2;

      weightedX +=
        localX *
        cellVolumeM3;

      weightedY +=
        localY *
        cellVolumeM3;

      weightedZ +=
        localZ *
        cellVolumeM3;

      maximumWaterDepthM =
        Math.max(
          maximumWaterDepthM,
          depthM
        );
    }

    if (
      output.retainedVolumeM3 >
      0
    ) {
      output.x =
        weightedX /
        output.retainedVolumeM3;

      output.y =
        weightedY /
        output.retainedVolumeM3;

      output.z =
        weightedZ /
        output.retainedVolumeM3;
    } else {
      const sinkPoint =
        getTerrainPoint(
          basin.sinkIndex,
          0.5
        );

      output.x =
        sinkPoint.x;

      output.y =
        sinkPoint.y;

      output.z =
        sinkPoint.z;
    }

    retainedVolumeM3 +=
      output.retainedVolumeM3;

    runoffVolumeM3 +=
      output.spillVolumeM3;

    maximumWaterLevel =
      Math.max(
        maximumWaterLevel,
        output.waterLevel
      );

    basins.push(
      output
    );
  }


  const balanceRunoff =
    Math.max(
      0,
      totalRainfallM3 -
      retainedVolumeM3
    );

  runoffVolumeM3 =
    balanceRunoff;


  basins.sort(
    (a, b) =>
      b.retainedVolumeM3 -
      a.retainedVolumeM3
  );


  const result = {
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

    basins
  };

  return result;
}


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


function ensureWaterMesh() {
  const requiredCount =
    terrainState.heights.length;

  if (
    waterMesh &&
    waterMesh.userData.capacity ===
      requiredCount
  ) {
    return;
  }

  disposeWaterMesh();


  waterMesh =
    new THREE.InstancedMesh(
      new THREE.BoxGeometry(
        1,
        1,
        1
      ),

      new THREE.MeshStandardMaterial({
        color: 0x4d9cff,
        transparent: true,
        opacity:
          numberValue(
            "waterOpacity"
          ),
        roughness: 0.12,
        metalness: 0.05,
        depthWrite: false,
        vertexColors: true
      }),

      requiredCount
    );

  waterMesh.name =
    "retained-water";

  waterMesh.userData.capacity =
    requiredCount;

  waterMesh.frustumCulled =
    false;

  waterMesh.renderOrder =
    5;

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

  waterGroup.remove(
    waterMesh
  );

  waterMesh.geometry.dispose();
  waterMesh.material.dispose();

  waterMesh =
    null;
}


function updateWaterVisualization(
  result
) {
  if (
    !waterMesh
  ) {
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

  let instanceIndex =
    0;


  for (
    let z = 0;
    z < result.resolution;
    z++
  ) {
    for (
      let x = 0;
      x < result.resolution;
      x++
    ) {
      const index =
        z *
        result.resolution +
        x;

      const depthM =
        result.waterDepth[index];

      if (
        depthM <= 0.0001
      ) {
        continue;
      }

      const localX =
        (
          x + 0.5
        ) *
        result.cellWidthM -
        result.widthM / 2;

      const localZ =
        (
          z + 0.5
        ) *
        result.cellDepthM -
        result.depthM / 2;

      const terrainHeight =
        result.heights[index];

      position.set(
        localX,
        terrainHeight +
        depthM / 2,
        localZ
      );

      scale.set(
        result.cellWidthM,
        Math.max(
          depthM,
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

  waterMesh.count =
    instanceIndex;

  waterMesh.instanceMatrix.needsUpdate =
    true;

  if (
    waterMesh.instanceColor
  ) {
    waterMesh.instanceColor.needsUpdate =
      true;
  }

  waterMesh.material.opacity =
    numberValue(
      "waterOpacity"
    );

  waterMesh.material.needsUpdate =
    true;
}


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

  const visible =
    $("showWaterLabels").checked;

  labelGroup.visible =
    visible;

  if (
    !visible
  ) {
    return;
  }

  result.basins
    .filter(
      (basin) =>
        basin.retainedVolumeM3 >
        0.0001
    )
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
              BASIN ${String(index + 1).padStart(2, "0")}
            </span>

            <span class="label-volume">
              ${formatVolume(basin.retainedVolumeM3)}
            </span>
          `;

        const label =
          new CSS2DObject(
            element
          );

        label.position.set(
          basin.x,
          basin.y + 0.5,
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
    `${formatNumber(result.terrainAreaM2, 0)} m²`;

  $("effectiveRainfallReadout").textContent =
    `${formatNumber(result.rainfallLPerM2, 1)} L/m²`;

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
    `${formatNumber(result.retentionPercent, 1)} %`;

  $("waterLevelReadout").textContent =
    `${formatNumber(result.maximumWaterLevel, 2)} m`;

  $("wetAreaReadout").textContent =
    `${formatNumber(result.wetAreaM2, 0)} m²`;


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
          `BASIN ${String(index + 1).padStart(2, "0")}`;

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
  const name =
    currentTerrainName ||
    "UNNAMED TERRAIN";

  $("terrainNameReadout").textContent =
    name.toUpperCase();

  $("terrainStatus").textContent =
    name.toUpperCase();
}


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

  updateFlowParticles();
  updateRainfallVisibility();
  updateTerrainName();

  setStatus(
    rainfallAnimation.playing
      ? "RAINFALL FALLING"
      : "READY"
  );
}


function setStatus(
  message
) {
  $("status").textContent =
    message.toUpperCase();
}


function updatePlayButton() {
  const button =
    $("playButton");

  if (
    rainfallAnimation.playing
  ) {
    button.textContent =
      "PAUSE RAINFALL";

    return;
  }

  if (
    displayedRainfall > 0 &&
    displayedRainfall <
      targetRainfall
  ) {
    button.textContent =
      "RESUME RAINFALL";

    return;
  }

  if (
    targetRainfall > 0 &&
    displayedRainfall >=
      targetRainfall
  ) {
    button.textContent =
      "REPLAY RAINFALL";

    return;
  }

  button.textContent =
    "PLAY RAINFALL";
}


function toggleRainfallAnimation() {
  if (
    !terrainState
  ) {
    return;
  }

  if (
    rainfallAnimation.playing
  ) {
    rainfallAnimation.playing =
      false;

    updatePlayButton();
    setStatus(
      "PAUSED"
    );

    return;
  }

  if (
    targetRainfall <= 0
  ) {
    setStatus(
      "NO RAINFALL"
    );

    return;
  }

  if (
    displayedRainfall >=
      targetRainfall
  ) {
    displayedRainfall =
      0;

    flowAnimationClock =
      0;
  }

  const speed =
    Math.max(
      0.25,
      numberValue(
        "rainfallSpeed"
      )
    );

  rainfallAnimation = {
    playing: true,

    startTime:
      performance.now(),

    startRainfall:
      displayedRainfall,

    targetRainfall,

    duration:
      5000 / speed,

    lastCalculation:
      0
  };

  updatePlayButton();

  setStatus(
    "RAINFALL FALLING"
  );
}


function stopRainfallAnimation() {
  rainfallAnimation.playing =
    false;

  updatePlayButton();
}


function emptyWater() {
  stopRainfallAnimation();

  displayedRainfall =
    0;

  flowAnimationClock =
    0;

  if (
    terrainState
  ) {
    renderResult(
      calculateRetentionForRainfall(
        0
      )
    );
  }

  updatePlayButton();
}


function getTerrainPoint(
  index,
  lift = 0.5
) {
  const x =
    index %
    terrainState.resolution;

  const z =
    Math.floor(
      index /
      terrainState.resolution
    );

  return new THREE.Vector3(
    (
      x + 0.5
    ) *
    terrainState.cellWidthM -
    terrainState.widthM / 2,

    terrainState.heights[index] +
    lift,

    (
      z + 0.5
    ) *
    terrainState.cellDepthM -
    terrainState.depthM / 2
  );
}


function traceFlowPath(
  startIndex,
  maxSteps
) {
  const path =
    [];

  const visited =
    new Set();

  let current =
    startIndex;

  for (
    let step = 0;
    step < maxSteps;
    step++
  ) {
    if (
      visited.has(
        current
      )
    ) {
      break;
    }

    visited.add(
      current
    );

    path.push(
      current
    );

    const target =
      terrainState.flowTargets[current];

    if (
      target < 0 ||
      target === current
    ) {
      break;
    }

    current =
      target;
  }

  return path;
}


function buildFlowPathData(
  path
) {
  const points =
    path.map(
      (index) =>
        getTerrainPoint(
          index,
          Math.max(
            0.8,
            Math.min(
              terrainState.cellWidthM,
              terrainState.cellDepthM
            ) * 0.12
          )
        )
    );

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

    if (
      child.geometry
    ) {
      child.geometry.dispose();
    }

    if (
      child.material
    ) {
      child.material.dispose();
    }
  }

  flowLineMesh =
    null;

  flowParticleMesh =
    null;

  rainMesh =
    null;

  flowParticleData =
    [];

  rainParticleData =
    [];
}


function rebuildFlowVisualization() {
  clearFlowVisualization();

  if (
    !terrainState
  ) {
    return;
  }


  const resolution =
    terrainState.resolution;

  const heights =
    terrainState.heights;

  const targets =
    terrainState.flowTargets;

  const terminals =
    terrainState.flowTerminals;


  /*
   * Static downhill flow lines.
   */

  const linePositions =
    [];

  const lineColors =
    [];

  const lineSample =
    resolution >= 240
      ? 2
      : 1;


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
        x % lineSample !== 0 ||
        z % lineSample !== 0
      ) {
        continue;
      }

      const index =
        z *
        resolution +
        x;

      const target =
        targets[index];

      if (
        target < 0
      ) {
        continue;
      }

      const start =
        getTerrainPoint(
          index,
          1.2
        );

      const end =
        getTerrainPoint(
          target,
          1.2
        );

      linePositions.push(
        start.x,
        start.y,
        start.z,

        end.x,
        end.y,
        end.z
      );


      const runoff =
        terminals[index] < 0;

      const color =
        runoff
          ? new THREE.Color(
              0xe9a061
            )
          : new THREE.Color(
              0x5faeff
            );

      lineColors.push(
        color.r,
        color.g,
        color.b,

        color.r,
        color.g,
        color.b
      );
    }
  }


  const lineGeometry =
    new THREE.BufferGeometry();

  lineGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      linePositions,
      3
    )
  );

  lineGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(
      lineColors,
      3
    )
  );

  const lineMaterial =
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthTest: false,
      depthWrite: false
    });

  flowLineMesh =
    new THREE.LineSegments(
      lineGeometry,
      lineMaterial
    );

  flowLineMesh.name =
    "visible-flow-lines";

  flowLineMesh.renderOrder =
    20;

  flowLineMesh.frustumCulled =
    false;

  flowGroup.add(
    flowLineMesh
  );


  /*
   * Moving surface-flow particles.
   */

  const random =
    mulberry32(
      flowSeed
    );

  const particleCount =
    Math.min(
      700,
      Math.max(
        220,
        Math.floor(
          heights.length / 60
        )
      )
    );

  let attempts =
    0;

  while (
    flowParticleData.length <
      particleCount &&
    attempts <
      particleCount * 40
  ) {
    attempts++;

    const startIndex =
      Math.floor(
        random() *
        heights.length
      );

    const path =
      traceFlowPath(
        startIndex,
        Math.min(
          heights.length,
          1000
        )
      );

    if (
      path.length < 2
    ) {
      continue;
    }

    const pathData =
      buildFlowPathData(
        path
      );

    if (
      pathData.totalLength <= 0
    ) {
      continue;
    }

    flowParticleData.push({
      pathData,

      terminal:
        terminals[startIndex],

      phase:
        random(),

      speed:
        Math.max(
          terrainState.cellWidthM,
          terrainState.cellDepthM
        ) *
        (
          0.75 +
          random() * 1.8
        )
    });
  }


  const particleGeometry =
    new THREE.SphereGeometry(
      Math.max(
        0.9,
        Math.min(
          terrainState.cellWidthM,
          terrainState.cellDepthM
        ) *
        0.14
      ),
      8,
      6
    );

  const particleMaterial =
    new THREE.MeshBasicMaterial({
      color: 0x9bcfff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      vertexColors: true
    });

  flowParticleMesh =
    new THREE.InstancedMesh(
      particleGeometry,
      particleMaterial,
      Math.max(
        1,
        flowParticleData.length
      )
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


  /*
   * Rainfall distributed across the full
   * topographic model.
   */

  const rainCount =
    Math.min(
      500,
      Math.max(
        180,
        Math.floor(
          heights.length / 90
        )
      )
    );

  const rainPositions =
    new Float32Array(
      rainCount * 6
    );

  const rainRandom =
    mulberry32(
      flowSeed ^
      0xa53c9e1d
    );

  for (
    let index = 0;
    index < rainCount;
    index++
  ) {
    rainParticleData.push({
      cellIndex:
        Math.floor(
          rainRandom() *
          heights.length
        ),

      phase:
        rainRandom(),

      speed:
        0.65 +
        rainRandom() * 1.2,

      length:
        4 +
        rainRandom() * 7
    });
  }

  const rainGeometry =
    new THREE.BufferGeometry();

  rainGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      rainPositions,
      3
    )
  );

  const rainMaterial =
    new THREE.LineBasicMaterial({
      color: 0xafd8ff,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
      depthWrite: false
    });

  rainMesh =
    new THREE.LineSegments(
      rainGeometry,
      rainMaterial
    );

  rainMesh.name =
    "rainfall-over-full-terrain";

  rainMesh.frustumCulled =
    false;

  rainMesh.renderOrder =
    30;

  flowGroup.add(
    rainMesh
  );

  updateFlowVisibility();
  updateFlowParticles();
  updateRainfallVisibility();
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


function updateRainfallVisibility() {
  const active =
    $("showFlow").checked &&
    displayedRainfall > 0.0001;

  if (
    rainMesh
  ) {
    rainMesh.visible =
      active;
  }

  if (
    flowParticleMesh
  ) {
    flowParticleMesh.visible =
      active;
  }

  if (
    flowLineMesh
  ) {
    flowLineMesh.visible =
      $("showFlow").checked;
  }
}


function updateFlowParticles() {
  if (
    !flowParticleMesh
  ) {
    return;
  }

  const target =
    Math.max(
      0,
      targetRainfall
    );

  const rainfallFraction =
    target > 0
      ? clamp(
          displayedRainfall /
          target,
          0,
          1
        )
      : 0;

  const activeCount =
    rainfallFraction > 0
      ? Math.min(
          flowParticleData.length,
          Math.max(
            1,
            Math.ceil(
              flowParticleData.length *
              Math.pow(
                rainfallFraction,
                0.55
              )
            )
          )
        )
      : 0;

  flowParticleMesh.count =
    activeCount;


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

  const color =
    new THREE.Color();


  for (
    let index = 0;
    index < activeCount;
    index++
  ) {
    const particle =
      flowParticleData[index];

    const distance =
      flowAnimationClock *
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

    color.set(
      particle.terminal < 0
        ? 0xe9a061
        : 0x8fcaff
    );

    flowParticleMesh.setColorAt(
      index,
      color
    );
  }

  flowParticleMesh.instanceMatrix.needsUpdate =
    true;

  if (
    flowParticleMesh.instanceColor
  ) {
    flowParticleMesh.instanceColor.needsUpdate =
      true;
  }

  updateRainfallVisibility();
}


function updateRainfallParticles(
  now
) {
  if (
    !rainMesh ||
    !terrainState
  ) {
    return;
  }

  const attribute =
    rainMesh.geometry.attributes.position;

  const positions =
    attribute.array;

  const time =
    now / 1000;


  rainParticleData.forEach(
    (drop, index) => {
      const terrainPoint =
        getTerrainPoint(
          drop.cellIndex,
          0
        );

      const cycle =
        (
          time *
          drop.speed +
          drop.phase
        ) %
        1;

      const topHeight =
        terrainState.heights[
          drop.cellIndex
        ] +
        42;

      const fallingTop =
        terrainPoint.y +
        (
          1 -
          cycle
        ) *
        (
          topHeight -
          terrainPoint.y
        );

      const fallingBottom =
        fallingTop -
        drop.length;

      const offset =
        index * 6;

      positions[offset] =
        terrainPoint.x;

      positions[offset + 1] =
        fallingTop;

      positions[offset + 2] =
        terrainPoint.z;

      positions[offset + 3] =
        terrainPoint.x;

      positions[offset + 4] =
        Math.max(
          terrainPoint.y + 0.5,
          fallingBottom
        );

      positions[offset + 5] =
        terrainPoint.z;
    }
  );

  attribute.needsUpdate =
    true;
}


function animate(now) {
  requestAnimationFrame(
    animate
  );

  const deltaSeconds =
    Math.min(
      0.1,
      Math.max(
        0,
        now -
        lastAnimationTime
      ) / 1000
    );

  lastAnimationTime =
    now;


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

    if (
      shouldCalculate
    ) {
      rainfallAnimation.lastCalculation =
        now;

      renderResult(
        calculateRetentionForRainfall(
          displayedRainfall
        )
      );
    }

    if (
      progress >= 1
    ) {
      rainfallAnimation.playing =
        false;

      displayedRainfall =
        targetRainfall;

      renderResult(
        calculateRetentionForRainfall(
          displayedRainfall
        )
      );

      updatePlayButton();

      setStatus(
        "READY"
      );
    }
  }


  if (
    displayedRainfall > 0
  ) {
    flowAnimationClock +=
      deltaSeconds *
      (
        0.8 +
        numberValue(
          "rainfallSpeed"
        ) *
        0.5
      );
  }

  updateFlowParticles();
  updateRainfallParticles(
    now
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
          ...basin
        })
      )
  };
}


function storeCurrentDesign() {
  if (
    !terrainState
  ) {
    return;
  }

  const name =
    $("designName").value.trim() ||
    `Design ${String(
      storedDesigns.length + 1
    ).padStart(
      2,
      "0"
    )}`;

  const result =
    calculateRetentionForRainfall(
      targetRainfall
    );

  storedDesigns.push(
    makeDesignSnapshot(
      name,
      result
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
              ${escapeHtml(design.name)}
            </strong>
            <br>
            ${escapeHtml(design.terrainName)}
          </td>

          <td>
            ${formatVolume(design.retainedVolumeM3)}
            <br>
            ${formatNumber(design.retentionPercent, 1)} %
          </td>

          <td>
            ${formatVolume(design.runoffVolumeM3)}
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


function escapeHtml(
  value
) {
  return String(
    value
  )
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


function downloadRetentionCsv() {
  if (
    !terrainState
  ) {
    alert(
      "There is no terrain loaded."
    );

    return;
  }

  const currentResult =
    calculateRetentionForRainfall(
      targetRainfall
    );

  const currentName =
    $("designName").value.trim() ||
    "CURRENT DESIGN";

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


    design.basins
      .filter(
        (basin) =>
          basin.retainedVolumeM3 >
          0
      )
      .forEach(
        (basin, index) => {
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
            .map(csvEscape)
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


function addWaterVertex(
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


function addWaterTriangle(
  a,
  b,
  c,
  vertices,
  triangles,
  vertexMap
) {
  triangles.push([
    addWaterVertex(
      a,
      vertices,
      vertexMap
    ),

    addWaterVertex(
      b,
      vertices,
      vertexMap
    ),

    addWaterVertex(
      c,
      vertices,
      vertexMap
    )
  ]);
}


function addWaterQuad(
  a,
  b,
  c,
  d,
  vertices,
  triangles,
  vertexMap
) {
  addWaterTriangle(
    a,
    b,
    c,
    vertices,
    triangles,
    vertexMap
  );

  addWaterTriangle(
    a,
    c,
    d,
    vertices,
    triangles,
    vertexMap
  );
}


function buildWaterVolumeMesh(
  result
) {
  const vertices =
    [];

  const triangles =
    [];

  const vertexMap =
    new Map();


  const isWet =
    (
      x,
      z
    ) => {
      if (
        x < 0 ||
        x >= result.resolution ||
        z < 0 ||
        z >= result.resolution
      ) {
        return false;
      }

      const index =
        z *
        result.resolution +
        x;

      return (
        result.waterDepth[index] >
        0.0001
      );
    };


  const getWaterTop =
    (
      x,
      z
    ) => {
      if (
        !isWet(
          x,
          z
        )
      ) {
        return null;
      }

      const index =
        z *
        result.resolution +
        x;

      return (
        result.heights[index] +
        result.waterDepth[index]
      );
    };


  const addSide =
    (
      a,
      b,
      bottomY,
      topY,
      neighbourTop
    ) => {
      let lowerY =
        bottomY;

      if (
        neighbourTop !== null
      ) {
        if (
          neighbourTop >=
          topY - 0.0001
        ) {
          return;
        }

        lowerY =
          Math.max(
            bottomY,
            neighbourTop
          );
      }

      if (
        topY -
        lowerY <=
        0.0001
      ) {
        return;
      }

      addWaterQuad(
        [
          a[0],
          lowerY,
          a[1]
        ],
        [
          b[0],
          lowerY,
          b[1]
        ],
        [
          b[0],
          topY,
          b[1]
        ],
        [
          a[0],
          topY,
          a[1]
        ],
        vertices,
        triangles,
        vertexMap
      );
    };


  for (
    let z = 0;
    z < result.resolution;
    z++
  ) {
    for (
      let x = 0;
      x < result.resolution;
      x++
    ) {
      const index =
        z *
        result.resolution +
        x;

      const depthM =
        result.waterDepth[index];

      if (
        depthM <= 0.0001
      ) {
        continue;
      }

      const x0 =
        x *
        result.cellWidthM -
        result.widthM / 2;

      const x1 =
        (
          x + 1
        ) *
        result.cellWidthM -
        result.widthM / 2;

      const z0 =
        z *
        result.cellDepthM -
        result.depthM / 2;

      const z1 =
        (
          z + 1
        ) *
        result.cellDepthM -
        result.depthM / 2;

      const bottomY =
        result.heights[index];

      const topY =
        bottomY +
        depthM;


      /*
       * Top face, oriented upward.
       */

      addWaterQuad(
        [
          x0,
          topY,
          z0
        ],
        [
          x0,
          topY,
          z1
        ],
        [
          x1,
          topY,
          z1
        ],
        [
          x1,
          topY,
          z0
        ],
        vertices,
        triangles,
        vertexMap
      );


      /*
       * Bottom face, oriented downward.
       */

      addWaterQuad(
        [
          x0,
          bottomY,
          z0
        ],
        [
          x1,
          bottomY,
          z0
        ],
        [
          x1,
          bottomY,
          z1
        ],
        [
          x0,
          bottomY,
          z1
        ],
        vertices,
        triangles,
        vertexMap
      );


      /*
       * Exposed sides.
       */

      addSide(
        [
          x0,
          z0
        ],
        [
          x0,
          z1
        ],
        bottomY,
        topY,
        getWaterTop(
          x - 1,
          z
        )
      );

      addSide(
        [
          x1,
          z1
        ],
        [
          x1,
          z0
        ],
        bottomY,
        topY,
        getWaterTop(
          x + 1,
          z
        )
      );

      addSide(
        [
          x1,
          z0
        ],
        [
          x0,
          z0
        ],
        bottomY,
        topY,
        getWaterTop(
          x,
          z - 1
        )
      );

      addSide(
        [
          x0,
          z1
        ],
        [
          x1,
          z1
        ],
        bottomY,
        topY,
        getWaterTop(
          x,
          z + 1
        )
      );
    }
  }

  return {
    vertices,
    triangles
  };
}


function serializePLY(
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


function serializeSTL(
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


function downloadBlob(
  data,
  filename,
  mimeType
) {
  const blob =
    new Blob(
      [data],
      {
        type: mimeType
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
      buildWaterVolumeMesh(
        currentResult
      );

    if (
      mesh.triangles.length === 0
    ) {
      throw new Error(
        "The retained-water geometry contains no triangles."
      );
    }

    const isPLY =
      format === "ply";

    const data =
      isPLY
        ? serializePLY(
            mesh
          )
        : serializeSTL(
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
      `${slug}-retained-water.${isPLY ? "ply" : "stl"}`,
      isPLY
        ? "application/octet-stream"
        : "application/octet-stream"
    );

    setStatus(
      `${isPLY ? "PLY" : "STL"} DOWNLOADED`
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


initializeScene();
bindControls();
buildProceduralTerrain(
  true
);
renderDesignComparison();

requestAnimationFrame(
  animate
);
