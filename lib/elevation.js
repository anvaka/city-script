const MAPBOX_TOKEN = 'pk.eyJ1IjoiYW52YWthIiwiYSI6ImNqaWUzZmhqYzA1OXMza213YXh2ZzdnOWcifQ.t5yext53zn1c9Ixd7Y41Dw';
const apiURL = `https://api.mapbox.com/v4/mapbox.terrain-rgb/zoom/tLong/tLat@2x.pngraw?access_token=${MAPBOX_TOKEN}`;
const tileSize = 512;
let imageCache = new Map();
const d2r = Math.PI / 180;

module.exports = function elevation(options = {}) {
  if (options === window.scene) {
    console.warn('The (scene, options) API is deprecated, use (options) instead. Read more here:')
    console.warn('https://github.com/anvaka/city-script/blob/master/Elevation.md')
    throw new Error('Please read https://github.com/anvaka/city-script/blob/master/Elevation.md')
  }

  const scene = options.scene || window.scene;
  let mainLayer = scene.queryLayer();
  const grid = mainLayer.grid;
  let nodes = grid.nodes;
  let colorLayer = new Map();
  let bounds = {
    west: Infinity,
    south: Infinity,
    north: -Infinity,
    east: -Infinity
  };

  nodes.forEach(node => {
    if (node.lat < bounds.south) bounds.south = node.lat;
    if (node.lat > bounds.north) bounds.north = node.lat;
    if (node.lon < bounds.west) bounds.west = node.lon;
    if (node.lon > bounds.east) bounds.east = node.lon;
  });

  const elevationTiles = getTileCover(bounds, options.zoomLevel);

  return loadTiles(elevationTiles).then(makePublicAPI);

  function makePublicAPI(elevationAPI) {
    return {
      drawWithColor(getColor) {
        return renderHeights(elevationAPI, getColor);
      },
      drawWithHeight(height, belowWaterColor = 0xff0000ff) {
        let color = scene.lineColor.toRgb();
        let defaultColor = (color.r << 24) | (color.g << 16) | (color.b << 8) | Math.round(color.a * 0xff);
        return renderHeights(elevationAPI, pointHeight => pointHeight < height ? belowWaterColor : defaultColor)
      },
      saveHeightMap(filename) {
        return generateHeightMap(elevationAPI, filename);
      },
      async saveWaterMap(fileName) {
        return generateWaterMap(fileName);
      }
    }
  }

  function renderHeights(api, getColor) {
    // Sometimes they want to keep the original city. Otherwise let's clear it
    if (!options.keepScene) mainLayer.hide();
    ensureLicenseVisible();

    let wgl = scene.getWGL();
    colorLayer.forEach(layer => {
      layer.parent.removeChild(layer);
    })
    colorLayer = new Map();

    forEachWay(function(from, to) {
      let layer = colorLayer.get(from.color);
      if (!layer) {
        layer = new wgl.WireCollection(1024, {
          allowColors: false,
          is3D: false
        });
        layer.color.r = ((from.color >> 24) & 0xff)/0xff;
        layer.color.g = ((from.color >> 16) & 0xff)/0xff;
        layer.color.b = ((from.color >> 8) & 0xff)/0xff;
        layer.color.a = ((from.color >> 0) & 0xff)/0xff;
        colorLayer.set(from.color, layer);
      }
      layer.add({from, to});
    });

    colorLayer.forEach(layer => {
      scene.getRenderer().appendChild(layer);
    })

    function forEachWay(callback) {
      let positions = nodes;
      let project = grid.getProjector();
      grid.elements.forEach(element => {
        if (element.type !== 'way') return;

        let nodeIds = element.nodes;
        let node = positions.get(nodeIds[0])
        if (!node) return;

        let last = project(node);
        last.z = api.getElevation(node.lon, node.lat);
        last.color = getColor(last.z);

        for (let index = 1; index < nodeIds.length; ++index) {
          node = positions.get(nodeIds[index])
          if (!node) continue;
          let next = project(node);
          next.z = api.getElevation(node.lon, node.lat)
          next.color = getColor(next.z);
          callback(last, next);

          last = next;
        }
      });
    }
  }

  function ensureLicenseVisible() {
    if (document.querySelector('.license.printable .mapbox')) return;
    let a = document.createElement('a');
    a.target = '_blank';
    a.href = 'https://www.mapbox.com/about/maps/';
    a.innerText = '© Mapbox';
    a.classList.add('mapbox');
    let osmLink = document.querySelector('.license.printable a');
    if (osmLink) {
      a.style.color = osmLink.style.color;
    }
    a.style.marginLeft = '2px';
    document.querySelector('.license.printable').appendChild(a);
  }

  function generateHeightMap(elevationAPI, filename) {
    // Get exact same dimensions as SVG export uses
    const drawContext = scene.getRenderer().getDrawContext();
    const canvasWidth = drawContext.width;
    const canvasHeight = drawContext.height;
    
    // Also check the actual canvas element dimensions for debugging
    const canvasElement = drawContext.canvas;
    const canvasElementWidth = canvasElement.width;
    const canvasElementHeight = canvasElement.height;
    const canvasClientWidth = canvasElement.clientWidth;
    const canvasClientHeight = canvasElement.clientHeight;
    const pixelRatio = drawContext.pixelRatio;
    
    console.log(`DrawContext dimensions: ${canvasWidth}x${canvasHeight}`);
    console.log(`Canvas element dimensions: ${canvasElementWidth}x${canvasElementHeight}`);
    console.log(`Canvas client dimensions: ${canvasClientWidth}x${canvasClientHeight}`);
    console.log(`Pixel ratio: ${pixelRatio}`);
    
    // The SVG export uses DrawContext dimensions for the viewBox
    // But getSceneCoordinate expects CLIENT coordinates (before pixel ratio scaling)
    // So we need to use client dimensions for coordinate conversion
    const clientWidth = canvasClientWidth;
    const clientHeight = canvasClientHeight;
    
    console.log(`Using client dimensions for coordinate conversion: ${clientWidth}x${clientHeight}`);
    console.log(`SVG viewBox will be: ${canvasWidth}x${canvasHeight}`);
    
    // Always match SVG dimensions exactly for perfect 1:1 pixel mapping
    const heightmapWidth = Math.round(canvasWidth);
    const heightmapHeight = Math.round(canvasHeight);
    console.log(`Heightmap dimensions (matching SVG exactly): ${heightmapWidth}x${heightmapHeight}`);
    
    // Collect all geographic coordinates we need elevation data for
    const geoCoordinates = [];
    const pixelToCoordMap = [];
    const totalPixels = heightmapWidth * heightmapHeight;
    let mappedPixels = 0;
    
    console.log(`Mapping ${totalPixels} pixels to geographic coordinates...`);
    
    for (let y = 0; y < heightmapHeight; y++) {
      pixelToCoordMap[y] = [];
      for (let x = 0; x < heightmapWidth; x++) {
        // Convert heightmap pixel to CLIENT coordinates (what getSceneCoordinate expects)
        const clientX = (x / (heightmapWidth - 1)) * (clientWidth - 1);
        const clientY = (y / (heightmapHeight - 1)) * (clientHeight - 1);
        
        // Use w-gl's coordinate conversion to get world coordinates
        const worldPos = scene.getRenderer().getSceneCoordinate(clientX, clientY);
        
        if (worldPos) {
          // Convert world coordinates to lon/lat, accounting for Grid's Y negation
          // Grid's project function does: y: -xyPoint[1], so we reverse it
          const unNegatedY = -worldPos[1];
          const lonLat = grid.projector.invert([worldPos[0], unNegatedY]);
          
          if (lonLat && !isNaN(lonLat[0]) && !isNaN(lonLat[1])) {
            const coord = { lon: lonLat[0], lat: lonLat[1] };
            geoCoordinates.push(coord);
            pixelToCoordMap[y][x] = coord;
            
            // Debug first few coordinates
            if (y < 3 && x < 3) {
              console.log(`Pixel [${x},${y}] -> client [${clientX.toFixed(1)},${clientY.toFixed(1)}] -> world [${worldPos[0].toFixed(1)},${worldPos[1].toFixed(1)}] -> geo [${lonLat[0].toFixed(6)},${lonLat[1].toFixed(6)}]`);
            }
          } else {
            pixelToCoordMap[y][x] = null;
          }
        } else {
          pixelToCoordMap[y][x] = null;
        }
        
        mappedPixels++;
        
        // Log progress every 10% of pixels
        if (mappedPixels % Math.floor(totalPixels / 10) === 0) {
          const percent = Math.round((mappedPixels / totalPixels) * 100);
          console.log(`Coordinate mapping: ${percent}% complete`);
        }
      }
    }
    
    // Calculate geographic bounds for the visible area
    const geoBounds = calculateGeoBounds(geoCoordinates);
    console.log('Geographic bounds:', geoBounds);
    
    // Load elevation tiles for this geographic area
    const elevationTiles = getTileCover(geoBounds, options.zoomLevel);
    console.log('Elevation tiles needed:', elevationTiles);
    
    return loadTiles(elevationTiles).then(viewportElevationAPI => {
      console.log('Generating heightmap...');
      const heightMapCanvas = document.createElement('canvas');
      heightMapCanvas.width = heightmapWidth;
      heightMapCanvas.height = heightmapHeight;
      const ctx = heightMapCanvas.getContext('2d');
      
      // Sample elevations for each pixel
      const heightSamples = [];
      let minHeight = Infinity;
      let maxHeight = -Infinity;
      let validSamples = 0;
      const totalPixels = heightmapWidth * heightmapHeight;
      let processedPixels = 0;
      
      console.log(`Sampling elevations for ${totalPixels} pixels...`);
      
      for (let y = 0; y < heightmapHeight; y++) {
        for (let x = 0; x < heightmapWidth; x++) {
          const coord = pixelToCoordMap[y][x];
          let elevation = NaN;
          
          if (coord) {
            elevation = viewportElevationAPI.getElevation(coord.lon, coord.lat);
            if (!isNaN(elevation)) {
              minHeight = Math.min(minHeight, elevation);
              maxHeight = Math.max(maxHeight, elevation);
              validSamples++;
            }
          }
          
          heightSamples.push(elevation);
          processedPixels++;
          
          // Log progress every 10% of pixels
          if (processedPixels % Math.floor(totalPixels / 10) === 0) {
            const percent = Math.round((processedPixels / totalPixels) * 100);
            console.log(`Sampling elevations: ${percent}% complete`);
          }
        }
      }
      
      console.log(`Valid height range: ${minHeight.toFixed(2)}m to ${maxHeight.toFixed(2)}m`);
      console.log(`Valid samples: ${validSamples}/${heightSamples.length} (${(100 * validSamples / heightSamples.length).toFixed(1)}%)`);
      
      const heightRange = maxHeight - minHeight;
      
      console.log('Creating heightmap image...');
      
      // Create grayscale heightmap
      const imageData = ctx.createImageData(heightmapWidth, heightmapHeight);
      const data = imageData.data;
      
      for (let i = 0; i < heightSamples.length; i++) {
        const height = heightSamples[i];
        let normalizedHeight = 0;
        
        if (!isNaN(height) && heightRange > 0) {
          normalizedHeight = (height - minHeight) / heightRange;
        }
        
        const grayValue = Math.round(normalizedHeight * 255);
        
        const pixelIndex = i * 4;
        data[pixelIndex] = grayValue;     // R
        data[pixelIndex + 1] = grayValue; // G  
        data[pixelIndex + 2] = grayValue; // B
        data[pixelIndex + 3] = 255;       // A
      }
      
      ctx.putImageData(imageData, 0, 0);
      
      // Save the heightmap with height range in filename
      const baseFilename = filename.endsWith('.png') ? filename.slice(0, -4) : filename;
      const heightRangeString = `_${minHeight.toFixed(0)}m-${maxHeight.toFixed(0)}m`;
      const filenameWithExt = `${baseFilename}${heightRangeString}.png`;
      
      heightMapCanvas.toBlob(function(blob) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filenameWithExt;
        a.click();
        
        // Clean up URL after download
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
        }, 45000);
      }, 'image/png');
      
      console.log(`Heightmap saved as ${filenameWithExt} (${heightmapWidth}x${heightmapHeight})`);
      console.log(`Height range: ${minHeight.toFixed(2)}m to ${maxHeight.toFixed(2)}m`);
      console.log(`SVG viewBox: 0 0 ${canvasWidth} ${canvasHeight}`);
      console.log(`Perfect 1:1 pixel mapping with SVG export!`);
      console.log(`Geographic bounds: ${geoBounds.west.toFixed(6)}, ${geoBounds.south.toFixed(6)} to ${geoBounds.east.toFixed(6)}, ${geoBounds.north.toFixed(6)}`);
    });
  }

  // Lazily load vector tile modules; cache on the function to avoid global mutable state
  async function ensureVectorModulesLoaded() {
    if (ensureVectorModulesLoaded._Pbf && ensureVectorModulesLoaded._VectorTile) {
      return { Pbf: ensureVectorModulesLoaded._Pbf, VectorTile: ensureVectorModulesLoaded._VectorTile };
    }
    const [pbfMod, vtMod] = await Promise.all([
      loadES6Module('https://cdn.jsdelivr.net/npm/pbf@3.2.1/+esm'),
      loadES6Module('https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@1.3.1/+esm')
    ]);
    const Pbf = pbfMod.default || pbfMod;
    const VectorTile = vtMod.VectorTile || (vtMod.default && vtMod.default.VectorTile) || vtMod;
    if (!Pbf || !VectorTile) throw new Error('Failed to load vector tile dependencies');
    ensureVectorModulesLoaded._Pbf = Pbf;
    ensureVectorModulesLoaded._VectorTile = VectorTile;
    return { Pbf, VectorTile };
  }

  async function generateWaterMap(fileName) {
    // Render water polygons to a pixel-perfect, transparent PNG with black fill
    const renderer = scene.getRenderer();
    const drawContext = renderer.getDrawContext();
    const pixelRatio = drawContext.pixelRatio || window.devicePixelRatio || 1;
    const clientWidth = drawContext.canvas.clientWidth;
    const clientHeight = drawContext.canvas.clientHeight;

    const outCanvas = document.createElement('canvas');
    // Match device-pixel dimensions exactly to scene for pixel-perfect output
    outCanvas.width = Math.round(drawContext.width);
    outCanvas.height = Math.round(drawContext.height);
    const ctx = outCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, outCanvas.width, outCanvas.height);
    ctx.fillStyle = '#000';
    ctx.globalCompositeOperation = 'source-over';

    // Calculate current geographic bounds from the four viewport corners
    const grid = scene.queryLayer().grid;
    const projectorForward = grid.getProjector();
    const projectorInverse = grid.projector && grid.projector.invert;
    if (!projectorForward || !projectorInverse) throw new Error('Projection is not available');

    const worldTL = renderer.getSceneCoordinate(0, 0);
    const worldTR = renderer.getSceneCoordinate(clientWidth, 0);
    const worldBL = renderer.getSceneCoordinate(0, clientHeight);
    const worldBR = renderer.getSceneCoordinate(clientWidth, clientHeight);

    if (!worldTL || !worldTR || !worldBL || !worldBR) throw new Error('Failed to get scene coordinates for viewport corners');

    const toLonLat = (world) => {
      // grid projection negates Y on forward projection, so invert expects [x, -y]
      const lonlat = projectorInverse([world[0], -world[1]]);
      if (!lonlat) return null;
      return { lon: lonlat[0], lat: lonlat[1] };
    };

    const cTL = toLonLat(worldTL);
    const cTR = toLonLat(worldTR);
    const cBL = toLonLat(worldBL);
    const cBR = toLonLat(worldBR);
    if (!cTL || !cTR || !cBL || !cBR) throw new Error('Failed to compute geographic bounds');

    const bounds = {
      west: Math.min(cTL.lon, cBL.lon),
      east: Math.max(cTR.lon, cBR.lon),
      north: Math.max(cTL.lat, cTR.lat),
      south: Math.min(cBL.lat, cBR.lat)
    };

    // Determine vector tile coverage (cap at z=14 for Shortbread)
    const cover = getVectorTileCover(bounds, options.zoomLevel);
    const widthInTiles = cover.maxX - cover.minX + 1;
    const heightInTiles = cover.maxY - cover.minY + 1;
    if (widthInTiles > 20 || heightInTiles > 20) {
      throw new Error(`Too many vector tiles requested: ${widthInTiles}x${heightInTiles}. Reduce the bounding area.`);
    }

  const { Pbf, VectorTile } = await ensureVectorModulesLoaded();

    const tiles = [];
    for (let x = cover.minX; x <= cover.maxX; x++) {
      for (let y = cover.minY; y <= cover.maxY; y++) {
        tiles.push({ x, y, z: cover.zoomLevel });
      }
    }

    // Load and render tiles in parallel. Any failure should reject.
    await Promise.all(tiles.map(async (tile) => {
      const url = `https://vector.openstreetmap.org/shortbread_v1/${tile.z}/${tile.x}/${tile.y}.mvt`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to load vector tile ${tile.z}/${tile.x}/${tile.y}: ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const pbf = new Pbf(new Uint8Array(buf));
      const vt = new VectorTile(pbf);

      const layerNames = ['ocean', 'water_polygons'];
      const present = layerNames.map(n => vt.layers[n]).filter(Boolean);
      if (present.length === 0) return; // no water in this tile, that's fine

      // Pre-compute tile geographic bounds
      const tileBounds = {
        west: tileToLon(tile.x, tile.z),
        east: tileToLon(tile.x + 1, tile.z),
        north: tileToLat(tile.y, tile.z),
        south: tileToLat(tile.y + 1, tile.z)
      };

      for (const layer of present) {
        renderWaterLayerOnCanvas(layer, tileBounds);
      }
    }));

    // Save to disk
    const outName = fileName && fileName.endsWith('.png') ? fileName : `${(fileName || 'water')}.png`;
    await new Promise((resolve) => {
      outCanvas.toBlob((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outName;
        a.click();
        setTimeout(() => window.URL.revokeObjectURL(url), 45000);
        resolve();
      }, 'image/png');
    });

    function renderWaterLayerOnCanvas(layer, tileBounds) {
      const extent = (typeof layer.extent === 'number' && layer.extent > 0) ? layer.extent : 4096;

      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        if (feature.type !== 3) continue; // 3 = Polygon

        const rings = feature.loadGeometry();
        if (!rings || !rings.length) continue;

        ctx.beginPath();

        for (const ring of rings) {
          if (!ring || ring.length < 3) continue;
          let first = true;
          for (const p of ring) {
            // Vector tile local coords -> lon/lat
            const lon = tileBounds.west + (p.x / extent) * (tileBounds.east - tileBounds.west);
            const lat = tileBounds.north + (p.y / extent) * (tileBounds.south - tileBounds.north);

            // Project lon/lat -> scene -> client -> device pixels
            const sc = projectorForward({ lon, lat }); // {x, y}
            const cc = renderer.getClientCoordinate(sc.x, sc.y, 0);
            if (!cc) continue;
            const dx = cc.x * pixelRatio;
            const dy = cc.y * pixelRatio;
            if (first) {
              ctx.moveTo(dx, dy);
              first = false;
            } else {
              ctx.lineTo(dx, dy);
            }
          }
          ctx.closePath();
        }

        // Fill with even-odd rule to respect holes
        // Older browsers may not support passing the rule; assume modern environment here
        ctx.fill('evenodd');
      }
    }
  }

  function calculateGeoBounds(geoCoordinates) {
    if (geoCoordinates.length === 0) {
      return {
        west: 0, east: 0, north: 0, south: 0
      };
    }
    
    let bounds = {
      west: Infinity,
      east: -Infinity,
      north: -Infinity,
      south: Infinity
    };
    
    geoCoordinates.forEach(coord => {
      if (coord.lon < bounds.west) bounds.west = coord.lon;
      if (coord.lon > bounds.east) bounds.east = coord.lon;
      if (coord.lat < bounds.south) bounds.south = coord.lat;
      if (coord.lat > bounds.north) bounds.north = coord.lat;
    });
    
    return bounds;
  }
}

function getTileCover(bounds, zoomLevel) {
  if (zoomLevel === undefined) {
    let latDiff = bounds.north - bounds.south;
    let lngDiff = bounds.east - bounds.west;

    let maxDiff = (lngDiff > latDiff) ? lngDiff : latDiff;
    if (maxDiff < 360 / Math.pow(2, 20)) zoomLevel = 21;
    else {
      zoomLevel = (-1*( (Math.log(maxDiff)/Math.log(2)) - (Math.log(360)/Math.log(2))));
      if (zoomLevel < 1) zoomLevel = 1;
    }
    zoomLevel = Math.floor(zoomLevel) + 1;
  }

  let sw = pointToTile(bounds.west, bounds.south, zoomLevel);
  let se = pointToTile(bounds.east, bounds.south, zoomLevel);
  let ne = pointToTile(bounds.east, bounds.north, zoomLevel);
  let nw = pointToTile(bounds.west, bounds.north, zoomLevel);
  let minX = Math.min(sw[0], nw[0]);
  let minY = Math.min(ne[1], nw[1]);
  let maxX = Math.max(se[0], ne[0]);
  let maxY = Math.max(se[1], sw[1]);
  return {
    minX, minY, maxY, maxX, zoomLevel
  };
}

function getRequestForTile(x, y, z, tileBounds) {
  const url = apiURL
    .replace('zoom', z)
    .replace('tLat', y)
    .replace('tLong', x);

  return {
    url,
    x: tileSize * (x - tileBounds.minX), 
    y: tileSize * (y - tileBounds.minY)
  }
}

function loadTiles(tileBounds) {
  let {minX, minY, maxX, maxY, zoomLevel} = tileBounds;
  const widthInTiles = tileBounds.maxX - tileBounds.minX;
  const heightInTiles = tileBounds.maxY - tileBounds.minY;
  if (widthInTiles > 20 || heightInTiles > 20) throw new Error('Too many tiles requested. Please reduce the bounding area');

  let coveringTiles = [];
  for (let x = minX; x <= maxX; ++x) {
    for (let y = minY; y <= maxY; ++y) {
      let request = getRequestForTile(x, y, zoomLevel, tileBounds)
      coveringTiles.push(request);
    }
  }

  const canvas = document.createElement('canvas');
  let canvasWidth = canvas.width = (widthInTiles + 1) * tileSize;
  let canvasHeight = canvas.height = (heightInTiles + 1) * tileSize;

  const ctx = canvas.getContext('2d');
  let imageData;
  let tilesLoaded = 0;
  const totalTiles = coveringTiles.length;
  
  console.log(`Loading ${totalTiles} elevation tiles...`);
  
  const tilesToLoad = coveringTiles.map(toLoadedTile)

  return Promise.all(tilesToLoad).then(constructAPI);

  function constructAPI() {
    imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;

    return {
      getElevation
    };
  }

  function getElevation(lon, lat) {
    let pos = pointToTileFraction(lon, lat, zoomLevel);
    let xC = Math.round((pos[0] - minX) * tileSize);
    let yC = Math.round((pos[1] - minY) * tileSize);
    let index = (yC * canvasWidth + xC) * 4;

    let R = imageData[index + 0];
    let G = imageData[index + 1];
    let B = imageData[index + 2];
    return decodeHeight(R, G, B);
  }

  function decodeHeight(R, G, B) {
    return -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
  }

  function toLoadedTile(request) {
    return loadImage(request.url)
      .then(drawTileImage)
      .catch(drawBlankTile)
      .finally(() => {
        tilesLoaded++;
        console.log(`Loaded elevation tile ${tilesLoaded}/${totalTiles}`);
      });

    function drawTileImage(image) {
      ctx.drawImage(image, request.x, request.y);
    }

    function drawBlankTile() {
      ctx.beginPath();
      ctx.fillStyle = '#0186a0'; // zero height
      ctx.fillRect(request.x, request.y, tileSize, tileSize);
    }
  }
}

function loadImage(url) {
  let cachedImage = imageCache.get(url);
  if (!cachedImage) {
    cachedImage = new Promise((resolve, error) => {
      const img = new Image();
      img.onload = () => {
        resolve(img);
      };
      img.onerror = error;
      img.crossOrigin = "anonymous";
      img.src = url;
    });
    imageCache.set(url, cachedImage);
  }

  return cachedImage;
}

// this function is from https://github.com/mapbox/tilebelt/blob/master/index.js
// The MIT License (MIT)
// Copyright (c) 2014 Morgan Herlocker
function pointToTile(lon, lat, z) {
    var tile = pointToTileFraction(lon, lat, z);
    tile[0] = Math.floor(tile[0]);
    tile[1] = Math.floor(tile[1]);
    return tile;
}

// this function is from https://github.com/mapbox/tilebelt/blob/master/index.js
// The MIT License (MIT)
// Copyright (c) 2014 Morgan Herlocker
function pointToTileFraction(lon, lat, z) {
    var sin = Math.sin(lat * d2r),
        z2 = Math.pow(2, z),
        x = z2 * (lon / 360 + 0.5),
        y = z2 * (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);

    // Wrap Tile X
    x = x % z2
    if (x < 0) x = x + z2
    return [x, y, z];
}

// Helpers for vector tiles
function tileToLon(x, zoom) {
  return x / Math.pow(2, zoom) * 360 - 180;
}

function tileToLat(y, zoom) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function getVectorTileCover(bounds, zoomLevel) {
  if (zoomLevel === undefined) {
    let latDiff = bounds.north - bounds.south;
    let lngDiff = bounds.east - bounds.west;
    let maxDiff = (lngDiff > latDiff) ? lngDiff : latDiff;
    if (maxDiff < 360 / Math.pow(2, 20)) zoomLevel = 21;
    else {
      zoomLevel = (-1 * ((Math.log(maxDiff) / Math.log(2)) - (Math.log(360) / Math.log(2))));
      if (zoomLevel < 1) zoomLevel = 1;
    }
    zoomLevel = Math.floor(zoomLevel) + 1;
  }
  // Cap to max zoom level supported by OSM Shortbread vector tiles
  if (zoomLevel > 14) zoomLevel = 14;

  let sw = pointToTile(bounds.west, bounds.south, zoomLevel);
  let se = pointToTile(bounds.east, bounds.south, zoomLevel);
  let ne = pointToTile(bounds.east, bounds.north, zoomLevel);
  let nw = pointToTile(bounds.west, bounds.north, zoomLevel);
  let minX = Math.min(sw[0], nw[0]);
  let minY = Math.min(ne[1], nw[1]);
  let maxX = Math.max(se[0], ne[0]);
  let maxY = Math.max(se[1], sw[1]);
  return { minX, minY, maxY, maxX, zoomLevel };
}

async function loadES6Module(url) {
  const mod = await import(url);
  return mod.default || mod;
}
